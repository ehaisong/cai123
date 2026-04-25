import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

const PRESETS = [10, 30, 50, 100, 300, 500];

function WalletPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState<number>(50);

  useEffect(() => {
    if (!user) return;
    supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle().then(({ data }) => setBalance(Number(data?.balance ?? 0)));
  }, [user?.id]);

  if (!user) {
    return <div className="h5-shell"><PageHeader title="我的钱包" /><div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div></div>;
  }

  const handlePay = (channel: "wechat" | "alipay") => {
    toast.info(`即将跳转${channel === "wechat" ? "微信" : "支付宝"}支付（待对接商户号）`);
    // 示意：实际接入时调用后端 server function 创建订单并返回支付参数
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="我的钱包" right={<Link to="/wallet/transactions" className="text-xs text-info">明细</Link>} />

      <Card className="mx-3 mt-3 p-5 text-white border-0" style={{ background: "var(--gradient-orange)" }}>
        <div className="text-sm opacity-90">当前余额（元）</div>
        <div className="mt-1 text-4xl font-bold">{balance.toFixed(2)}</div>
      </Card>

      <Card className="mx-3 mt-3 p-4">
        <h3 className="text-sm font-medium mb-3">充值金额</h3>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className={`rounded-md py-3 text-sm border ${amount === v ? "border-primary bg-accent text-primary font-bold" : "border-border bg-card text-foreground"}`}
            >
              ¥{v}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <label className="text-xs text-muted-foreground">自定义</label>
          <Input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
      </Card>

      <Card className="mx-3 mt-3 p-4 space-y-3">
        <h3 className="text-sm font-medium">选择支付方式</h3>
        <Button className="w-full bg-success hover:bg-success/90 text-success-foreground" size="lg" onClick={() => handlePay("wechat")}>
          微信支付 {fmtMoney(amount)}
        </Button>
        <Button className="w-full bg-info hover:bg-info/90 text-info-foreground" size="lg" onClick={() => handlePay("alipay")}>
          支付宝 {fmtMoney(amount)}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center pt-2">
          支付暂未开通，请联系平台管理员手动充值
        </p>
      </Card>
    </div>
  );
}
