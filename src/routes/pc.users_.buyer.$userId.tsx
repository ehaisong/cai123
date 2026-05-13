import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/pc/users/buyer/$userId")({
  component: BuyerDetail,
});

function BuyerDetail() {
  const { userId } = Route.useParams();
  const [profile, setProfile] = useState<any>(null);
  const [relation, setRelation] = useState<any>(null);
  const [upline, setUpline] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);

  const load = async () => {
    const [{ data: p }, { data: ar }, { data: w }, { data: ods }, { data: ts }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("agent_relations").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("orders").select("id,amount,status,created_at,paid_at,product_id").eq("buyer_id", userId).order("created_at", { ascending: false }).limit(100),
      supabase.from("wallet_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    ]);
    setProfile(p); setRelation(ar); setWallet(w);
    if (ar?.upline_id) {
      const { data: up } = await supabase.from("profiles").select("user_id,nickname,user_code,phone").eq("id", ar.upline_id).maybeSingle();
      setUpline(up);
    } else setUpline(null);

    const pids = Array.from(new Set((ods ?? []).map((o: any) => o.product_id)));
    const { data: prods } = pids.length ? await supabase.from("products").select("id,title").in("id", pids) : { data: [] as any[] };
    const pmap = Object.fromEntries((prods ?? []).map((p: any) => [p.id, p.title]));
    setOrders((ods ?? []).map((o: any) => ({ ...o, product_title: pmap[o.product_id] })));
    setTxs(ts ?? []);
  };
  useEffect(() => { load(); }, [userId]);

  const unbindUpline = async () => {
    if (!confirm("确定将该用户与代理解绑？")) return;
    const { error } = await supabase.from("agent_relations").update({ upline_id: null }).eq("user_id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success("已解绑"); load();
  };

  if (!profile) return <div className="text-sm text-muted-foreground">加载中…</div>;

  return (
    <div>
      <Link to="/pc/users" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-4 w-4 mr-1" />返回
      </Link>
      <PcPageHeader title={profile.nickname ?? "未命名"} description={`编号 ${profile.user_code} · 手机 ${profile.phone ?? "—"}`} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs text-muted-foreground">钱包余额</div>
          <div className="text-lg font-semibold mt-1">{fmtMoney(wallet?.balance ?? 0)}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs text-muted-foreground">累计充值</div>
          <div className="text-lg font-semibold mt-1">{fmtMoney(wallet?.total_recharge ?? 0)}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground">归属代理</div>
            <div className="text-sm font-medium mt-1">{upline ? `${upline.nickname ?? upline.user_code} · ${upline.phone ?? "—"}` : <span className="text-muted-foreground">未绑定</span>}</div>
          </div>
          {upline && <Button size="sm" variant="outline" className="text-destructive" onClick={unbindUpline}>解绑</Button>}
        </div>
      </div>

      <h3 className="text-sm font-medium mb-2">订单（{orders.length}）</h3>
      <div className="bg-card border border-border rounded-xl mb-6">
        <Table>
          <TableHeader><TableRow>
            <TableHead>订单</TableHead><TableHead>商品</TableHead><TableHead className="text-right">金额</TableHead><TableHead>状态</TableHead><TableHead>时间</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {orders.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">暂无订单</TableCell></TableRow>}
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-xs font-mono text-muted-foreground">{o.id.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{o.product_title ?? "—"}</TableCell>
                <TableCell className="text-right">{fmtMoney(o.amount)}</TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded ${o.status === "paid" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{o.status}</span></TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(o.paid_at ?? o.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h3 className="text-sm font-medium mb-2">钱包流水</h3>
      <div className="bg-card border border-border rounded-xl">
        <Table>
          <TableHeader><TableRow>
            <TableHead>类型</TableHead><TableHead className="text-right">金额</TableHead><TableHead className="text-right">余额</TableHead><TableHead>说明</TableHead><TableHead>时间</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {txs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">暂无流水</TableCell></TableRow>}
            {txs.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm">{t.type}</TableCell>
                <TableCell className={`text-right ${Number(t.amount) > 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(t.amount)}</TableCell>
                <TableCell className="text-right">{fmtMoney(t.balance_after)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.description ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(t.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
