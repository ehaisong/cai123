// 3ypay 异步支付通知（暴露在 https://66cai.site/api/public/pay-notify）
// 文档：https://doc.3ypay.com/doc-8005019 (RSA2 验签规则)
// 处理完必须返回纯文本 "success"，否则 3ypay 会重试。
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRSA2 } from "@/lib/threeypay-verify";

const ok = () =>
  new Response("success", { status: 200, headers: { "Content-Type": "text/plain" } });
const fail = (msg: string, status = 400) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain" } });

async function logNotify(
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
        source: "3ypay-notify",
        stage,
        level,
        message,
        payload: payload as never,
      },
    ] as never);
  } catch (e) {
    console.error("[pay-notify] log failed", e);
  }
}

export const Route = createFileRoute("/api/public/pay-notify")({
  server: {
    handlers: {
      GET: async () => new Response("3ypay notify endpoint"),
      POST: async ({ request }) => {
        try {
          const ct = request.headers.get("content-type") || "";
          let body: Record<string, unknown> = {};
          try {
            if (ct.includes("application/json")) {
              body = await request.json();
            } else {
              const text = await request.text();
              try {
                body = JSON.parse(text);
              } catch {
                body = Object.fromEntries(new URLSearchParams(text).entries());
              }
            }
          } catch {
            return fail("invalid body");
          }

          // 取业务参数（bizContent 是 JSON 字符串）
          let biz: Record<string, any> = {};
          if (typeof body.bizContent === "string") {
            try {
              biz = JSON.parse(body.bizContent as string);
            } catch {
              biz = {};
            }
          } else if (body.bizContent && typeof body.bizContent === "object") {
            biz = body.bizContent as Record<string, any>;
          }
          const merchantOrderNo = String(biz.mchOrderNo ?? body.mchOrderNo ?? "");

          await logNotify(merchantOrderNo || null, "notify_received", "info", "收到 3ypay 通知", {
            headers: Object.fromEntries(request.headers.entries()),
            body,
            biz,
          });

          // 取通道配置中的平台公钥用于验签
          const { data: chans } = await supabaseAdmin
            .from("payment_channels")
            .select("provider, config")
            .eq("is_enabled", true);
          const chan =
            (chans ?? []).find((c: any) => c.provider === "3ypay") ??
            (chans ?? []).find((c: any) => c.provider === "wechat") ??
            (chans ?? []).find((c: any) => c.provider === "alipay");
          const platformPublicKey = (chan?.config as any)?.platformPublicKey;

          // 验签
          const sign = String(body.sign || "");
          if (!platformPublicKey || !sign) {
            await logNotify(merchantOrderNo || null, "notify_verify", "error", "缺少平台公钥或 sign", {
              hasPub: !!platformPublicKey,
              hasSign: !!sign,
            });
            return fail("missing sign");
          }
          const verified = await verifyRSA2(body, sign, platformPublicKey);
          if (!verified) {
            await logNotify(merchantOrderNo || null, "notify_verify", "error", "RSA2 验签失败", {
              body,
            });
            return fail("invalid sign", 401);
          }

          if (!merchantOrderNo) {
            return ok();
          }

          const { data: order } = await supabaseAdmin
            .from("payment_orders")
            .select("order_no, amount, status")
            .eq("order_no", merchantOrderNo)
            .maybeSingle();
          if (!order) return ok();
          if (order.status === "paid") return ok();

          // 状态判断：3ypay state 字段（2=支付成功，3=失败，4=已取消，5=已退款）
          const state = Number(biz.state ?? body.state ?? 0);
          const tradeStatus = state === 2
            ? "SUCCESS"
            : state === 3
              ? "FAILED"
              : state === 4
                ? "CLOSED"
                : "WAIT";

          if (tradeStatus !== "SUCCESS") {
            if (tradeStatus === "CLOSED" || tradeStatus === "FAILED") {
              await supabaseAdmin
                .from("payment_orders")
                .update({ status: tradeStatus === "CLOSED" ? "closed" : "failed" })
                .eq("order_no", merchantOrderNo);
            }
            return ok();
          }

          // 金额校验（元）
          const amountYuan = Number(biz.orderAmount ?? body.orderAmount ?? 0);
          const expected = Number(order.amount);
          if (Math.abs(expected - amountYuan) > 0.01) {
            await logNotify(merchantOrderNo, "notify_processed", "error", "金额不匹配", {
              expected,
              received: amountYuan,
            });
            return fail("amount mismatch");
          }

          const tradeNo = String(biz.payOrderNo ?? body.payOrderNo ?? "");
          const { error } = await supabaseAdmin.rpc("mark_payment_paid", {
            _order_no: merchantOrderNo,
            _amount: expected,
            _trade_no: tradeNo,
          });
          if (error) {
            await logNotify(merchantOrderNo, "notify_processed", "error", `mark_payment_paid 失败：${error.message}`, {
              error,
            });
            return fail("error", 500);
          }

          await logNotify(merchantOrderNo, "notify_processed", "info", "订单已标记为已支付", {
            tradeNo,
            amountYuan: expected,
          });
          return ok();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const stack = e instanceof Error ? e.stack : undefined;
          console.error("[pay-notify] unhandled error", msg, stack);
          // 也尝试写日志，但避免再次抛错
          try { await logNotify(null, "notify_unhandled", "error", `未处理异常：${msg}`, { stack }); } catch {}
          return new Response(`error: ${msg}`, { status: 500, headers: { "Content-Type": "text/plain" } });
        }
      },
    },
  },
});
