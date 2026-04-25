import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/h5/bottom-nav";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ ref: z.string().optional() }),
  component: HomePage,
});

interface MerchantRow {
  id: string;
  shop_name: string;
  shop_avatar_url: string | null;
  shop_description: string | null;
  total_sales: number;
}
interface AnnouncementRow { id: string; title: string; content: string | null; created_at: string; }

function HomePage() {
  const { user } = useAuth();
  const search = useSearch({ from: "/" });
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [ann, setAnn] = useState<AnnouncementRow | null>(null);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    supabase
      .from("merchants")
      .select("id, shop_name, shop_avatar_url, shop_description, total_sales")
      .eq("status", "approved")
      .order("total_sales", { ascending: false })
      .limit(50)
      .then(({ data }) => setMerchants(data ?? []));
    supabase
      .from("announcements")
      .select("id, title, content, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => setAnn(data?.[0] ?? null));
  }, []);

  // 自动绑定推荐码
  useEffect(() => {
    if (user && search.ref) {
      supabase.rpc("bind_referrer", { _agent_code: search.ref });
    }
  }, [user, search.ref]);

  const filtered = keyword
    ? merchants.filter((m) => m.shop_name.includes(keyword))
    : merchants;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">数据科学入门指南</h1>
      </header>

      {/* 公告卡片 */}
      {ann && (
        <div className="mx-3 mt-3 rounded-xl p-4 text-white shadow-sm" style={{ background: "var(--gradient-orange)" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded">小吴说菜</span>
            <span className="text-xs opacity-90">{ann.title}</span>
          </div>
          <p className="text-sm leading-snug opacity-95">{ann.content}</p>
        </div>
      )}

      {/* 搜索框 */}
      <div className="px-3 pt-3">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索商家名称可关注 TA"
          className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* 栏目区块 */}
      <div className="px-3 pt-3">
        <div className="bg-card rounded-md p-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">栏目</span>
          <Link to="/merchants" className="text-info text-xs">查看全部 ›</Link>
        </div>
      </div>

      {/* 商家列表 */}
      <main className="flex-1 px-3 py-3 space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm">暂无商家</div>
        )}
        {filtered.map((m) => (
          <Link
            key={m.id}
            to="/shop/$merchantId"
            params={{ merchantId: m.id }}
            className="block bg-card rounded-xl p-3 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center text-xl">
                {m.shop_avatar_url ? (
                  <img src={m.shop_avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <span>🍱</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{m.shop_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.shop_description ?? "暂无简介"}
                </div>
              </div>
              <div className="text-xs text-info border border-info/30 rounded px-2 py-1">进店</div>
            </div>
          </Link>
        ))}
        {filtered.length > 0 && (
          <p className="text-center text-xs text-muted-foreground py-4">没有更多了</p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
