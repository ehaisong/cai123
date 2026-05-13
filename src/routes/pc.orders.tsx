import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search } from "lucide-react";

export const Route = createFileRoute("/pc/orders")({
  component: OrdersPage,
});

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "paid", label: "已支付" },
  { key: "pending", label: "待支付" },
  { key: "refunded", label: "已退款" },
  { key: "cancelled", label: "已取消" },
] as const;

function OrdersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [tab, setTab] = useState<string>("all");
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: ods } = await supabase.from("orders")
        .select("id,buyer_id,product_id,merchant_id,amount,agent_l1_id,agent_l2_id,status,paid_at,created_at")
        .order("created_at", { ascending: false }).limit(500);
      const list = ods ?? [];
      const buyerIds = Array.from(new Set(list.map((o: any) => o.buyer_id)));
      const mIds = Array.from(new Set(list.map((o: any) => o.merchant_id)));
      const pIds = Array.from(new Set(list.map((o: any) => o.product_id)));
      const agentPids = Array.from(new Set(list.flatMap((o: any) => [o.agent_l1_id, o.agent_l2_id]).filter(Boolean) as string[]));

      const [{ data: profs }, { data: ms }, { data: ps }, { data: agentProfs }] = await Promise.all([
        buyerIds.length ? supabase.from("profiles").select("user_id,nickname,phone,user_code").in("user_id", buyerIds) : Promise.resolve({ data: [] as any[] }),
        mIds.length ? supabase.from("merchants").select("id,shop_name").in("id", mIds) : Promise.resolve({ data: [] as any[] }),
        pIds.length ? supabase.from("products").select("id,title").in("id", pIds) : Promise.resolve({ data: [] as any[] }),
        agentPids.length ? supabase.from("profiles").select("id,user_id,nickname").in("id", agentPids) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pMap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
      const mMap = Object.fromEntries((ms ?? []).map((m: any) => [m.id, m.shop_name]));
      const prodMap = Object.fromEntries((ps ?? []).map((p: any) => [p.id, p.title]));
      const agentMap = Object.fromEntries((agentProfs ?? []).map((p: any) => [p.id, p]));

      setRows(list.map((o: any) => ({
        ...o,
        buyer: pMap[o.buyer_id],
        shop_name: mMap[o.merchant_id],
        product_title: prodMap[o.product_id],
        agent_l1: o.agent_l1_id ? agentMap[o.agent_l1_id] : null,
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let l = rows;
    if (tab !== "all") l = l.filter((o) => o.status === tab);
    if (kw.trim()) {
      const k = kw.toLowerCase();
      l = l.filter((o) =>
        o.id.includes(kw) ||
        o.buyer?.nickname?.toLowerCase().includes(k) ||
        o.buyer?.phone?.includes(kw) ||
        o.product_title?.toLowerCase().includes(k) ||
        o.shop_name?.toLowerCase().includes(k),
      );
    }
    return l;
  }, [rows, tab, kw]);

  const totalPaid = filtered.filter((o) => o.status === "paid").reduce((s, o) => s + Number(o.amount), 0);

  return (
    <div>
      <PcPageHeader title="订单管理" description={`共 ${rows.length} 条订单 · 当前筛选已支付合计 ${fmtMoney(totalPaid)}`} />
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 text-sm rounded-md ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="订单号/买家/商品/店铺" className="h-8 w-72" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>店铺</TableHead>
              <TableHead>商品</TableHead>
              <TableHead>买家</TableHead>
              <TableHead>归属代理</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>支付时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">暂无订单</TableCell></TableRow>}
            {filtered.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-xs font-mono text-muted-foreground">{o.id.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{o.shop_name ?? "—"}</TableCell>
                <TableCell className="text-sm">{o.product_title ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {o.buyer ? (
                    <Link to="/pc/users/buyer/$userId" params={{ userId: o.buyer_id }} className="hover:underline">
                      {o.buyer.nickname ?? "—"} <span className="text-xs text-muted-foreground">{o.buyer.phone ?? ""}</span>
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {o.agent_l1 ? (
                    <Link to="/pc/users/agent/$userId" params={{ userId: o.agent_l1.user_id }} className="hover:underline">{o.agent_l1.nickname ?? "—"}</Link>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(o.amount)}</TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded ${o.status === "paid" ? "bg-success/10 text-success" : o.status === "refunded" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>{o.status}</span></TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(o.paid_at ?? o.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
