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

export const Route = createFileRoute("/merchant/products/new")({
  component: NewProductPage,
});

function NewProductPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({
    category_id: "", issue_no: "", title: "", subtitle: "", is_recommended: false,
    price: 5, paid_content: "", disclaimer: "",
    publish_at: new Date().toISOString().slice(0, 16),
    reveal_at: "",
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
    if (!form.title || !form.issue_no) { toast.error("请填写期号和标题"); return; }
    setLoading(true);
    const { error } = await supabase.from("products").insert({
      merchant_id: merchantId,
      category_id: form.category_id,
      issue_no: form.issue_no,
      title: form.title,
      subtitle: form.subtitle || null,
      is_recommended: form.is_recommended,
      price: form.price,
      paid_content: form.paid_content,
      disclaimer: form.disclaimer || null,
      publish_at: new Date(form.publish_at).toISOString(),
      reveal_at: form.reveal_at ? new Date(form.reveal_at).toISOString() : null,
      status: "published",
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("发布成功");
    navigate({ to: "/merchant/products" });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="发布商品" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <Field label="彩种">
          <select className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="期号"><Input value={form.issue_no} onChange={(e) => setForm({ ...form, issue_no: e.target.value })} placeholder="如 2026115" /></Field>
        <Field label="标题"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 新澳115期【十拿九稳】一肖一码" /></Field>
        <Field label="副标题"><Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="选填" /></Field>
        <Field label="价格 (¥)"><Input type="number" min={0} step={0.01} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></Field>
        <div className="bg-card rounded-md p-3 flex items-center justify-between">
          <span className="text-sm">★ 强烈推荐</span>
          <Switch checked={form.is_recommended} onCheckedChange={(v) => setForm({ ...form, is_recommended: v })} />
        </div>
        <Field label="发布时间"><Input type="datetime-local" value={form.publish_at} onChange={(e) => setForm({ ...form, publish_at: e.target.value })} /></Field>
        <Field label="公开时间"><Input type="datetime-local" value={form.reveal_at} onChange={(e) => setForm({ ...form, reveal_at: e.target.value })} /></Field>
        <Field label="付费内容">
          <Textarea rows={4} value={form.paid_content} onChange={(e) => setForm({ ...form, paid_content: e.target.value })} placeholder="买家购买后才可见" />
        </Field>
        <Field label="免责声明">
          <Textarea rows={3} value={form.disclaimer} onChange={(e) => setForm({ ...form, disclaimer: e.target.value })} placeholder="留空使用默认声明" />
        </Field>

        <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
          {loading ? "提交中…" : "立即发布"}
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
