// 微信内支付：跳转微信公众号 OAuth 授权页。GET ?orderNo=xxx
// @ts-nocheck
import { ThreeYPayConfig } from "../_shared/threeypay.ts";

const SITE_ORIGIN = "https://66cai.site";

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }
  const url = new URL(req.url);
  const orderNo = url.searchParams.get("orderNo") || "";
  if (!orderNo) return new Response("missing orderNo", { status: 400 });
  const appid = ThreeYPayConfig.wxOaAppId;
  if (!appid) return new Response("WECHAT_OA_APPID not set", { status: 500 });

  const redirectUri = `${SITE_ORIGIN}/api/public/pay/wx-callback`;
  const wxUrl =
    `https://open.weixin.qq.com/connect/oauth2/authorize` +
    `?appid=${appid}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=snsapi_base` +
    `&state=${encodeURIComponent(orderNo)}` +
    `#wechat_redirect`;

  return new Response(null, { status: 302, headers: { Location: wxUrl } });
});
