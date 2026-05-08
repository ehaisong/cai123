// 3ypay 异步通知：RSA2 验签 + 校验金额 + mark_payment_paid
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { rsa2Verify } from "../_shared/threeypay.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ok = (msg = "SUCCESS") =>
  new Response(JSON.stringify({ code: msg }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return new Response("pay-notify endpoint");
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("invalid", { status: 400 });
  }

  const sign = String(body.sign || "");
  if (!rsa2Verify(body, sign)) {
    console.error("[pay-notify] sign verify failed", body);
    return new Response("invalid sign", { status: 400 });
  }

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

  const { data: order } = await supabase
    .from("payment_orders")
    .select("order_no, amount, status")
    .eq("order_no", mchOrderNo)
    .maybeSingle();
  if (!order) return ok();
  if (order.status === "paid") return ok();

  if (state !== 3) {
    if (state === 5 || state === 7) {
      await supabase
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

  const { error } = await supabase.rpc("mark_payment_paid", {
    _order_no: mchOrderNo,
    _amount: payAmount,
    _trade_no: payOrderNo,
  });
  if (error) {
    console.error("[pay-notify] rpc error", error);
    return new Response("error", { status: 500 });
  }
  return ok();
});
