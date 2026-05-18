// 13pay 统一下单（RSA + method=jump 协议）
// 网关：POST https://pay.13pay.cn/api/pay/create，application/x-www-form-urlencoded
// 签名：SHA256WithRSA / PKCS1v15，sign_type=RSA
// method=jump：返回 H5 收银台 URL（pay_info），前端跳转，13pay 收银台自行拉起微信支付
//   无需 sub_openid，无需公众号 AppID
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sign13 } from "@/lib/thirteenpay";

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

function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  const s = ip.split(",")[0].trim();
  return !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|fe80:)/i.test(s);
}

export const Route = createFileRoute("/api/public/pay-13pay-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => json({ ok: true, endpoint: "pay-13pay-create", method: "POST" }),
      POST: async ({ request }) => {
        let body: { orderNo?: string; payType?: string } = {};
        try {
          body = await request.json();
        } catch {
          return json({ success: false, error: "请求体无效" });
        }
        const orderNo = String(body.orderNo || "");
        const payType = String(body.payType || "wechat");
        if (!orderNo) return json({ success: false, error: "缺少 orderNo" });

        // 1. 订单
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

        // 2. 通道配置
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
        const privateKey = String(cfg.merchantPrivateKey ?? "").trim();
        let apiBase = String(cfg.apiBase ?? "https://pay.13pay.cn/api").trim();
        // 兼容老配置：去末尾 /
        apiBase = apiBase.replace(/\/+$/, "");
        // 兼容老配置：如果用户填的是根域 https://pay.13pay.cn/，补上 /api
        if (!/\/api$/.test(apiBase)) apiBase = `${apiBase}/api`;

        if (!pid || !privateKey) {
          await log(orderNo, "create_error", "error", "13pay 通道配置不完整", {
            hasPid: !!pid, hasPrivateKey: !!privateKey, apiBase,
          });
          return json({ success: false, error: "13pay 通道配置不完整（apiBase / pid / 商户私钥）" });
        }

        // 3. 客户端 IP
        const xff = request.headers.get("x-forwarded-for") || "";
        const rawIp = xff.split(",")[0].trim()
          || request.headers.get("cf-connecting-ip")
          || request.headers.get("x-real-ip")
          || "";
        const clientip = isPublicIp(rawIp) ? rawIp : "1.1.1.1";

        const isWechat = payType !== "alipay";
        const method = isWechat ? "jump" : "web";
        const type = isWechat ? "wxpay" : "alipay";

        // 4. 参数（注意：pid 必须是数字字符串；money 元两位小数；timestamp 秒）
        const params: Record<string, string | number> = {
          pid: Number(pid),
          method,
          type,
          out_trade_no: orderNo,
          notify_url: NOTIFY_URL,
          return_url: `https://wordpro.cn/pay/return?orderNo=${encodeURIComponent(orderNo)}`,
          name: sanitize(order.subject || "支付订单"),
          money: Number(order.amount).toFixed(2),
          clientip,
          timestamp: String(Math.floor(Date.now() / 1000)),
          sign_type: "RSA",
        };
        if (!isWechat) params.device = "mobile";

        let sign: string;
        try {
          sign = await sign13(params, privateKey);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          await log(orderNo, "create_error", "error", `签名失败：${m}`, {});
          return json({ success: false, error: `签名失败：${m}（请检查商户私钥是 PKCS#8 PEM 格式）` });
        }

        const fullParams: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) fullParams[k] = String(v);
        fullParams.sign = sign;

        const gateway = `${apiBase}/pay/create`;
        const formBody = new URLSearchParams(fullParams).toString();

        await log(orderNo, "create_request", "info", `POST ${gateway}`, {
          params: fullParams, gateway,
        });

        // 5. fetch
        const doFetch = async (): Promise<Response> => {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 15000);
          try {
            return await fetch(gateway, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (wordpro-13pay-client)",
              },
              body: formBody,
              signal: ac.signal,
            });
          } finally {
            clearTimeout(t);
          }
        };
        let resp: Response;
        try {
          try {
            resp = await doFetch();
          } catch (e1) {
            await log(orderNo, "create_error", "error",
              `首次 fetch 失败重试：${e1 instanceof Error ? e1.message : String(e1)}`, {});
            await new Promise((r) => setTimeout(r, 400));
            resp = await doFetch();
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const cause = (e as { cause?: unknown })?.cause;
          const detail = cause ? ` (cause=${String(cause)})` : "";
          await log(orderNo, "create_error", "error", `网络错误：${msg}${detail}`, {});
          return json({ success: false, error: `请求 13pay 失败：${msg}${detail}` });
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

        const payInfo = String(respJson.pay_info ?? "");
        const payTypeResp = String(respJson.pay_type ?? "");
        const tradeNo = String(respJson.trade_no ?? "");

        if (tradeNo) {
          await supabaseAdmin
            .from("payment_orders")
            .update({ trade_no: tradeNo })
            .eq("order_no", orderNo);
        }

        if (!payInfo) {
          return json({
            success: false,
            error: "13pay 未返回 pay_info",
            raw: respJson,
          });
        }

        // method=jump → pay_info 是 H5 收银台 URL
        // method=web 支付宝 → pay_info 同样是 URL
        // 其他 pay_type（如 qrcode）兜底
        const isUrl = /^https?:\/\//i.test(payInfo);
        const outPayType: "jump" | "qrcode" = isUrl ? "jump" : "qrcode";

        return json({
          success: true,
          payType: outPayType,
          payUrl: isUrl ? payInfo : null,
          qrcode: isUrl ? null : payInfo,
          tradeNo,
          payTypeRaw: payTypeResp,
        });
      },
    },
  },
});
