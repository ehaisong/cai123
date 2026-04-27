import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/merchant/products/new")({
  component: NewProductPage,
});

function NewProductPage() {
  return (
    <RouteGuard title="新建商品系列" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <NewProductPageInner />
    </RouteGuard>
  );
}

function NewProductPageInner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({
    category_id: "", title: "", subtitle: "", is_recommended: false,
    price: 5, disclaimer: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle().then(({ data }) => setMerchantId(data?.id ?? null));
    supabase.from("lottery_categories").select("id, name").order("sort_order").then(({ data }) => {
      setCategories(data ?? []);
      if (data?.[0]) setForm((f) => ({ ...f, category_id: data[0].id }));
    });
  }, [user?.id]);

  const submit = async () => {
    if (!merchantId) { toast.error("商家信息缺失"); return; }
    if (!form.title) { toast.error("请填写标题"); return; }
    setLoading(true);
    // 系列只填元信息；期号字段为兼容老约束塞个占位，期数走 product_issues
    const { data, error } = await supabase.from("products").insert({
      merchant_id: merchantId,
      category_id: form.category_id,
      issue_no: "—",
      title: form.title,
      subtitle: form.subtitle || null,
      is_recommended: form.is_recommended,
      price: form.price,
      paid_content: null,
      disclaimer: form.disclaimer || null,
      publish_at: new Date().toISOString(),
      reveal_at: null,
      status: "published",
    }).select("id").single();
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("系列已创建，请添加首期");
    navigate({ to: "/merchant/products/$productId/issues/new", params: { productId: data.id } });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="新建系列" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          系列只保存「标题 / 彩种 / 价格」等长期不变的信息。每一期的内容、发布时间、结果在创建后到「管理期数」中维护。
        </div>
        <Field label="彩种">
          <select className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="系列标题"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 新澳【十拿九稳】一肖一码" /></Field>
        <Field label="副标题"><Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="选填" /></Field>
        <Field label="单期价格 (¥)"><Input type="number" min={0} step={0.01} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></Field>
        <div className="bg-card rounded-md p-3 flex items-center justify-between">
          <span className="text-sm">★ 强烈推荐</span>
          <Switch checked={form.is_recommended} onCheckedChange={(v) => setForm({ ...form, is_recommended: v })} />
        </div>
        <Field label="免责声明">
          <Textarea rows={3} value={form.disclaimer} onChange={(e) => setForm({ ...form, disclaimer: e.target.value })} placeholder="留空使用默认声明" />
        </Field>

        <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
          {loading ? "提交中…" : "创建并添加首期"}
        </Button>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      {children}
    </div>
  );
}
