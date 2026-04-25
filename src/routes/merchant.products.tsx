import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/products")({
  component: ProductsList,
});

function ProductsList() {
  const { user } = useAuth();
  const [list, setList] = useState<any[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
    if (!m) return;
    setMerchantId(m.id);
    const { data } = await supabase.from("products").select("id, title, price, status, result, publish_at, sales_count").eq("merchant_id", m.id).order("created_at", { ascending: false });
    setList(data ?? []);
  };
  useEffect(() => { load(); }, [user?.id]);

  const toggleStatus = async (p: any) => {
    const next = p.status === "published" ? "unpublished" : "published";
    const { error } = await supabase.from("products").update({ status: next }).eq("id", p.id);
    if (error) toast.error(error.message); else { toast.success("已更新"); load(); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商品管理" right={<Link to="/merchant/products/new" className="text-xs text-info">＋ 新增</Link>} />
      <main className="flex-1 px-3 py-3 space-y-2">
        {list.length === 0 && <p className="text-center py-12 text-muted-foreground text-sm">暂无商品</p>}
        {list.map((p) => (
          <div key={p.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex-1 pr-2 line-clamp-1">{p.title}</h3>
              <span className="text-primary font-semibold text-sm">{fmtMoney(p.price)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded ${p.status === "published" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {p.status === "published" ? "已上架" : p.status === "unpublished" ? "已下架" : "草稿"}
                </span>
                <span className="text-muted-foreground">销量 {p.sales_count}</span>
              </div>
              <span className="text-muted-foreground">{fmtDate(p.publish_at)}</span>
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => toggleStatus(p)}>
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
