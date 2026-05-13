// 调用 3ypay 官方统一支付接口创建订单，返回收银台 URL（payInfo / payUrl）
// 客户端拿到 payUrl 后 location.href = payUrl，3ypay 收银台自动识别微信内/外
// 并在微信内拉起 JSAPI 支付。
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { signRSA2, verifyRSA2 } from "../_shared/threeypay.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GATEWAY_URL = "https://openapi.3ypay.com/openapi/order/pay/create";
const NOTIFY_URL = "https://66cai.site/api/public/pay-notify";
const RETURN_URL_BASE = "https://66cai.site/pay/success";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// 清洗 subject：去 emoji / surrogate，避免上游 GBK 转码报错
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
  orderNo: string | null,
  stage: string,
  level: "info" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  try {
    await supabase.from("payment_logs").insert({
      order_no: orderNo,
      source: "3ypay-create",
      stage,
      level,
      message,
      payload,
    });
  } catch (e) {
    console.error("[pay-create] log insert failed", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const orderNo = String(body.orderNo || "");
  const payType = String(body.payType || "") as "wechat" | "alipay";
  if (!orderNo || !["wechat", "alipay"].includes(payType)) {
    return json({ error: "缺少 orderNo / payType" }, 400);
  }

  // 1. 取订单
  const { data: order, error: orderErr } = await supabase
    .from("payment_orders")
    .select("order_no, amount, subject, status, user_id")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (orderErr || !order) {
    await logPay(orderNo, "create_error", "error", "订单不存在", { orderErr });
    return json({ error: "订单不存在" }, 404);
  }
  if (order.status !== "pending") {
    return json({ error: `订单状态为 ${order.status}，无法支付` }, 400);
  }

  // 2. 取 3ypay 通道配置（provider="3ypay" 优先，回退到与 payType 同名的 provider）
  const { data: chans } = await supabase
    .from("payment_channels")
    .select("provider, config, is_enabled")
    .eq("is_enabled", true);
  const chan =
    (chans ?? []).find((c) => c.provider === "3ypay") ??
    (chans ?? []).find((c) => c.provider === payType);
  if (!chan) {
    await logPay(orderNo, "create_error", "error", "未配置 3ypay 通道", {});
    return json({ error: "未配置 3ypay 支付通道，请联系管理员" }, 500);
  }
  const cfg = (chan.config ?? {}) as Record<string, any>;
  const appId = cfg.appId;
  const merchantPrivateKey = cfg.merchantPrivateKey;
  const platformPublicKey = cfg.platformPublicKey;
  const productCode = cfg[payType]?.productCode;
  const paySubType = cfg[payType]?.paySubType || "NATIVE";
  if (!appId || !merchantPrivateKey || !platformPublicKey || !productCode) {
    await logPay(orderNo, "create_error", "error", "通道配置不完整", {
      hasAppId: !!appId,
      hasPriv: !!merchantPrivateKey,
      hasPub: !!platformPublicKey,
      hasProductCode: !!productCode,
    });
    return json({ error: "支付通道配置不完整" }, 500);
  }

  // 3. 构造 bizContent
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
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
    return json({ error: `签名失败：${msg}` }, 500);
  }
  const reqBody = { ...common, sign };

  // 5. 调用 3ypay
  await logPay(orderNo, "create_request", "info", "POST 3ypay openapi", {
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
    return json({ error: `请求 3ypay 失败：${msg}` }, 502);
  }
  const respText = await resp.text();
  let respJson: Record<string, any> = {};
  try {
    respJson = JSON.parse(respText);
  } catch {
    await logPay(orderNo, "create_error", "error", "响应非 JSON", {
      status: resp.status,
      body: respText.slice(0, 1000),
    });
    return json({ error: "3ypay 响应格式错误" }, 502);
  }

  if (respJson.code !== 200 || !respJson.data) {
    const errMsg = String(respJson.msg || "3ypay 返回失败");
    await logPay(orderNo, "create_error", "error", errMsg, {
      code: respJson.code,
      raw: respJson,
    });
    return json({ error: errMsg, raw: respJson }, 400);
  }

  // 6. 验签响应（可选但推荐）
  if (respJson.sign) {
    const ok = await verifyRSA2(respJson, String(respJson.sign), platformPublicKey);
    if (!ok) {
      await logPay(orderNo, "create_error", "error", "响应验签失败", {
        raw: respJson,
      });
      // 不直接拒绝，仅告警
    }
  }

  // 7. 解析 data → payInfo / payUrl
  let dataObj: Record<string, any> = {};
  try {
    dataObj = typeof respJson.data === "string" ? JSON.parse(respJson.data) : respJson.data;
  } catch (e) {
    await logPay(orderNo, "create_error", "error", "data 解析失败", {
      data: respJson.data,
    });
    return json({ error: "3ypay data 解析失败" }, 502);
  }
  const payUrl =
    dataObj.payInfo || dataObj.payUrl || dataObj.payData || dataObj.cashierUrl;
  if (!payUrl || typeof payUrl !== "string") {
    const failReason = dataObj.failReason || dataObj.failCode || "未取到收银台 URL";
    await logPay(orderNo, "create_error", "error", String(failReason), { dataObj });
    return json({ error: String(failReason), data: dataObj }, 400);
  }

  await logPay(orderNo, "create_response", "info", "已获取收银台 URL", {
    payDataType: dataObj.payDataType,
    payOrderNo: dataObj.payOrderNo,
    payUrlPreview: payUrl.slice(0, 200),
  });

  return json({ success: true, payUrl, payOrderNo: dataObj.payOrderNo });
});
