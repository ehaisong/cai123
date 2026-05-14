import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { PaymentService, type QueryOrderResponse } from "@/lib/payment-service";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/pay/success")({
  validateSearch: z.object({ orderNo: z.string().optional() }),
  component: PaySuccessPage,
});

function PaySuccessPage() {
  const { orderNo } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
  const [info, setInfo] = useState<{ amount?: number; tradeNo?: string; purpose?: string; productId?: string } | null>(null);
  const [failedProductId, setFailedProductId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderNo) {
      setStatus("failed");
      return;
    }

    let stopPolling: (() => void) | null = null;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    const handlePaid = (
      d: { amount?: number | string | null; trade_no?: string | null; purpose?: string | null; metadata?: unknown },
      fallbackAmount?: number,
    ) => {
      const meta = (d.metadata ?? {}) as { product_id?: string };
      const productId = meta.product_id;
      setStatus("success");
      setInfo({
        amount: d.amount != null ? Number(d.amount) : fallbackAmount,
        tradeNo: d.trade_no ?? undefined,
        purpose: d.purpose ?? undefined,
        productId,
      });
      // 商品购买：短暂展示成功后自动跳到内容详情页
      if (d.purpose === "product_purchase" && productId) {
        redirectTimer = setTimeout(() => {
          navigate({ to: "/product/$productId", params: { productId } });
        }, 1200);
      }
    };

    const init = async () => {
      const { data } = await supabase
        .from("payment_orders")
        .select("status, amount, trade_no, purpose, metadata")
        .eq("order_no", orderNo)
        .maybeSingle();
      if (data?.status === "paid") {
        handlePaid(data);
        return;
      }
      stopPolling = PaymentService.startPolling(
        orderNo,
        async (r: QueryOrderResponse) => {
          const { data: d2 } = await supabase
            .from("payment_orders")
            .select("amount, trade_no, purpose, metadata")
            .eq("order_no", orderNo)
            .maybeSingle();
          if (d2) {
            handlePaid(d2, r.amount ? r.amount / 100 : undefined);
          } else {
            setStatus("success");
            setInfo({ amount: r.amount ? r.amount / 100 : undefined, tradeNo: r.tradeNo });
          }
        },
        () => setStatus("failed"),
      );
    };
    init();
    return () => {
      stopPolling?.();
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [orderNo, navigate]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="支付结果" />
      <div className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-sm p-6 text-center">
          {status === "loading" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
              <p className="mt-4 font-semibold">正在确认支付结果…</p>
              <p className="mt-1 text-xs text-muted-foreground">请稍候，最长等待 5 分钟</p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto text-success" />
              <p className="mt-4 text-lg font-semibold">支付成功</p>
              {info?.amount != null && (
                <p className="mt-2 text-2xl font-bold">¥{info.amount.toFixed(2)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground break-all">订单号：{orderNo}</p>
              {info?.tradeNo && (
                <p className="mt-1 text-xs text-muted-foreground break-all">流水号：{info.tradeNo}</p>
              )}
              <div className="mt-6 flex gap-2">
                {info?.purpose === "product_purchase" && info?.productId ? (
                  <Button
                    className="flex-1"
                    onClick={() => navigate({ to: "/product/$productId", params: { productId: info.productId! } })}
                  >
                    立即查看内容
                  </Button>
                ) : info?.purpose === "recharge" ? (
                  <Button className="flex-1" onClick={() => navigate({ to: "/wallet" })}>
                    返回钱包
                  </Button>
                ) : (
                  <Button className="flex-1" asChild>
                    <Link to="/">返回首页</Link>
                  </Button>
                )}
              </div>
              {info?.purpose === "product_purchase" && info?.productId && (
                <p className="mt-2 text-[11px] text-muted-foreground">即将自动跳转…</p>
              )}
            </>
          )}
          {status === "failed" && (
            <>
              <XCircle className="w-12 h-12 mx-auto text-destructive" />
              <p className="mt-4 font-semibold">支付未完成</p>
              <p className="mt-1 text-xs text-muted-foreground">如已扣款，请稍后查看订单或联系客服</p>
              <p className="mt-1 text-xs text-muted-foreground break-all">订单号：{orderNo}</p>
              <div className="mt-6">
                <Button variant="outline" asChild className="w-full">
                  <Link to="/">返回首页</Link>
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
