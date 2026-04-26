import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/merchant/wallet")({
  component: MerchantWallet,
});

function MerchantWallet() {
  return (
    <RouteGuard title="商家钱包" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <MerchantWalletInner />
    </RouteGuard>
  );
}

function MerchantWalletInner() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState(100);
  const [channel, setChannel] = useState("微信");
  const [account, setAccount] = useState("");
  const [list, setList] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
    setBalance(Number(w?.balance ?? 0));
    const { data } = await supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
    setList(data ?? []);
  };
  useEffect(() => { load(); }, [user?.id]);

  const submit = async () => {
    if (amount <= 0 || amount > balance) { toast.error("金额无效"); return; }
    if (!account) { toast.error("请填写收款账号"); return; }
    const { error } = await supabase.rpc("submit_withdraw", { _amount: amount, _channel: channel, _account_info: account });
    if (error) { toast.error(error.message); return; }
    toast.success("提现申请已提交");
    setAccount("");
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="收益提现" />
      <div className="m-3 rounded-2xl p-5 text-white" style={{ background: "var(--gradient-orange)" }}>
        <div className="text-sm opacity-90">可提现余额</div>
        <div className="text-3xl font-bold mt-1">{balance.toFixed(2)}</div>
      </div>
      <div className="bg-card mx-3 p-4 rounded-xl space-y-3">
        <div><Label className="text-xs">提现金额</Label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div><Label className="text-xs">收款方式</Label>
          <select className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm mt-1" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option>微信</option><option>支付宝</option><option>银行卡</option>
          </select>
        </div>
        <div><Label className="text-xs">收款账号</Label><Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="收款人姓名 + 账号" /></div>
        <Button className="w-full" onClick={submit}>提交提现申请</Button>
      </div>

      <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">提现记录</div>
      <div className="bg-card mx-3 mb-6 rounded-xl divide-y divide-border">
        {list.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无记录</p>}
        {list.map((w) => (
          <div key={w.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm">{fmtMoney(w.amount)} · {w.channel}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(w.created_at)}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${w.status === "paid" ? "bg-success/10 text-success" : w.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
              {({ pending: "待审核", approved: "已通过", paid: "已打款", rejected: "已驳回" } as any)[w.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
