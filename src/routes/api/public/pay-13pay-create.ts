// 13pay 统一下单接口（pay.13pay.cn /api/pay/create）
// 文档：https://pay.13pay.cn/doc/pay_create.html
// 此路由会按 method=jsapi 创建订单并返回原生 jsApiParameters，
// 前端在微信内直接 WeixinJSBridge.invoke('getBrandWCPayRequest', ...) 拉起，不会跳转任何外部页面。
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sign13 } from "@/lib/thirteenpay";

const GATEWAY = "https://pay.13pay.cn/api/pay/create";
const NOTIFY_URL = "https://wordpro.cn/api/public/pay-13pay-notify";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function log(
  orderNo: string | null,
  stage: string,
  level: "info" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  try {
    await supabaseAdmin.from("payment_logs").insert([
      {
        order_no: orderNo,
        source: "13pay-create",
        stage,
        level,
        message,
        payload: payload as never,
      },
    ] as never);
  } catch (e) {
    console.error("[pay-13pay-create] log failed", e);
  }
}

function sanitize(s: string): string {
  return (s || "支付订单")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u2600-\u27BF\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "支付订单";
}

export const Route = createFileRoute("/api/public/pay-13pay-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => json({ ok: true, endpoint: "pay-13pay-create", method: "POST" }),
      POST: async ({ request }) => {
        let body: { orderNo?: string; payType?: string; returnOrigin?: string; method?: string } = {};
        try {
          body = await request.json();
        } catch {
          return json({ success: false, error: "请求体无效" });
        }
        const orderNo = String(body.orderNo || "");
        const payType = String(body.payType || "wechat");
        // method 默认 jsapi（微信内直拉），可传 jump 走跳转兜底
        const method = String(body.method || "jsapi");
        if (!orderNo) return json({ success: false, error: "缺少 orderNo" });

        // 1. 取订单
        const { data: order } = await supabaseAdmin
          .from("payment_orders")
          .select("order_no, amount, subject, status")
          .eq("order_no", orderNo)
          .maybeSingle();
        if (!order) {
          await log(orderNo, "create_error", "error", "订单不存在", {});
          return json({ success: false, error: "订单不存在" });
        }
        if (order.status !== "pending") {
          return json({ success: false, error: `订单状态为 ${order.status}` });
        }

        // 2. 取 13pay 通道配置
        const { data: chans } = await supabaseAdmin
          .from("payment_channels")
          .select("provider, config, is_enabled")
          .eq("is_enabled", true);
        const chan = (chans ?? []).find((c: { provider: string }) => c.provider === "13pay");
        if (!chan) {
          await log(orderNo, "create_error", "error", "未配置 13pay 通道", {});
          return json({ success: false, error: "未配置 13pay 通道" });
        }
        const cfg = (chan.config ?? {}) as Record<string, unknown>;
        const pid = String(cfg.pid ?? "").trim();
        const merchantPrivateKey = String(cfg.merchantPrivateKey ?? "");
        const platformPublicKey = String(cfg.platformPublicKey ?? "");
        if (!pid || !merchantPrivateKey || !platformPublicKey) {
          await log(orderNo, "create_error", "error", "13pay 通道配置不完整", {
            hasPid: !!pid, hasPriv: !!merchantPrivateKey, hasPub: !!platformPublicKey,
          });
          return json({ success: false, error: "13pay 通道配置不完整（pid / 私钥 / 公钥）" });
        }

        // 3. 客户端 IP
        const xff = request.headers.get("x-forwarded-for") || "";
        const clientip =
          xff.split(",")[0].trim() ||
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-real-ip") ||
          "127.0.0.1";

        // 4. 组装请求参数
        const params: Record<string, string> = {
          pid,
          method, // jsapi | jump | web ...
          type: payType === "alipay" ? "alipay" : "wxpay",
          out_trade_no: orderNo,
          notify_url: NOTIFY_URL,
          return_url: `https://wordpro.cn/pay/return?orderNo=${encodeURIComponent(orderNo)}`,
          name: sanitize(order.subject || "支付订单"),
          money: Number(order.amount).toFixed(2),
          clientip,
          timestamp: String(Math.floor(Date.now() / 1000)),
          sign_type: "RSA",
        };
        // 微信内 method=web 时建议带 device=wechat
        if (method === "web") params.device = "wechat";

        let sign: string;
        try {
          sign = await sign13(params, merchantPrivateKey);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await log(orderNo, "create_error", "error", `签名失败：${msg}`, { params });
          return json({ success: false, error: `签名失败：${msg}` });
        }
        const fullParams = { ...params, sign };

        // 5. POST form-urlencoded
        const formBody = new URLSearchParams(fullParams).toString();
        await log(orderNo, "create_request", "info", "POST 13pay /api/pay/create", {
          params: fullParams, gateway: GATEWAY,
        });

        let resp: Response;
        try {
          resp = await fetch(GATEWAY, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await log(orderNo, "create_error", "error", `网络错误：${msg}`, {});
          return json({ success: false, error: `请求 13pay 失败：${msg}` });
        }

        const respText = await resp.text();
        let respJson: Record<string, unknown> = {};
        try { respJson = JSON.parse(respText); } catch { /* ignore */ }
        await log(orderNo, "create_response", "info", `13pay HTTP ${resp.status}`, {
          httpStatus: resp.status, body: respText.slice(0, 2000),
        });

        const code = Number(respJson.code ?? -1);
        if (code !== 0) {
          return json({
            success: false,
            error: String(respJson.msg ?? `13pay 返回 code=${code}`),
            httpStatus: resp.status,
            raw: respJson,
          });
        }

        const payType13 = String(respJson.pay_type ?? "");
        const payInfo = String(respJson.pay_info ?? "");
        const tradeNo = String(respJson.trade_no ?? "");

        // 写回平台单号
        if (tradeNo) {
          await supabaseAdmin
            .from("payment_orders")
            .update({ trade_no: tradeNo })
            .eq("order_no", orderNo);
        }

        // 解析 pay_info：jsapi 时是 jsApiParameters JSON 字符串，jump/qrcode 时是 URL
        let jsApiParams: Record<string, string> | null = null;
        if (payType13 === "jsapi") {
          try {
            jsApiParams = JSON.parse(payInfo) as Record<string, string>;
          } catch {
            jsApiParams = null;
          }
        }

        return json({
          success: true,
          payType: payType13,           // jsapi | jump | qrcode ...
          payInfo,                       // 原始字符串
          jsApiParams,                   // 仅 jsapi
          payUrl: payType13 === "jump" ? payInfo : null,
          qrcode: payType13 === "qrcode" ? payInfo : null,
          tradeNo,
        });
      },
    },
  },
});
