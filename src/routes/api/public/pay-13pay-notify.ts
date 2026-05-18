// 13pay / 彩虹易支付 异步通知
// notify_url 用 GET，验签通过后必须返回纯文本 "success"
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyEpay } from "@/lib/epay-sign";

const ok = () =>
  new Response("success", { status: 200, headers: { "Content-Type": "text/plain" } });
const failPlain = (msg: string, status = 400) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain" } });

async function log(
  orderNo: string | null,
  stage: string,
  level: "info" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  try {
    await supabaseAdmin.from("payment_logs").insert([
      {
        order_no: orderNo,
        source: "13pay-notify",
        stage,
        level,
        message,
        payload: payload as never,
      },
    ] as never);
  } catch (e) {
    console.error("[pay-13pay-notify] log failed", e);
  }
}

async function handle(params: Record<string, string>, mode: "GET" | "POST") {
  const orderNo = String(params.out_trade_no ?? "");
  await log(orderNo || null, "notify_received", "info", `收到 13pay 通知 (${mode})`, { params });

  const sign = String(params.sign ?? "");
  if (!sign) return failPlain("missing sign");

  // 取 13pay key
  const { data: chans } = await supabaseAdmin
    .from("payment_channels")
    .select("provider, config")
    .eq("is_enabled", true);
  const chan = (chans ?? []).find((c: { provider: string }) => c.provider === "13pay");
  const key = String(((chan?.config ?? {}) as Record<string, unknown>).key ?? "");
  if (!key) {
    await log(orderNo || null, "notify_verify", "error", "未配置 13pay key", {});
    return failPlain("no key", 500);
  }

  const verified = verifyEpay(params, sign, key);
  if (!verified) {
    await log(orderNo || null, "notify_verify", "error", "13pay 验签失败", { params });
    return failPlain("fail", 401);
  }

  if (!orderNo) return ok();
  if (params.trade_status !== "TRADE_SUCCESS") {
    await log(orderNo, "notify_processed", "info", `非成功状态：${params.trade_status}`, {});
    return ok();
  }

  const { data: order } = await supabaseAdmin
    .from("payment_orders")
    .select("order_no, amount, status")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order) return ok();
  if (order.status === "paid") return ok();

  const amountYuan = Number(params.money ?? 0);
  const expected = Number(order.amount);
  if (Math.abs(expected - amountYuan) > 0.01) {
    await log(orderNo, "notify_processed", "error", "金额不匹配", {
      expected, received: amountYuan,
    });
    return failPlain("amount mismatch");
  }

  const tradeNo = String(params.trade_no ?? "");
  const { error } = await supabaseAdmin.rpc("mark_payment_paid", {
    _order_no: orderNo,
    _amount: expected,
    _trade_no: tradeNo,
  });
  if (error) {
    await log(orderNo, "notify_processed", "error", `mark_payment_paid 失败：${error.message}`, { error });
    return failPlain("error", 500);
  }
  await log(orderNo, "notify_processed", "info", "订单已标记为已支付", { tradeNo, amountYuan });
  return ok();
}

export const Route = createFileRoute("/api/public/pay-13pay-notify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const params = Object.fromEntries(url.searchParams.entries());
        return handle(params, "GET");
      },
      POST: async ({ request }) => {
        const text = await request.text();
        const params = Object.fromEntries(new URLSearchParams(text).entries());
        return handle(params, "POST");
      },
    },
  },
});
