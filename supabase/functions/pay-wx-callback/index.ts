// 微信 OAuth 回调：code → openid → 调用 3ypay 创建 JSAPI 订单 → 跳 /pay/invoke
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createOrder, wechatExchangeOpenid, ThreeYPayConfig } from "../_shared/threeypay.ts";

const SITE_ORIGIN = "https://66cai.site";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function ipFrom(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || "127.0.0.1";
}

function errorPage(msg: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>支付失败</title><body style="font:16px/1.6 -apple-system,sans-serif;padding:32px;color:#333"><h2>支付发起失败</h2><p>${msg}</p><a href="${SITE_ORIGIN}/pay/test">返回</a></body>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const orderNo = url.searchParams.get("state") || "";
  if (!code || !orderNo) return errorPage("缺少 code 或 state");

  const { openid, error } = await wechatExchangeOpenid(code);
  if (!openid) return errorPage(`获取 openid 失败：${error}`);

  const { data: order } = await supabase
    .from("payment_orders")
    .select("order_no, amount, subject, status")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order) return errorPage("订单不存在");
  if (order.status === "paid") {
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE_ORIGIN}/pay/success?orderNo=${encodeURIComponent(orderNo)}` },
    });
  }

  const subject = (order.subject as string) || `订单 ${orderNo}`;
  const result = await createOrder({
    mchOrderNo: orderNo,
    productCode: "WeChat-PAY",
    paySubType: "JSAPI",
    subject,
    description: subject,
    orderAmount: Number(order.amount),
    clientIp: ipFrom(req),
    notifyUrl: `${SITE_ORIGIN}/api/public/pay-notify`,
    redirectUrl: `${SITE_ORIGIN}/pay/success?orderNo=${encodeURIComponent(orderNo)}`,
    extra: { subAppId: ThreeYPayConfig.wxOaAppId, userId: openid },
  });
  if (!result.ok || !result.payInfo) return errorPage(`下单失败：${result.msg}`);

  const target = `${SITE_ORIGIN}/pay/invoke?orderNo=${encodeURIComponent(orderNo)}&payInfo=${encodeURIComponent(result.payInfo)}`;
  return new Response(null, { status: 302, headers: { Location: target } });
});
