// 直连 3ypay 创建支付订单（支付宝 H5 场景）。
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createOrder } from "@/lib/threeypay.server";

const SITE_ORIGIN = "https://66cai.site";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") || "127.0.0.1";
}

export const Route = createFileRoute("/api/public/pay/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { orderNo?: string; payType?: "alipay" | "wechat" };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, msg: "invalid json" }, { status: 400 });
        }
        const orderNo = String(body.orderNo || "");
        const payType = body.payType === "wechat" ? "wechat" : "alipay";
        if (!orderNo) return Response.json({ ok: false, msg: "缺少订单号" }, { status: 400 });

        const { data: order } = await supabaseAdmin
          .from("payment_orders")
          .select("order_no, amount, subject, status")
          .eq("order_no", orderNo)
          .maybeSingle();
        if (!order) return Response.json({ ok: false, msg: "订单不存在" }, { status: 404 });
        if (order.status === "paid") return Response.json({ ok: false, msg: "订单已支付" });

        const subject = (order.subject as string) || `订单 ${orderNo}`;
        const result = await createOrder({
          mchOrderNo: orderNo,
          productCode: payType === "wechat" ? "WeChat-PAY" : "Ali-PAY",
          paySubType: "H5",
          subject,
          description: subject,
          orderAmount: Number(order.amount),
          clientIp: getClientIp(request),
          notifyUrl: `${SITE_ORIGIN}/api/public/pay-notify`,
          redirectUrl: `${SITE_ORIGIN}/pay/success?orderNo=${encodeURIComponent(orderNo)}`,
        });

        if (!result.ok || !result.payInfo) {
          return Response.json({ ok: false, msg: result.msg, raw: result.raw }, { status: 502 });
        }
        return Response.json({
          ok: true,
          payDataType: result.payDataType,
          payInfo: result.payInfo,
        });
      },
    },
  },
});
