import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/merchant/products/$productId/issues/new")({
  component: Page,
});

function Page() {
  return (
    <RouteGuard title="新增期号" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

function Inner() {
  const { productId } = useParams({ from: "/merchant/products/$productId/issues/new" });
  const navigate = useNavigate();
  const [form, setForm] = useState({
    issue_no: "",
    paid_content: "",
    publish_at: new Date().toISOString().slice(0, 16),
    reveal_at: "",
    status: "published" as "published" | "draft",
  });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.issue_no) return toast.error("请填写期号");
    setLoading(true);
    const { error } = await supabase.from("product_issues").insert({
      product_id: productId,
      issue_no: form.issue_no,
      paid_content: form.paid_content || null,
      publish_at: new Date(form.publish_at).toISOString(),
      reveal_at: form.reveal_at ? new Date(form.reveal_at).toISOString() : null,
      status: form.status,
      result: "pending",
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("已添加");
    navigate({ to: "/merchant/products/$productId/issues", params: { productId } });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="新增期号" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <Field label="期号"><Input value={form.issue_no} onChange={(e) => setForm({ ...form, issue_no: e.target.value })} placeholder="如 2026115" /></Field>
        <Field label="发布时间(此期对买家可见)"><Input type="datetime-local" value={form.publish_at} onChange={(e) => setForm({ ...form, publish_at: e.target.value })} /></Field>
        <Field label="公开时间(开奖结果展示，选填)"><Input type="datetime-local" value={form.reveal_at} onChange={(e) => setForm({ ...form, reveal_at: e.target.value })} /></Field>
        <Field label="付费内容"><Textarea rows={5} value={form.paid_content} onChange={(e) => setForm({ ...form, paid_content: e.target.value })} placeholder="买家购买后才可见" /></Field>
        <Field label="状态">
          <select className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
            <option value="published">已上架</option>
            <option value="draft">草稿</option>
          </select>
        </Field>
        <Button className="w-full" size="lg" onClick={submit} disabled={loading}>{loading ? "提交中…" : "提交"}</Button>
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
