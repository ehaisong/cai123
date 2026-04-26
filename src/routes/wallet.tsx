import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

interface Withdrawal {
  id: string;
  amount: number;
  channel: string | null;
  status: "pending" | "approved" | "paid" | "rejected";
  created_at: string;
}

function WalletPage() {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const canWithdraw = roles.includes("agent") || roles.includes("merchant");
  const [balance, setBalance] = useState(0);
  const [totalCommission, setTotalCommission] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [channel, setChannel] = useState("微信");
  const [account, setAccount] = useState("");
  const [list, setList] = useState<Withdrawal[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: w } = await supabase
      .from("wallets")
      .select("balance, total_commission")
      .eq("user_id", user.id)
      .maybeSingle();
    setBalance(Number(w?.balance ?? 0));
    setTotalCommission(Number(w?.total_commission ?? 0));
    const { data } = await supabase
      .from("withdrawals")
      .select("id, amount, channel, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setList((data as Withdrawal[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  if (!user) {
    return (
      <div className="h5-shell">
        <PageHeader title="我的钱包" />
        <div className="p-6 text-center">
          <Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button>
        </div>
      </div>
    );
  }

  if (!canWithdraw) {
    return (
      <div className="h5-shell">
        <PageHeader title="我的钱包" />
        <div className="p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">钱包仅对代理和商家开放</p>
          <p className="text-xs text-muted-foreground">普通用户无需充值，购买后由平台直接结算</p>
          <Button variant="outline" onClick={() => navigate({ to: "/profile" })}>返回个人中心</Button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (amount <= 0) {
      toast.error("请输入提现金额");
      return;
    }
    if (amount > balance) {
      toast.error("提现金额超过可用余额");
      return;
    }
    if (!account.trim()) {
      toast.error("请填写收款账号");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("submit_withdraw", {
      _amount: amount,
      _channel: channel,
      _account_info: account,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("提现申请已提交，请等待审核");
    setAccount("");
    setAmount(0);
    load();
  };

  const statusMap: Record<string, { label: string; cls: string }> = {
    pending: { label: "待审核", cls: "bg-warning/10 text-warning" },
    approved: { label: "已通过", cls: "bg-info/10 text-info" },
    paid: { label: "已打款", cls: "bg-success/10 text-success" },
    rejected: { label: "已驳回", cls: "bg-destructive/10 text-destructive" },
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader
        title="我的钱包"
        right={<Link to="/wallet/transactions" className="text-xs text-info">资金明细</Link>}
      />

      <Card className="mx-3 mt-3 p-5 text-white border-0" style={{ background: "var(--gradient-orange)" }}>
        <div className="text-sm opacity-90">可提现余额（元）</div>
        <div className="mt-1 text-4xl font-bold">{balance.toFixed(2)}</div>
        <div className="mt-3 text-xs opacity-80">累计佣金收益 ¥{totalCommission.toFixed(2)}</div>
      </Card>

      <Card className="mx-3 mt-3 p-4 space-y-3">
        <h3 className="text-sm font-medium">申请提现</h3>
        <div>
          <Label className="text-xs">提现金额</Label>
          <Input
            type="number"
            min={1}
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value))}
            placeholder="请输入提现金额"
          />
          <button
            type="button"
            className="mt-1 text-xs text-info"
            onClick={() => setAmount(balance)}
          >
            全部提现 ¥{balance.toFixed(2)}
          </button>
        </div>
        <div>
          <Label className="text-xs">收款方式</Label>
          <select
            className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm mt-1"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option>微信</option>
            <option>支付宝</option>
            <option>银行卡</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">收款账号</Label>
          <Input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="收款人姓名 + 账号"
          />
        </div>
        <Button className="w-full" size="lg" onClick={submit} disabled={submitting}>
          {submitting ? "提交中…" : `提交提现 ${amount > 0 ? fmtMoney(amount) : ""}`}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center pt-1">
          钱包余额来自代理/商家分成，提现需平台审核后打款
        </p>
      </Card>

      <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">提现记录</div>
      <div className="bg-card mx-3 mb-6 rounded-xl divide-y divide-border">
        {list.length === 0 && (
          <p className="text-center py-8 text-sm text-muted-foreground">暂无记录</p>
        )}
        {list.map((w) => (
          <div key={w.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm">{fmtMoney(w.amount)} · {w.channel ?? "-"}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(w.created_at)}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${statusMap[w.status]?.cls ?? "bg-muted text-muted-foreground"}`}>
              {statusMap[w.status]?.label ?? w.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
