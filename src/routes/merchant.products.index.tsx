import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtCredits } from "@/lib/format";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";


export const Route = createFileRoute("/merchant/products/")({
  component: ProductsList,
});

function ProductsList() {
  return (
    <RouteGuard title="我的发布" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

type ProductRow = {
  id: string; title: string; price: number; status: string; sales_count: number;
  kind: string | null;
  has_self_issue: boolean | null;
  types: string[] | null;
  is_presale: boolean | null;
  no_win_refund: boolean | null;
  latest_issue_no: string | null; latest_publish_at: string | null;
  latest_status: string | null; latest_result: string | null;
};



function Inner() {
  const { user } = useAuth();
  const [products, setProducts] = useState<ProductRow[]>([]);


  const load = async () => {
    if (!user) return;
    const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
    if (!m) return;

    const { data: ps } = await supabase
      .from("products")
      .select("id, title, price, status, sales_count, kind, has_self_issue, types, is_presale, no_win_refund")
      .eq("merchant_id", m.id)
      .order("created_at", { ascending: false });
    const ids = (ps ?? []).map((p) => p.id);
    let issuesMap = new Map<string, any>();
    if (ids.length > 0) {
      const { data: issues } = await supabase
        .from("product_issues")
        .select("product_id, issue_no, publish_at, status, result")
        .in("product_id", ids)
        .order("publish_at", { ascending: false });
      for (const it of issues ?? []) if (!issuesMap.has(it.product_id)) issuesMap.set(it.product_id, it);
    }
    setProducts(
      (ps ?? []).map((p) => {
        const it = issuesMap.get(p.id);
        return {
          ...p,
          latest_issue_no: it?.issue_no ?? null,
          latest_publish_at: it?.publish_at ?? null,
          latest_status: it?.status ?? null,
          latest_result: it?.result ?? null,
        } as ProductRow;
      })
    );
  };


  useEffect(() => { load(); }, [user?.id]);

  const toggleProductStatus = async (p: ProductRow) => {
    const next = p.status === "published" ? "unpublished" : "published";
    const { error } = await supabase.from("products").update({ status: next }).eq("id", p.id);
    if (error) toast.error(error.message); else { toast.success("已更新"); load(); }
  };

  const issueBadge = (p: ProductRow) => {
    if (!p.latest_issue_no) return <span className="text-muted-foreground">未添加期号</span>;
    if (p.latest_status !== "published") return <span className="text-muted-foreground">草稿/下架</span>;
    if (p.latest_result === "won") return <span className="text-success">✅ 中奖</span>;
    if (p.latest_result === "lost") return <span className="text-destructive">❌ 未中</span>;
    return <span className="text-warning">⏳ 待判定</span>;
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader
        title="我的发布"
        right={<Link to="/merchant/products/new" className="text-xs text-info">＋ 新建</Link>}
      />

      <div className="flex items-center justify-around bg-card border-b border-border">
        <div className="flex-1 text-center py-3 text-sm font-medium text-foreground relative">
          售卖中 ({products.filter((p) => p.status === "published").length})
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-primary rounded-full" />
        </div>
        <div className="flex-1 text-center py-3 text-sm text-muted-foreground">
          已停售 ({products.filter((p) => p.status !== "published").length})
        </div>
        <Link to="/merchant/products/new" className="flex-1 text-center py-3 text-sm text-info">
          +添加新方案
        </Link>
      </div>

      <main className="flex-1 px-3 py-3 space-y-2">
        {products.length === 0 && <p className="text-center py-12 text-muted-foreground text-sm">暂无方案</p>}
        {products.map((p) => (
          <div key={p.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex-1 pr-2 line-clamp-1">{p.title}</h3>
              <span className="text-primary font-semibold text-sm">{fmtCredits(p.price)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className={`px-1.5 py-0.5 rounded ${p.status === "published" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                {p.status === "published" ? "已上架" : p.status === "unpublished" ? "已下架" : "草稿"}
              </span>
              {(p.types ?? []).map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-accent text-primary">{t}</span>
              ))}
              {p.is_presale && <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning">预售</span>}
              {p.no_win_refund && <span className="px-1.5 py-0.5 rounded bg-info/10 text-info">不中退还</span>}
              <span className="text-muted-foreground ml-auto">销量 {p.sales_count}</span>
            </div>
            {p.has_self_issue && (
              <div className="mt-2 text-xs flex items-center gap-2">
                <span className="text-muted-foreground">最新期：</span>
                <span className="font-medium">{p.latest_issue_no ?? "—"}</span>
                {issueBadge(p)}
                <span className="text-muted-foreground ml-auto">{p.latest_publish_at ? fmtDate(p.latest_publish_at) : ""}</span>
              </div>
            )}
            <div className="mt-2 flex gap-2">
              {p.has_self_issue && (
                <Link to="/merchant/products/$productId/issues" params={{ productId: p.id }} className="flex-1">
                  <Button variant="default" size="sm" className="w-full">管理期数</Button>
                </Link>
              )}
              <Button variant="outline" size="sm" className="flex-1" onClick={() => toggleProductStatus(p)}>
                {p.status === "published" ? "下架" : "上架"}
              </Button>
              <Link to="/product/$productId" params={{ productId: p.id }} className="flex-1">
                <Button variant="outline" size="sm" className="w-full">预览</Button>
              </Link>
            </div>
          </div>
        ))}
      </main>

    </div>
  );
}
