// 3ypay 支付回调接收。该路径前缀 /api/public/* 在已发布站点会绕过登录鉴权。
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/pay-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const text = (msg: string, status = 200) =>
          new Response(msg, { status, headers: { "Content-Type": "text/plain" } });

        let body: Record<string, unknown> = {};
        const contentType = request.headers.get("content-type") || "";
        try {
          if (contentType.includes("application/json")) {
            body = await request.json();
          } else {
            const form = await request.formData();
            form.forEach((v, k) => {
              body[k] = typeof v === "string" ? v : "";
            });
          }
        } catch {
          return text("fail", 400);
        }

        const merchantOrderNo = String(body.merchantOrderNo ?? body.orderId ?? "");
        const tradeStatus = String(body.tradeStatus ?? "");
        const totalAmountCents = Number(body.totalAmount ?? 0);
        const tradeNo = String(body.tradeNo ?? "");

        if (!merchantOrderNo) return text("fail", 400);

        // 找不到订单时仍返回 success，避免重试堆积
        const { data: order } = await supabaseAdmin
          .from("payment_orders")
          .select("order_no, amount, status")
          .eq("order_no", merchantOrderNo)
          .maybeSingle();
        if (!order) return text("success");

        if (order.status === "paid") return text("success");

        if (tradeStatus !== "SUCCESS") {
          // 失败/关闭：可选地标记，不影响幂等返回
          if (tradeStatus === "CLOSED" || tradeStatus === "FAILED") {
            await supabaseAdmin
              .from("payment_orders")
              .update({ status: tradeStatus === "CLOSED" ? "closed" : "failed" })
              .eq("order_no", merchantOrderNo);
          }
          return text("success");
        }

        const amountYuan = Math.round(totalAmountCents) / 100;
        const expected = Number(order.amount);
        if (Math.abs(expected - amountYuan) > 0.001) {
          console.error("[pay-notify] amount mismatch", { merchantOrderNo, expected, amountYuan });
          return text("amount mismatch", 400);
        }

        const { error } = await supabaseAdmin.rpc("mark_payment_paid", {
          _order_no: merchantOrderNo,
          _amount: amountYuan,
          _trade_no: tradeNo,
        });
        if (error) {
          console.error("[pay-notify] rpc error", error);
          return text("error", 500);
        }
        return text("success");
      },

      GET: async () => new Response("pay-notify endpoint", { status: 200 }),
    },
  },
});
