// 3ypay 中转网关 (gw.nrnc.net) 异步通知。
// 网关已代为完成 RSA2 验签，业务端只需校验金额并幂等更新订单。
// 协议要求：处理完成必须返回纯文本 "success"，否则会重试 20 次。
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ok = () =>
  new Response("success", { status: 200, headers: { "Content-Type": "text/plain" } });

const fail = (msg: string, status = 400) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain" } });

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return new Response("pay-notify endpoint");
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // 兼容 JSON 与 application/x-www-form-urlencoded 两种格式
  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        const params = new URLSearchParams(text);
        body = Object.fromEntries(params.entries());
      }
    }
  } catch {
    return fail("invalid body");
  }

  console.log("[pay-notify] received", body);

  const merchantOrderNo = String(
    body.merchantOrderNo ?? body.orderId ?? body.mchOrderNo ?? "",
  );
  const tradeStatus = String(body.tradeStatus ?? "");
  const totalAmountFen = Number(body.totalAmount ?? body.amount ?? 0); // 单位：分
  const tradeNo = String(body.tradeNo ?? body.payOrderNo ?? "");

  if (!merchantOrderNo) {
    // 缺少订单号，直接返回 success 防止重试堆积
    return ok();
  }

  const { data: order } = await supabase
    .from("payment_orders")
    .select("order_no, amount, status")
    .eq("order_no", merchantOrderNo)
    .maybeSingle();
  if (!order) return ok();
  if (order.status === "paid") return ok();

  if (tradeStatus !== "SUCCESS") {
    if (tradeStatus === "CLOSED" || tradeStatus === "FAILED") {
      await supabase
        .from("payment_orders")
        .update({ status: tradeStatus === "CLOSED" ? "closed" : "failed" })
        .eq("order_no", merchantOrderNo);
    }
    return ok();
  }

  // totalAmount 单位是分，本地 amount 单位是元
  const expectedFen = Math.round(Number(order.amount) * 100);
  if (Math.abs(expectedFen - totalAmountFen) > 0) {
    console.error("[pay-notify] amount mismatch", {
      merchantOrderNo,
      expectedFen,
      totalAmountFen,
    });
    return fail("amount mismatch");
  }

  const { error } = await supabase.rpc("mark_payment_paid", {
    _order_no: merchantOrderNo,
    _amount: Number(order.amount),
    _trade_no: tradeNo,
  });
  if (error) {
    console.error("[pay-notify] rpc error", error);
    return fail("error", 500);
  }

  return ok();
});
