import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/product/$productId")({
  component: ProductDetailPage,
});

interface Product {
  id: string; merchant_id: string; title: string; subtitle: string | null;
  is_recommended: boolean; price: number; paid_content: string | null;
  disclaimer: string | null; publish_at: string; reveal_at: string | null;
  result: "pending" | "won" | "lost"; result_note: string | null;
}
interface History { id: string; issue_no: string; content: string; result: string; publish_at: string; }

function ProductDetailPage() {
  const { productId } = useParams({ from: "/product/$productId" });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [purchased, setPurchased] = useState(false);
  const [buying, setBuying] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("products").select("id, merchant_id, title, subtitle, is_recommended, price, paid_content, disclaimer, publish_at, reveal_at, result, result_note").eq("id", productId).maybeSingle();
    setProduct(data as Product | null);
    const { data: hist } = await supabase.from("product_history").select("id, issue_no, content, result, publish_at").eq("product_id", productId).order("publish_at", { ascending: false }).limit(10);
    setHistory(hist ?? []);
    if (user) {
      const { data: ord } = await supabase.from("orders").select("id").eq("buyer_id", user.id).eq("product_id", productId).eq("status", "paid").maybeSingle();
      setPurchased(!!ord);
    } else {
      setPurchased(false);
    }
  };

  useEffect(() => { load(); }, [productId, user?.id]);

  const handleBuy = async () => {
    if (!user) { navigate({ to: "/auth/login", search: { redirect: `/product/${productId}` } }); return; }
    setBuying(true);
    const { error } = await supabase.rpc("purchase_product", { _product_id: productId });
    setBuying(false);
    if (error) {
      if (error.message.includes("余额")) {
        toast.error(error.message);
        setTimeout(() => navigate({ to: "/wallet" }), 800);
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.success("购买成功，已解锁内容");
    load();
  };

  if (!product) {
    return (
      <div className="h5-shell">
        <PageHeader title="我的思考日志" />
        <p className="text-center py-20 text-muted-foreground text-sm">加载中…</p>
      </div>
    );
  }

  const stamp = product.result === "won" ? <div className="stamp stamp-won">中奖</div> : product.result === "lost" ? <div className="stamp stamp-lost">未中</div> : null;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="我的思考日志" />

      {/* 标题卡 */}
      <div className="bg-card mx-3 mt-3 rounded-xl p-4 relative">
        <h2 className="text-lg font-bold pr-16">{product.title}</h2>
        {product.is_recommended && (
          <div className="mt-2">
            <span className="inline-block text-xs text-primary-foreground bg-primary px-3 py-0.5 rounded">★ 强烈推荐 ★</span>
          </div>
        )}
        <div className="mt-3 text-sm text-muted-foreground">发布于 <span className="text-foreground">{fmtDate(product.publish_at)}</span></div>
        {product.reveal_at && (
          <div className="mt-1 text-sm text-muted-foreground">公开于 <span className="text-warning">{fmtDate(product.reveal_at)}</span></div>
        )}
        {stamp && <div className="absolute top-3 right-3">{stamp}</div>}
      </div>

      {/* 免责声明 */}
      <div className="bg-card mx-3 mt-3 rounded-xl p-4">
        <div className="mb-2"><span className="text-xs text-warning bg-warning/10 px-2 py-1 rounded">免责声明</span></div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {product.disclaimer ?? "本付费内容为电子虚拟物品，解锁后不支持退款，所有文字、图片仅供参考，不保证连续性及任何承诺，自愿付费谨慎购买下单，购买即接受协议，本声明具有法律效力依据，请悉知！"}
        </p>
      </div>

      {/* 付费内容 */}
      <div className="bg-card mx-3 mt-3 rounded-xl p-4">
        <div className="mb-2"><span className="text-xs text-primary bg-accent px-2 py-1 rounded">付费内容</span></div>
        {purchased ? (
          <div className="text-base text-foreground whitespace-pre-wrap leading-relaxed">
            {product.paid_content ?? "（暂无内容）"}
          </div>
        ) : (
          <div className="py-4">
            <div className="bg-muted rounded-lg py-8 text-center mb-3">
              <p className="text-muted-foreground text-sm">🔒 内容已加密，购买后查看</p>
            </div>
            <Button className="w-full bg-primary hover:bg-primary/90" size="lg" onClick={handleBuy} disabled={buying}>
              {buying ? "处理中…" : `立即购买 ${fmtMoney(product.price)}`}
            </Button>
          </div>
        )}
      </div>

      {/* 往期记录 */}
      <div className="bg-card mx-3 mt-3 mb-6 rounded-xl p-4">
        <div className="mb-3"><span className="text-xs text-info bg-info/10 px-2 py-1 rounded">往期记录</span></div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">暂无往期记录</p>
        ) : (
          <div className="divide-y divide-border">
            {history.map((h) => (
              <div key={h.id} className="py-3 relative">
                <div className="text-sm">{h.issue_no}</div>
                <div className="text-warning text-base font-medium mt-1">{h.content}</div>
                <div className="text-xs text-muted-foreground mt-1">发布于：{fmtDate(h.publish_at)}</div>
                <div className="absolute right-0 top-3">
                  {h.result === "won" ? <div className="stamp stamp-won">中奖</div> : <div className="stamp stamp-lost">未中</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
