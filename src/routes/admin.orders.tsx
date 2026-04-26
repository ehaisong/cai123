import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Search } from "lucide-react";

export const Route = createFileRoute("/admin/orders")({
  component: () => (
    <RouteGuard title="订单总览" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [orders, setOrders] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<Array<{ id: string; shop_name: string }>>([]);
  const [filterMerchant, setFilterMerchant] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("merchants").select("id, shop_name").eq("status", "approved").order("shop_name")
      .then(({ data }) => setMerchants(data ?? []));
  }, []);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("orders").select("id, amount, status, created_at, buyer_id, product_id, merchant_id")
      .order("created_at", { ascending: false }).limit(200);
    if (filterMerchant) q = q.eq("merchant_id", filterMerchant);
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
  useEffect(() => { load(); }, [filterMerchant]);

  const filtered = useMemo(() => orders.filter((o) =>
    !keyword.trim() ||
    o.product?.title?.toLowerCase().includes(keyword.toLowerCase()) ||
    o.buyer?.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
    o.buyer?.user_code?.toLowerCase().includes(keyword.toLowerCase()),
  ), [orders, keyword]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="订单总览" />
      <div className="bg-card border-b border-border px-3 py-2 space-y-2">
        <select className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm" value={filterMerchant} onChange={(e) => setFilterMerchant(e.target.value)}>
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
    </div>
  );
}
