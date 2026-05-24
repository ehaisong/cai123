import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/authors")({
  component: AuthorsPage,
});

type Author = { id: string; name: string; sort: number; today_views?: number; today_purchases?: number; total_views?: number; total_purchases?: number };

function AuthorsPage() {
  return (
    <RouteGuard title="作者列表" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

function Inner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [items, setItems] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = async (mid: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("merchant_author_stats" as any, { _merchant_id: mid });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setItems(((data as any[]) ?? []) as Author[]);
  };


  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (!m) return;
      setMerchantId(m.id);
      await load(m.id);
    })();
  }, [user?.id]);

  const filtered = items.filter((a) => !q.trim() || a.name.includes(q.trim()));

  const onDelete = async (id: string) => {
    if (!confirm("确认删除该作者？")) return;
    const { error } = await (supabase as any).from("authors").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("已删除");
    setItems((arr) => arr.filter((x) => x.id !== id));
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="作者列表" />
      <div className="px-3 pt-3">
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="请输入关键字"
            className="flex-1 bg-card"
          />
          <Button onClick={() => navigate({ to: "/merchant/authors/new" })}>新增作者</Button>
        </div>
      </div>

      <main className="flex-1 px-3 py-3 space-y-2">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-8">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">暂无作者</div>
        ) : (
          filtered.map((a) => (
            <div key={a.id} className="bg-card rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-base font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground shrink-0">排序 {a.sort}</div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                <div className="bg-muted/40 rounded p-1.5">
                  <div className="text-[10px] text-muted-foreground">今日浏览</div>
                  <div className="text-sm font-semibold text-info">{a.today_views ?? 0}</div>
                </div>
                <div className="bg-muted/40 rounded p-1.5">
                  <div className="text-[10px] text-muted-foreground">今日购买</div>
                  <div className="text-sm font-semibold text-success">{a.today_purchases ?? 0}</div>
                </div>
                <div className="bg-muted/40 rounded p-1.5">
                  <div className="text-[10px] text-muted-foreground">累计浏览</div>
                  <div className="text-sm font-semibold">{a.total_views ?? 0}</div>
                </div>
                <div className="bg-muted/40 rounded p-1.5">
                  <div className="text-[10px] text-muted-foreground">累计购买</div>
                  <div className="text-sm font-semibold">{a.total_purchases ?? 0}</div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" size="sm" className="text-destructive border-destructive/40" onClick={() => onDelete(a.id)}>
                  删除
                </Button>
                <Link to="/merchant/authors/$authorId/edit" params={{ authorId: a.id }}>
                  <Button variant="outline" size="sm" className="text-info border-info/40">修改</Button>
                </Link>
              </div>
            </div>
          ))

        )}
      </main>
    </div>
  );
}
