// 3ypay 支付异步通知。RSA2 验签 + 校验金额 + 调 mark_payment_paid。
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rsa2Verify } from "@/lib/threeypay.server";

export const Route = createFileRoute("/api/public/pay-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ok = (msg = "SUCCESS") =>
          new Response(JSON.stringify({ code: msg }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("invalid", { status: 400 });
        }

        const sign = String(body.sign || "");
        if (!rsa2Verify(body, sign)) {
          console.error("[pay-notify] sign verify failed", body);
          return new Response("invalid sign", { status: 400 });
        }

        // 业务字段在 data 里（JSON 字符串或对象）
        let data: Record<string, unknown> = {};
        const rawData = body.data;
        try {
          data = typeof rawData === "string" ? JSON.parse(rawData) : ((rawData as Record<string, unknown>) || {});
        } catch {
          // ignore
        }

        const mchOrderNo = String(data.mchOrderNo ?? body.mchOrderNo ?? "");
        const state = Number(data.state ?? body.state ?? 0);
        const payAmount = Number(data.payAmount ?? body.payAmount ?? 0);
        const payOrderNo = String(data.payOrderNo ?? body.payOrderNo ?? "");

        if (!mchOrderNo) return ok();

        const { data: order } = await supabaseAdmin
          .from("payment_orders")
          .select("order_no, amount, status")
          .eq("order_no", mchOrderNo)
          .maybeSingle();
        if (!order) return ok();
        if (order.status === "paid") return ok();

        if (state !== 3) {
          if (state === 5 || state === 7) {
            await supabaseAdmin
              .from("payment_orders")
              .update({ status: state === 5 ? "closed" : "failed" })
              .eq("order_no", mchOrderNo);
          }
          return ok();
        }

        const expected = Number(order.amount);
        if (Math.abs(expected - payAmount) > 0.001) {
          console.error("[pay-notify] amount mismatch", { mchOrderNo, expected, payAmount });
          return new Response("amount mismatch", { status: 400 });
        }

        const { error } = await supabaseAdmin.rpc("mark_payment_paid", {
          _order_no: mchOrderNo,
          _amount: payAmount,
          _trade_no: payOrderNo,
        });
        if (error) {
          console.error("[pay-notify] rpc error", error);
          return new Response("error", { status: 500 });
        }
        return ok();
      },
      GET: async () => new Response("pay-notify endpoint"),
    },
  },
});
