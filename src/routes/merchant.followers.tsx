import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/merchant/followers")({
  component: () => (
    <RouteGuard title="关注客户" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

type Follower = {
  user_id: string;
  nickname: string | null;
  avatar_url: string | null;
  user_code: string | null;
  joined_at: string;
  is_agent: boolean;
};

function Inner() {
  const { user } = useAuth();
  const [list, setList] = useState<Follower[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (!m) { setLoading(false); return; }
      const { data } = await supabase.rpc("shop_followers" as any, { _merchant_id: m.id, _limit: 1000 });
      setList(((data as any[]) ?? []) as Follower[]);
      setLoading(false);
    })();
  }, [user?.id]);

  const filtered = list.filter((f) => !q.trim() || (f.nickname ?? "").includes(q) || (f.user_code ?? "").includes(q));

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="关注客户" />
      <div className="px-3 pt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="按昵称或编号搜索"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="mt-2 text-xs text-muted-foreground">共 {filtered.length} 位客户</div>
      </div>
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-8">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">暂无关注客户</div>
        ) : (
          filtered.map((f) => (
            <div key={f.user_id} className="bg-card rounded-xl p-3 flex items-center gap-3">
              {f.avatar_url ? (
                <img src={f.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm text-muted-foreground">
                  {(f.nickname ?? "?").slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {f.nickname ?? "未命名"}
                  {f.is_agent && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">代理</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {f.user_code ?? "—"} · {fmtDate(f.joined_at, "yyyy-MM-dd")}入店
                </div>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
