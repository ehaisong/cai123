// 3ypay 中转网关 (gw.nrnc.net) 异步通知。
// 网关已代为完成 RSA2 验签，业务端只需校验金额并幂等更新订单。
// 协议要求：处理完成必须返回纯文本 "success"，否则会重试 20 次。
// 字段（按文档）：mchOrderNo / payOrderNo / tradeStatus / orderAmount(元)
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

  // 兼容 JSON 与 application/x-www-form-urlencoded
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

  const merchantOrderNoEarly = String(
    body.mchOrderNo ?? body.merchantOrderNo ?? body.orderId ?? "",
  );
  // 先落库一条 raw 通知日志（不阻塞）
  try {
    await supabase.from("payment_logs").insert({
      order_no: merchantOrderNoEarly || null,
      source: "gateway-notify",
      stage: "notify_received",
      level: "info",
      message: `tradeStatus=${String(body.tradeStatus ?? body.status ?? "")}`,
      payload: body as Record<string, unknown>,
      ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
      user_agent: req.headers.get("user-agent") || null,
    });
  } catch (e) {
    console.error("[pay-notify] log insert failed", e);
  }

  // 文档字段优先，兼容老字段
  const merchantOrderNo = String(
    body.mchOrderNo ?? body.merchantOrderNo ?? body.orderId ?? "",
  );
  const tradeStatus = String(body.tradeStatus ?? body.status ?? "");
  // orderAmount 单位：元；兼容老回调 totalAmount(分)/amount(分)
  let amountYuan = 0;
  if (body.orderAmount !== undefined) {
    amountYuan = Number(body.orderAmount);
  } else if (body.totalAmount !== undefined) {
    amountYuan = Number(body.totalAmount) / 100;
  } else if (body.amount !== undefined) {
    amountYuan = Number(body.amount) / 100;
  }
  const tradeNo = String(body.payOrderNo ?? body.tradeNo ?? "");

  if (!merchantOrderNo) {
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

  // 金额比对（元，允许 1 分误差）
  const expected = Number(order.amount);
  if (Math.abs(expected - amountYuan) > 0.01) {
    console.error("[pay-notify] amount mismatch", {
      merchantOrderNo,
      expected,
      received: amountYuan,
      raw: body,
    });
    return fail("amount mismatch");
  }

  const { error } = await supabase.rpc("mark_payment_paid", {
    _order_no: merchantOrderNo,
    _amount: expected,
    _trade_no: tradeNo,
  });
  if (error) {
    console.error("[pay-notify] rpc error", error);
    return fail("error", 500);
  }

  return ok();
});
