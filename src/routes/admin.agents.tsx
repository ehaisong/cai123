import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Search } from "lucide-react";
import { AdminUserDetailExtras, OrdersLink } from "@/components/admin/user-detail-extras";

export const Route = createFileRoute("/admin/agents")({
  component: () => (
    <RouteGuard title="代理管理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [rows, setRows] = useState<any[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: sm, error } = await supabase
      .from("shop_memberships")
      .select("user_id, agent_code, merchant_id, joined_at, is_agent")
      .eq("is_agent", true)
      .order("joined_at", { ascending: false })
      .limit(1000);
    if (error) { reportRpcError(error, { op: "shop_memberships.select", scope: "AdminAgents" }); setLoading(false); return; }
    const userIds = Array.from(new Set((sm ?? []).map((a: any) => a.user_id)));
    const merchantIds = Array.from(new Set((sm ?? []).map((a: any) => a.merchant_id).filter(Boolean)));
    let pmap: Record<string, any> = {};
    let mmap: Record<string, any> = {};
    let wmap: Record<string, { commission: number; balance: number }> = {};
    if (userIds.length > 0) {
      const [{ data: ps }, { data: ws }] = await Promise.all([
        supabase.from("profiles").select("user_id, nickname, user_code, phone").in("user_id", userIds),
        supabase.from("wallets").select("user_id, total_commission, balance").in("user_id", userIds),
      ]);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
      (ws ?? []).forEach((w: any) => { wmap[w.user_id] = { commission: Number(w.total_commission), balance: Number(w.balance) }; });
    }
    if (merchantIds.length > 0) {
      const { data: ms } = await supabase.from("merchants").select("id, shop_name").in("id", merchantIds as string[]);
      mmap = Object.fromEntries((ms ?? []).map((m: any) => [m.id, m]));
    }
    setRows((sm ?? []).map((a: any) => ({
      ...a,
      created_at: a.joined_at,
      bound_merchant_id: a.merchant_id,
      profile: pmap[a.user_id],
      merchant: a.merchant_id ? mmap[a.merchant_id] : null,
      total_commission: wmap[a.user_id]?.commission ?? 0,
      balance: wmap[a.user_id]?.balance ?? 0,
    })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) =>
    !keyword.trim() ||
    r.profile?.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
    r.agent_code?.toLowerCase().includes(keyword.toLowerCase()) ||
    r.merchant?.shop_name?.toLowerCase().includes(keyword.toLowerCase()),
  ), [rows, keyword]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理管理" />
      <div className="bg-card border-b border-border px-3 py-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input className="h-8 text-sm" placeholder="搜索昵称/代理码/归属店铺" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-4 text-sm text-muted-foreground">加载中…</p>}
        {!loading && filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无代理</p>}
        {filtered.map((r) => (
          <button key={`${r.user_id}::${r.merchant_id ?? "_"}`} onClick={() => setSelected(r)} className="w-full text-left bg-card rounded-md p-3 hover:bg-accent">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">{r.profile?.nickname ?? "未命名"}</div>
              <span className="text-xs text-success">{fmtMoney(r.total_commission)} 累计佣金</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">代理码 {r.agent_code ?? "-"} · {r.profile?.phone ?? "-"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">归属店铺：{r.merchant?.shop_name ?? "未绑定"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">成为代理：{fmtDate(r.created_at)}</div>
          </button>
        ))}
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setSelected(null)}>
          <div className="w-full bg-card rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between sticky top-0 bg-card pb-2 -mx-4 px-4 border-b border-border">
              <h3 className="text-base font-medium">{selected.profile?.nickname ?? "未命名"}</h3>
              <button onClick={() => setSelected(null)} className="text-sm text-muted-foreground">关闭</button>
            </div>
            <div className="text-sm space-y-1">
              <div>代理码：{selected.agent_code ?? "-"}</div>
              <div>用户编号：{selected.profile?.user_code ?? "-"}</div>
              <div>手机号：{selected.profile?.phone ?? "-"}</div>
              <div>归属店铺：{selected.merchant?.shop_name ?? "未绑定"}</div>
              <div>成为代理：{fmtDate(selected.created_at)}</div>
            </div>
            <AdminUserDetailExtras
              userId={selected.user_id}
              asAgent
              ordersLink={<OrdersLink to="/admin/orders" search={{ agent_id: selected.user_id }} label="查看该代理的分成订单" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}
