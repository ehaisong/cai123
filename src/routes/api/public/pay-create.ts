// 同源 3ypay 创建订单接口（运行在 66cai.site 自有服务器，
// 出口 IP 即站点白名单 IP，避免被 3ypay 风控拦截）。
// 替代原 supabase/functions/pay-create。
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signRSA2, verifyRSA2 } from "@/lib/threeypay-verify";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY_URL = "https://openapi.3ypay.com/openapi/order/pay/create";
const NOTIFY_URL = "https://66cai.site/api/public/pay-notify";
const RETURN_URL_BASE = "https://66cai.site/pay/success";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

type AppSupabase = SupabaseClient<Database>;

function getSupabaseForRequest(request: Request): { supabase: AppSupabase; mode: "service" | "user" } {
  const supabaseUrl = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || (!serviceRoleKey && !publishableKey)) {
    throw new Error("服务器缺少 Supabase 环境变量");
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!serviceRoleKey && !authHeader) {
    throw new Error("服务器缺少 service role，且请求未携带用户登录态");
  }

  return {
    mode: serviceRoleKey ? "service" : "user",
    supabase: createClient<Database>(supabaseUrl, serviceRoleKey || publishableKey, {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
      global: authHeader && !serviceRoleKey ? { headers: { Authorization: authHeader } } : undefined,
    }),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function sanitizeSubject(raw: string): string {
  if (!raw) return "支付订单";
  let s = raw
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u2600-\u27BF\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = "支付订单";
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}

async function logPay(
  supabase: AppSupabase,
  orderNo: string | null,
  stage: string,
  level: "info" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  try {
    await supabase.from("payment_logs").insert([
      {
        order_no: orderNo,
        source: "tanstack-pay-create",
        stage,
        level,
        message,
        payload: payload as never,
      },
    ] as never);
  } catch (e) {
    console.error("[pay-create] log insert failed", e);
  }
}

export const Route = createFileRoute("/api/public/pay-create")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async () =>
        json({ ok: true, endpoint: "pay-create", method: "POST" }),
      POST: async ({ request }) => {
        let body: { orderNo?: string; payType?: string } = {};
        try {
          body = await request.json();
        } catch {
          return json({ success: false, error: "请求体无效" }, 200);
        }
        const orderNo = String(body.orderNo || "");
        const payType = String(body.payType || "") as "wechat" | "alipay";
        if (!orderNo || !["wechat", "alipay"].includes(payType)) {
          return json({ success: false, error: "缺少 orderNo / payType" }, 200);
        }

        // 1. 取订单
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("payment_orders")
          .select("order_no, amount, subject, status, user_id")
          .eq("order_no", orderNo)
          .maybeSingle();
        if (orderErr || !order) {
          await logPay(orderNo, "create_error", "error", "订单不存在", {
            orderErr,
          });
          return json({ success: false, error: "订单不存在" }, 200);
        }
        if (order.status !== "pending") {
          return json(
            { success: false, error: `订单状态为 ${order.status}，无法支付` },
            200,
          );
        }

        // 2. 取 3ypay 通道配置
        const { data: chans } = await supabaseAdmin
          .from("payment_channels")
          .select("provider, config, is_enabled")
          .eq("is_enabled", true);
        const chan =
          (chans ?? []).find((c: { provider: string }) => c.provider === "3ypay") ??
          (chans ?? []).find((c: { provider: string }) => c.provider === payType);
        if (!chan) {
          await logPay(orderNo, "create_error", "error", "未配置 3ypay 通道", {});
          return json(
            { success: false, error: "未配置 3ypay 支付通道，请联系管理员" },
            200,
          );
        }
        const cfg = (chan.config ?? {}) as Record<string, unknown>;
        const appId = cfg.appId as string | undefined;
        const merchantPrivateKey = cfg.merchantPrivateKey as string | undefined;
        const platformPublicKey = cfg.platformPublicKey as string | undefined;
        const sub = (cfg[payType] ?? {}) as Record<string, string | undefined>;
        const productCode = sub.productCode;
        const paySubType = sub.paySubType || "NATIVE";
        if (!appId || !merchantPrivateKey || !platformPublicKey || !productCode) {
          await logPay(orderNo, "create_error", "error", "通道配置不完整", {
            hasAppId: !!appId,
            hasPriv: !!merchantPrivateKey,
            hasPub: !!platformPublicKey,
            hasProductCode: !!productCode,
          });
          return json({ success: false, error: "支付通道配置不完整" }, 200);
        }

        // 3. 构造 bizContent
        const xff = request.headers.get("x-forwarded-for") || "";
        const clientIp =
          xff.split(",")[0].trim() ||
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-real-ip") ||
          "127.0.0.1";
        const bizContentObj: Record<string, unknown> = {
          mchOrderNo: orderNo,
          productCode,
          paySubType,
          subject: sanitizeSubject(order.subject || "支付订单"),
          orderAmount: Number(order.amount).toFixed(2),
          clientIp,
          notifyUrl: NOTIFY_URL,
          redirectUrl: `${RETURN_URL_BASE}?orderNo=${encodeURIComponent(orderNo)}`,
        };
        const bizContent = JSON.stringify(bizContentObj);

        // 4. 公共参数 + 签名
        const requestId =
          crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
        const common: Record<string, unknown> = {
          appId,
          requestId,
          signType: "RSA2",
          timestamp: Date.now(),
          version: "1.0",
          charset: "UTF-8",
          bizContent,
        };
        let sign: string;
        try {
          sign = await signRSA2(common, merchantPrivateKey);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logPay(orderNo, "create_error", "error", `RSA2 签名失败：${msg}`, {});
          return json({ success: false, error: `签名失败：${msg}` }, 200);
        }
        const reqBody = { ...common, sign };

        // 5. 调用 3ypay
        await logPay(orderNo, "create_request", "info", "POST 3ypay openapi (同源)", {
          requestId,
          productCode,
          paySubType,
          bizContent: bizContentObj,
        });
        let resp: Response;
        try {
          resp = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logPay(orderNo, "create_error", "error", `网络错误：${msg}`, {});
          return json({ success: false, error: `请求 3ypay 失败：${msg}` }, 200);
        }

        const respText = await resp.text();
        const respCt = resp.headers.get("content-type") || "";
        await logPay(orderNo, "create_response", "info", `3ypay HTTP ${resp.status}`, {
          httpStatus: resp.status,
          contentType: respCt,
          bodyPreview: respText.slice(0, 1500),
        });

        const isHtml =
          respCt.includes("text/html") || /^\s*<(!doctype|html)/i.test(respText);
        if (isHtml || resp.status === 403) {
          const blocked = /you have been blocked|被阻止访问|forbidden/i.test(respText);
          const errMsg = blocked
            ? `3ypay 拒绝访问（HTTP ${resp.status}）：服务器出口 IP 被风控拦截。请确认 66cai.site 服务器 IP 已加入 3ypay 白名单，或联系 3ypay 客服解封。`
            : `3ypay 返回非 JSON 响应（HTTP ${resp.status}）`;
          await logPay(orderNo, "create_error", "error", errMsg, {
            httpStatus: resp.status,
          });
          return json(
            { success: false, error: errMsg, httpStatus: resp.status },
            200,
          );
        }

        let respJson: Record<string, unknown> = {};
        try {
          respJson = JSON.parse(respText);
        } catch {
          const errMsg = `3ypay 响应非 JSON（HTTP ${resp.status})`;
          await logPay(orderNo, "create_error", "error", errMsg, {
            body: respText.slice(0, 1500),
          });
          return json({ success: false, error: errMsg }, 200);
        }

        if (respJson.code !== 200 || !respJson.data) {
          const errMsg = `3ypay 返回失败：${respJson.msg || respJson.subMsg || "未知错误"}（code=${respJson.code}）`;
          await logPay(orderNo, "create_error", "error", errMsg, {
            code: respJson.code,
            raw: respJson,
          });
          return json({ success: false, error: errMsg, raw: respJson }, 200);
        }

        // 6. 验签响应
        if (respJson.sign) {
          const ok = await verifyRSA2(
            respJson,
            String(respJson.sign),
            platformPublicKey,
          );
          if (!ok) {
            await logPay(orderNo, "create_error", "error", "响应验签失败（仅告警）", {
              raw: respJson,
            });
          }
        }

        // 7. 解析 data → payInfo / payUrl
        let dataObj: Record<string, unknown> = {};
        try {
          dataObj =
            typeof respJson.data === "string"
              ? JSON.parse(respJson.data as string)
              : (respJson.data as Record<string, unknown>);
        } catch {
          await logPay(orderNo, "create_error", "error", "data 解析失败", {
            data: respJson.data,
          });
          return json({ success: false, error: "3ypay data 解析失败" }, 200);
        }
        const payUrl =
          (dataObj.payInfo as string) ||
          (dataObj.payUrl as string) ||
          (dataObj.payData as string) ||
          (dataObj.cashierUrl as string);
        if (!payUrl || typeof payUrl !== "string") {
          const failReason =
            (dataObj.failReason as string) ||
            (dataObj.failCode as string) ||
            "未取到收银台 URL";
          await logPay(orderNo, "create_error", "error", String(failReason), {
            dataObj,
          });
          return json(
            { success: false, error: String(failReason), data: dataObj },
            200,
          );
        }

        await logPay(orderNo, "create_response", "info", "已获取收银台 URL", {
          payDataType: dataObj.payDataType,
          payOrderNo: dataObj.payOrderNo,
          payUrlPreview: payUrl.slice(0, 200),
        });

        return json({
          success: true,
          payUrl,
          payOrderNo: dataObj.payOrderNo,
        });
      },
    },
  },
});
