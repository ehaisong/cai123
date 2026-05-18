// 13pay / 彩虹易支付（Epay）统一下单接口
// 协议：POST {apiBase}mapi.php，application/x-www-form-urlencoded，MD5 签名
// 文档：彩虹易支付 SDK（EpayCore），见上传的 epay_plugin.php 范例
// 返回 code===1 成功，优先取 payurl（跳转） → qrcode（二维码） → urlscheme（小程序）
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signEpay } from "@/lib/epay-sign";

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

function detectDevice(ua: string): "wechat" | "alipay" | "qq" | "mobile" | "pc" {
  const u = (ua || "").toLowerCase();
  if (/micromessenger|wechat|weixin/.test(u)) return "wechat";
  if (/alipayclient/.test(u)) return "alipay";
  if (/qq\//.test(u)) return "qq";
  if (/mobile|android|iphone|ipad/.test(u)) return "mobile";
  return "pc";
}

export const Route = createFileRoute("/api/public/pay-13pay-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => json({ ok: true, endpoint: "pay-13pay-create", method: "POST" }),
      POST: async ({ request }) => {
        let body: { orderNo?: string; payType?: string; returnOrigin?: string } = {};
        try {
          body = await request.json();
        } catch {
          return json({ success: false, error: "请求体无效" });
        }
        const orderNo = String(body.orderNo || "");
        const payType = String(body.payType || "wechat");
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
        const key = String(cfg.key ?? "").trim();
        let apiBase = String(cfg.apiBase ?? "https://pay.13pay.cn/").trim();
        if (!apiBase.endsWith("/")) apiBase += "/";
        const siteName = String(cfg.siteName ?? "").trim();
        if (!pid || !key) {
          await log(orderNo, "create_error", "error", "13pay 通道配置不完整", {
            hasPid: !!pid, hasKey: !!key, apiBase,
          });
          return json({ success: false, error: "13pay 通道配置不完整（apiBase / pid / key）" });
        }

        // 3. 客户端 IP & device
        const xff = request.headers.get("x-forwarded-for") || "";
        const clientip =
          xff.split(",")[0].trim() ||
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-real-ip") ||
          "127.0.0.1";
        const device = detectDevice(request.headers.get("user-agent") || "");

        // 4. 组装参数
        const params: Record<string, string> = {
          pid,
          type: payType === "alipay" ? "alipay" : "wxpay",
          device,
          clientip,
          notify_url: NOTIFY_URL,
          return_url: `https://wordpro.cn/pay/return?orderNo=${encodeURIComponent(orderNo)}`,
          out_trade_no: orderNo,
          name: sanitize(order.subject || "支付订单"),
          money: Number(order.amount).toFixed(2),
        };
        if (siteName) params.sitename = siteName;

        const sign = signEpay(params, key);
        const fullParams: Record<string, string> = { ...params, sign, sign_type: "MD5" };
        const gateway = `${apiBase}mapi.php`;
        const formBody = new URLSearchParams(fullParams).toString();

        await log(orderNo, "create_request", "info", `POST ${gateway}`, {
          params: fullParams, gateway,
        });

        // 5. fetch with UA + 15s timeout + 1 retry
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
              `首次 fetch 失败重试：${e1 instanceof Error ? e1.message : String(e1)}`,
              { cause: (e1 as { cause?: unknown })?.cause ? String((e1 as { cause?: unknown }).cause) : null });
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
        if (code !== 1) {
          return json({
            success: false,
            error: String(respJson.msg ?? `13pay 返回 code=${code}`),
            httpStatus: resp.status,
            raw: respJson,
          });
        }

        const payurl = String(respJson.payurl ?? "");
        const qrcode = String(respJson.qrcode ?? "");
        const urlscheme = String(respJson.urlscheme ?? "");
        const tradeNo = String(respJson.trade_no ?? "");

        if (tradeNo) {
          await supabaseAdmin
            .from("payment_orders")
            .update({ trade_no: tradeNo })
            .eq("order_no", orderNo);
        }

        let outPayType: "jump" | "qrcode" | "scheme" | "unknown" = "unknown";
        let outUrl = "";
        if (payurl) { outPayType = "jump"; outUrl = payurl; }
        else if (qrcode) { outPayType = "qrcode"; outUrl = qrcode; }
        else if (urlscheme) { outPayType = "scheme"; outUrl = urlscheme; }
        else {
          return json({
            success: false,
            error: "13pay 未返回支付链接",
            raw: respJson,
          });
        }

        return json({
          success: true,
          payType: outPayType,
          payUrl: outPayType === "jump" ? outUrl : null,
          qrcode: outPayType === "qrcode" ? outUrl : null,
          urlscheme: outPayType === "scheme" ? outUrl : null,
          tradeNo,
        });
      },
    },
  },
});
