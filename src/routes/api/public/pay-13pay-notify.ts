// 13pay 异步/同步支付通知
// 文档：https://pay.13pay.cn/doc/pay_notify.html
// 通知方式：GET（异步 notify_url 与同步 return_url 都用 GET）
// 验签：用平台公钥 SHA256withRSA 验 sign，剔除 sign / sign_type / 空值
// 成功后必须返回纯文本 "success"
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verify13 } from "@/lib/thirteenpay";

const ok = () =>
  new Response("success", { status: 200, headers: { "Content-Type": "text/plain" } });
const fail = (msg: string, status = 400) =>
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
  if (!sign) return fail("missing sign");

  // 取平台公钥
  const { data: chans } = await supabaseAdmin
    .from("payment_channels")
    .select("provider, config")
    .eq("is_enabled", true);
  const chan = (chans ?? []).find((c: { provider: string }) => c.provider === "13pay");
  const platformPublicKey = String(((chan?.config ?? {}) as Record<string, unknown>).platformPublicKey ?? "");
  if (!platformPublicKey) {
    await log(orderNo || null, "notify_verify", "error", "未配置 13pay 平台公钥", {});
    return fail("no public key", 500);
  }

  const verified = await verify13(params, sign, platformPublicKey);
  if (!verified) {
    await log(orderNo || null, "notify_verify", "error", "13pay 验签失败", { params });
    return fail("invalid sign", 401);
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

  // 金额校验
  const amountYuan = Number(params.money ?? 0);
  const expected = Number(order.amount);
  if (Math.abs(expected - amountYuan) > 0.01) {
    await log(orderNo, "notify_processed", "error", "金额不匹配", {
      expected, received: amountYuan,
    });
    return fail("amount mismatch");
  }

  const tradeNo = String(params.trade_no ?? params.api_trade_no ?? "");
  const { error } = await supabaseAdmin.rpc("mark_payment_paid", {
    _order_no: orderNo,
    _amount: expected,
    _trade_no: tradeNo,
  });
  if (error) {
    await log(orderNo, "notify_processed", "error", `mark_payment_paid 失败：${error.message}`, { error });
    return fail("error", 500);
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
        // 13pay 默认 GET，但兼容 POST form
        const text = await request.text();
        const params = Object.fromEntries(new URLSearchParams(text).entries());
        return handle(params, "POST");
      },
    },
  },
});
