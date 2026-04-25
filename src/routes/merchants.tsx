import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";

export const Route = createFileRoute("/merchants")({
  component: MerchantsPage,
});

function MerchantsPage() {
  const [list, setList] = useState<any[]>([]);
  const [kw, setKw] = useState("");

  useEffect(() => {
    supabase.from("merchants").select("id, shop_name, shop_avatar_url, shop_description").eq("status", "approved").then(({ data }) => setList(data ?? []));
  }, []);

  const filtered = kw ? list.filter((m) => m.shop_name.includes(kw)) : list;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家列表" />
      <div className="px-3 py-3">
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="🔍 搜索商家名称可关注 TA"
          className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm focus:outline-none"
        />
      </div>
      <main className="flex-1 px-3 space-y-3">
        {filtered.map((m) => (
          <div key={m.id} className="bg-card rounded-xl p-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">🍱</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{m.shop_name}</div>
              </div>
              <Link to="/shop/$merchantId" params={{ merchantId: m.id }} className="text-xs border border-info/30 text-info rounded px-2 py-1">
                ⌂ 主页
              </Link>
              <button className="text-xs bg-info/10 text-info rounded px-2 py-1">已关注</button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground line-clamp-3">
              {m.shop_description ?? "—"}
            </p>
          </div>
        ))}
        <p className="text-center py-4 text-xs text-muted-foreground">没有更多了</p>
      </main>
    </div>
  );
}
