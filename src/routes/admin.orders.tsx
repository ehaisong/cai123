import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Search, X } from "lucide-react";

type SearchParams = {
  merchant_id?: string;
  buyer_id?: string;
  agent_id?: string;
};

export const Route = createFileRoute("/admin/orders")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    merchant_id: typeof search.merchant_id === "string" ? search.merchant_id : undefined,
    buyer_id: typeof search.buyer_id === "string" ? search.buyer_id : undefined,
    agent_id: typeof search.agent_id === "string" ? search.agent_id : undefined,
  }),
  component: () => (
    <RouteGuard title="订单总览" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { merchant_id, buyer_id, agent_id } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<Array<{ id: string; shop_name: string }>>([]);
  const [filterMerchant, setFilterMerchant] = useState<string>(merchant_id ?? "");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { setFilterMerchant(merchant_id ?? ""); }, [merchant_id]);

  useEffect(() => {
    supabase.from("merchants").select("id, shop_name").eq("status", "approved").order("shop_name")
      .then(({ data }) => setMerchants(data ?? []));
  }, []);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("orders").select("id, amount, status, created_at, buyer_id, product_id, merchant_id, agent_l1_id, agent_l2_id")
      .order("created_at", { ascending: false }).limit(200);
    if (filterMerchant) q = q.eq("merchant_id", filterMerchant);
    if (buyer_id) q = q.eq("buyer_id", buyer_id);
    if (agent_id) q = q.or(`agent_l1_id.eq.${agent_id},agent_l2_id.eq.${agent_id}`);
    const { data, error } = await q;
    if (error) { reportRpcError(error, { op: "orders.select", scope: "AdminOrders" }); setLoading(false); return; }
    const list = data ?? [];
    const buyerIds = Array.from(new Set(list.map((o: any) => o.buyer_id)));
    const productIds = Array.from(new Set(list.map((o: any) => o.product_id)));
    const merchantIds = Array.from(new Set(list.map((o: any) => o.merchant_id)));
    const [{ data: ps }, { data: prods }, { data: ms }] = await Promise.all([
      buyerIds.length ? supabase.from("profiles").select("user_id, nickname, user_code").in("user_id", buyerIds) : Promise.resolve({ data: [] as any[] }),
      productIds.length ? supabase.from("products").select("id, title").in("id", productIds) : Promise.resolve({ data: [] as any[] }),
      merchantIds.length ? supabase.from("merchants").select("id, shop_name").in("id", merchantIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    const prodMap = Object.fromEntries((prods ?? []).map((p: any) => [p.id, p]));
    const mmap = Object.fromEntries((ms ?? []).map((m: any) => [m.id, m]));
    setOrders(list.map((o: any) => ({ ...o, buyer: pmap[o.buyer_id], product: prodMap[o.product_id], merchant: mmap[o.merchant_id] })));
    setLoading(false);
  };
  useEffect(() => { load(); }, [filterMerchant, buyer_id, agent_id]);

  const filtered = useMemo(() => orders.filter((o) =>
    !keyword.trim() ||
    o.product?.title?.toLowerCase().includes(keyword.toLowerCase()) ||
    o.buyer?.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
    o.buyer?.user_code?.toLowerCase().includes(keyword.toLowerCase()),
  ), [orders, keyword]);

  const hasContextFilter = !!buyer_id || !!agent_id;
  const clearContextFilter = () => navigate({ search: { merchant_id: filterMerchant || undefined } });

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="订单总览" />
      {hasContextFilter && (
        <div className="bg-warning/10 text-warning border-b border-warning/20 px-3 py-2 text-xs flex items-center justify-between">
          <span>已按 {buyer_id ? "买家" : "代理"} 过滤订单</span>
          <button onClick={clearContextFilter} className="flex items-center gap-1"><X className="h-3 w-3" />清除</button>
        </div>
      )}
      <div className="bg-card border-b border-border px-3 py-2 space-y-2">
        <select
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          value={filterMerchant}
          onChange={(e) => {
            const v = e.target.value;
            setFilterMerchant(v);
            navigate({ search: (prev) => ({ ...prev, merchant_id: v || undefined }) });
          }}
        >
          <option value="">全部商家</option>
          {merchants.map((m) => <option key={m.id} value={m.id}>{m.shop_name}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input className="h-8 text-sm" placeholder="搜索商品/买家昵称/编号" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
      </div>
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-4 text-sm text-muted-foreground">加载中…</p>}
        {!loading && filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无订单</p>}
        {filtered.map((o) => (
          <div key={o.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">{o.product?.title ?? "未知商品"}</div>
              <span className="text-sm font-semibold text-primary">{fmtMoney(o.amount)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{o.merchant?.shop_name ?? "-"} · 买家 {o.buyer?.nickname ?? "-"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{fmtDate(o.created_at)} · {o.status}</div>
          </div>
        ))}
      </main>
      <div className="px-3 pb-3 text-center">
        <Link to="/admin" className="text-xs text-muted-foreground">返回管理首页</Link>
      </div>
    </div>
  );
}
