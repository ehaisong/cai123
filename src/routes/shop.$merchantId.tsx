import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { fmtDate, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/shop/$merchantId")({
  component: ShopPage,
});

interface Product {
  id: string;
  title: string;
  is_recommended: boolean;
  price: number;
  publish_at: string;
  category_id: string;
}
interface Category { id: string; name: string; code: string; }
interface Merchant {
  id: string; shop_name: string; shop_avatar_url: string | null; shop_description: string | null;
}
interface Announcement { id: string; title: string; content: string | null; created_at: string; }

function ShopPage() {
  const { merchantId } = useParams({ from: "/shop/$merchantId" });
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [ann, setAnn] = useState<Announcement | null>(null);

  useEffect(() => {
    supabase.from("merchants").select("id, shop_name, shop_avatar_url, shop_description").eq("id", merchantId).maybeSingle().then(({ data }) => setMerchant(data));
    supabase.from("lottery_categories").select("id, name, code").order("sort_order").then(({ data }) => setCategories(data ?? []));
    supabase.from("products").select("id, title, is_recommended, price, publish_at, category_id").eq("merchant_id", merchantId).eq("status", "published").order("is_recommended", { ascending: false }).order("publish_at", { ascending: false }).then(({ data }) => setProducts(data ?? []));
    supabase.from("announcements").select("id, title, content, created_at").eq("is_active", true).order("created_at", { ascending: false }).limit(1).then(({ data }) => setAnn(data?.[0] ?? null));
  }, [merchantId]);

  const filtered = products
    .filter((p) => activeCat === "all" || p.category_id === activeCat)
    .filter((p) => !keyword || p.title.includes(keyword));

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title={merchant?.shop_name ?? "店铺"} />

      {/* 商家头像横条 */}
      <div className="bg-card flex items-center justify-center gap-2 py-2 border-b border-border">
        <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-sm">🍱</div>
        <span className="text-sm font-medium">{merchant?.shop_name ?? "—"}</span>
      </div>

      {/* 公告广告位 */}
      {ann && (
        <div className="mx-3 mt-3 rounded-xl p-3 text-white" style={{ background: "var(--gradient-orange)" }}>
          <div className="text-xs opacity-90 mb-1">★ 数据分析师实名入驻 ★</div>
          <p className="text-xs leading-snug opacity-95 line-clamp-3">{ann.content}</p>
          <div className="flex gap-2 mt-2">
            <button className="bg-white/20 px-3 py-1 rounded text-xs">公众号</button>
            <button className="bg-white/20 px-3 py-1 rounded text-xs">微信</button>
            <button className="bg-white/20 px-3 py-1 rounded text-xs">反馈</button>
          </div>
        </div>
      )}

      {/* 栏目筛选 */}
      <div className="bg-card mx-3 mt-3 rounded-md p-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">栏目</span>
        <select
          className="text-sm bg-transparent focus:outline-none"
          value={activeCat}
          onChange={(e) => setActiveCat(e.target.value)}
        >
          <option value="all">全部 ›</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* 搜索 */}
      <div className="px-3 mt-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入关键词搜索"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {/* 全部文章 / 默认排序 */}
      <div className="bg-card mx-3 mt-2 rounded-md p-3 flex items-center justify-between text-sm">
        <span>全部文章 ▾</span>
        <span className="text-muted-foreground">默认排序 ▾</span>
      </div>

      {/* 平台公告项 */}
      <div className="bg-card mx-3 mt-3 rounded-md p-3 border-l-2 border-primary">
        <div className="flex items-center justify-between text-xs">
          <span className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded">平台公告</span>
          <span className="text-muted-foreground">{fmtDate(ann?.created_at)}</span>
        </div>
      </div>

      {/* 商品列表 */}
      <main className="flex-1 px-3 py-3 space-y-2">
        {filtered.length === 0 && (
          <p className="text-center py-10 text-sm text-muted-foreground">暂无商品</p>
        )}
        {filtered.map((p) => (
          <Link
            key={p.id}
            to="/product/$productId"
            params={{ productId: p.id }}
            className="block bg-card rounded-md p-3 border-l-2 border-primary"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex-1 pr-2 line-clamp-2">{p.title}</h3>
              <span className="text-primary font-semibold text-sm">{fmtMoney(p.price)}</span>
            </div>
            {p.is_recommended && (
              <div className="mt-1.5">
                <span className="inline-block text-[10px] text-primary-foreground bg-primary px-2 py-0.5 rounded">★ 强烈推荐 ★</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>发布时间</span>
              <span>{fmtDate(p.publish_at)}</span>
            </div>
          </Link>
        ))}
      </main>
    </div>
  );
}
