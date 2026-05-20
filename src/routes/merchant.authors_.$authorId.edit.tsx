import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/authors_/$authorId/edit")({
  component: () => (
    <RouteGuard title="修改作者" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { authorId } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [sort, setSort] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("authors").select("name, sort").eq("id", authorId).maybeSingle();
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      if (data) { setName(data.name); setSort(Number(data.sort) || 0); }
    })();
  }, [authorId]);

  const onSubmit = async () => {
    if (!name.trim()) { toast.error("请输入作者名"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("authors")
      .update({ name: name.trim(), sort: Number(sort) || 0 })
      .eq("id", authorId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("已保存");
    navigate({ to: "/merchant/authors" });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="修改作者" />
      <main className="flex-1 px-4 py-4 space-y-5">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-8">加载中…</div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-2">
                <span className="text-destructive">*</span> 作者名
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-card" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">排序</label>
              <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value))} className="bg-card" />
            </div>
          </>
        )}
      </main>
      <div className="p-4 flex justify-end">
        <Button variant="outline" className="text-info border-info/40" onClick={onSubmit} disabled={saving || loading}>
          {saving ? "提交中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
