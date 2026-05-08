// 微信内支付：跳转微信公众号 OAuth 授权页。
import { createFileRoute } from "@tanstack/react-router";
import { ThreeYPayConfig } from "@/lib/threeypay.server";

const SITE_ORIGIN = "https://66cai.site";

export const Route = createFileRoute("/api/public/pay/wx-start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
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

        throw redirect({ href: wxUrl });
      },
    },
  },
});
