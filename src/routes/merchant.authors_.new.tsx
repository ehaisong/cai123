import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/authors_/new")({
  component: () => (
    <RouteGuard title="新增作者" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sort, setSort] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (m) setMerchantId(m.id);
    })();
  }, [user?.id]);

  const onSubmit = async () => {
    if (!name.trim()) { toast.error("请输入作者名"); return; }
    if (!merchantId) { toast.error("未找到商家信息"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("authors").insert({
      merchant_id: merchantId,
      name: name.trim(),
      sort: Number(sort) || 0,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("已新增");
    navigate({ to: "/merchant/authors" });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="新增作者" />
      <main className="flex-1 px-4 py-4 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-2">
            <span className="text-destructive">*</span> 作者名
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入内容"
            className="bg-card"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">排序</label>
          <Input
            type="number"
            value={sort}
            onChange={(e) => setSort(Number(e.target.value))}
            className="bg-card"
          />
        </div>
      </main>
      <div className="p-4 flex justify-end">
        <Button variant="outline" className="text-info border-info/40" onClick={onSubmit} disabled={saving}>
          {saving ? "提交中…" : "新增"}
        </Button>
      </div>
    </div>
  );
}
