import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentService, type PayType } from "@/lib/payment-service";
import { toast } from "sonner";
import { reportRpcError } from "@/lib/error-logger";

export const Route = createFileRoute("/pay/test")({
  component: PayTestPage,
});

function PayTestPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<number>(1);
  const [submitting, setSubmitting] = useState<PayType | null>(null);
  const isWechat = PaymentService.isWechat();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth/login" });
  }, [loading, user, navigate]);

  const handlePay = async (payType: PayType) => {
    if (!user) return;
    if (!Number.isFinite(amount) || amount < 1) {
      toast.error("网关最低支付金额为 1 元");
      return;
    }
    setSubmitting(payType);
    const subject = `支付通道测试 ¥${amount.toFixed(2)}`;
    const { data: orderNo, error } = await supabase.rpc("create_payment_order", {
      _amount: amount,
      _pay_type: payType,
      _subject: subject,
      _purpose: "test",
    });
    if (error || !orderNo) {
      reportRpcError(error, { op: "rpc:create_payment_order", scope: "PayTest" });
      setSubmitting(null);
      return;
    }
    try {
      await PaymentService.pay({
        orderNo: orderNo as string,
        amountYuan: amount,
        payType,
        subject,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "支付发起失败";
      toast.error(msg);
      setSubmitting(null);
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="支付通道测试" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <Card className="p-4 space-y-3">
          <div>
            <Label className="text-xs">测试金额（元）</Label>
            <Input
              type="number"
              step="1"
              min="1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              网关最低支付金额 1 元；测试订单不会加到钱包余额。
            </p>
          </div>

          <div className="text-xs rounded-md bg-muted p-3 leading-relaxed text-muted-foreground">
            <p>当前环境：<strong>{isWechat ? "微信内" : "外部浏览器"}</strong></p>
            <p>支付通道：gw.nrnc.net 中转 v2（13pay JSAPI=jump，H5/支付宝=jump，桌面=qrcode）</p>
          </div>

          {isWechat ? (
            <Button
              size="lg"
              className="w-full"
              disabled={submitting !== null}
              onClick={() => handlePay("wechat")}
            >
              {submitting === "wechat" ? "正在拉起支付…" : "微信支付"}
            </Button>
          ) : (
            <div className="space-y-2">
              <Button
                size="lg"
                className="w-full"
                disabled={submitting !== null}
                onClick={() => handlePay("alipay")}
              >
                {submitting === "alipay" ? "正在拉起支付…" : "支付宝支付"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full"
                disabled={submitting !== null}
                onClick={() => handlePay("wechat")}
              >
                {submitting === "wechat" ? "正在拉起支付…" : "微信支付（H5）"}
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">测试说明</h3>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>点击支付按钮 → 跳转网关收银台 → 完成支付。</li>
            <li>支付完成后跳回 /pay/success 页面，前端轮询订单状态。</li>
            <li>3ypay 异步回调本站 /api/public/pay-notify，将订单状态更新为 paid。</li>
            <li>测试订单（purpose=test）不会自动给钱包加款；充值订单会自动入账。</li>
            <li>如需查看回调详细日志，请在 Vercel/Cloudflare 日志中搜索 pay-notify。</li>
          </ol>
        </Card>
      </main>
    </div>
  );
}
