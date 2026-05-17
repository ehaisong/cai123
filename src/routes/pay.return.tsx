import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { PaymentService, type QueryOrderResponse } from "@/lib/payment-service";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/pay/return")({
  validateSearch: z.object({ orderNo: z.string().optional() }),
  component: PayReturnPage,
});

function PayReturnPage() {
  const { orderNo } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
  const [productId, setProductId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string | null>(null);

  useEffect(() => {
    if (!orderNo) {
      setStatus("failed");
      return;
    }
    let stopPolling: (() => void) | null = null;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    const handlePaid = (meta: { product_id?: string } | null, p: string | null) => {
      setStatus("success");
      setPurpose(p);
      const pid = meta?.product_id ?? null;
      setProductId(pid);
      if (p === "product_purchase" && pid) {
        redirectTimer = setTimeout(() => {
          navigate({ to: "/product/$productId", params: { productId: pid } });
        }, 600);
      } else if (p === "recharge") {
        redirectTimer = setTimeout(() => navigate({ to: "/wallet" }), 800);
      }
    };

    const init = async () => {
      const { data } = await supabase
        .from("payment_orders")
        .select("status, purpose, metadata")
        .eq("order_no", orderNo)
        .maybeSingle();
      const meta = (data?.metadata ?? {}) as { product_id?: string };
      if (meta.product_id) setProductId(meta.product_id);
      if (data?.status === "paid") {
        handlePaid(meta, data.purpose ?? null);
        return;
      }
      stopPolling = PaymentService.startPolling(
        orderNo,
        async (_r: QueryOrderResponse) => {
          const { data: d2 } = await supabase
            .from("payment_orders")
            .select("purpose, metadata")
            .eq("order_no", orderNo)
            .maybeSingle();
          const m2 = (d2?.metadata ?? {}) as { product_id?: string };
          handlePaid(m2, d2?.purpose ?? null);
        },
        () => setStatus("failed"),
        2000,
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
              <p className="mt-1 text-xs text-muted-foreground">
                如已完成支付请稍候，正在自动跳转
              </p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto text-success" />
              <p className="mt-4 text-lg font-semibold">支付成功</p>
              <p className="mt-1 text-xs text-muted-foreground">即将自动跳转…</p>
              <div className="mt-6">
                {purpose === "product_purchase" && productId ? (
                  <Button
                    className="w-full"
                    onClick={() =>
                      navigate({ to: "/product/$productId", params: { productId } })
                    }
                  >
                    立即查看内容
                  </Button>
                ) : (
                  <Button className="w-full" asChild>
                    <Link to="/">返回首页</Link>
                  </Button>
                )}
              </div>
            </>
          )}
          {status === "failed" && (
            <>
              <XCircle className="w-12 h-12 mx-auto text-destructive" />
              <p className="mt-4 font-semibold">支付未完成或已取消</p>
              <p className="mt-1 text-xs text-muted-foreground break-all">
                订单号：{orderNo}
              </p>
              <div className="mt-6 space-y-2">
                {productId && (
                  <Button
                    className="w-full"
                    onClick={() =>
                      navigate({ to: "/product/$productId", params: { productId } })
                    }
                  >
                    返回商品页重试
                  </Button>
                )}
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
