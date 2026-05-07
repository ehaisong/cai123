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
  const [info, setInfo] = useState<{ amount?: number; tradeNo?: string; purpose?: string } | null>(null);

  useEffect(() => {
    if (!orderNo) {
      setStatus("failed");
      return;
    }

    let stopPolling: (() => void) | null = null;

    const init = async () => {
      // 先看本地订单状态（如果回调已经入账）
      const { data } = await supabase
        .from("payment_orders")
        .select("status, amount, trade_no, purpose")
        .eq("order_no", orderNo)
        .maybeSingle();
      if (data?.status === "paid") {
        setStatus("success");
        setInfo({ amount: Number(data.amount), tradeNo: data.trade_no ?? undefined, purpose: data.purpose });
        return;
      }
      const purpose = data?.purpose;
      stopPolling = PaymentService.startPolling(
        orderNo,
        async (r: QueryOrderResponse) => {
          // 网关已成功；再查一次本地订单获取最新状态
          const { data: d2 } = await supabase
            .from("payment_orders")
            .select("amount, trade_no, purpose")
            .eq("order_no", orderNo)
            .maybeSingle();
          setStatus("success");
          setInfo({
            amount: d2?.amount ? Number(d2.amount) : (r.amount ? r.amount / 100 : undefined),
            tradeNo: d2?.trade_no ?? r.tradeNo,
            purpose: d2?.purpose ?? purpose,
          });
        },
        () => setStatus("failed"),
      );
    };
    init();
    return () => {
      stopPolling?.();
    };
  }, [orderNo]);

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
                {info?.purpose === "recharge" ? (
                  <Button className="flex-1" onClick={() => navigate({ to: "/wallet" })}>
                    返回钱包
                  </Button>
                ) : (
                  <Button className="flex-1" asChild>
                    <Link to="/">返回首页</Link>
                  </Button>
                )}
              </div>
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
