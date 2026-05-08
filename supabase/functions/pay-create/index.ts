// 直连 3ypay 创建支付订单（支付宝 H5 / 微信外）。POST { orderNo, payType }
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createOrder } from "../_shared/threeypay.ts";

const SITE_ORIGIN = "https://66cai.site";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || "127.0.0.1";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);

  let body: { orderNo?: string; payType?: "alipay" | "wechat" };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, msg: "invalid json" }, 400);
  }
  const orderNo = String(body.orderNo || "");
  const payType = body.payType === "wechat" ? "wechat" : "alipay";
  if (!orderNo) return json({ ok: false, msg: "缺少订单号" }, 400);

  const { data: order } = await supabase
    .from("payment_orders")
    .select("order_no, amount, subject, status")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order) return json({ ok: false, msg: "订单不存在" }, 404);
  if (order.status === "paid") return json({ ok: false, msg: "订单已支付" });

  const subject = (order.subject as string) || `订单 ${orderNo}`;
  const result = await createOrder({
    mchOrderNo: orderNo,
    productCode: payType === "wechat" ? "WeChat-PAY" : "Ali-PAY",
    paySubType: "H5",
    subject,
    description: subject,
    orderAmount: Number(order.amount),
    clientIp: clientIp(req),
    notifyUrl: `${SITE_ORIGIN}/api/public/pay-notify`,
    redirectUrl: `${SITE_ORIGIN}/pay/success?orderNo=${encodeURIComponent(orderNo)}`,
  });
  if (!result.ok || !result.payInfo) {
    return json({ ok: false, msg: result.msg, raw: result.raw }, 502);
  }
  return json({ ok: true, payDataType: result.payDataType, payInfo: result.payInfo });
});
