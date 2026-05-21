import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/merchant/products/$productId/issues/$issueId/edit")({
  component: Page,
});

function Page() {
  return (
    <RouteGuard title="编辑期号" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

function toLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function Inner() {
  const { productId, issueId } = useParams({ from: "/merchant/products/$productId/issues/$issueId/edit" });
  const navigate = useNavigate();
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data }, { data: prod }] = await Promise.all([
        supabase.from("product_issues").select("*").eq("id", issueId).maybeSingle(),
        (supabase as any).from("products").select("is_locked").eq("id", productId).maybeSingle(),
      ]);
      if (!data) { toast.error("期号不存在"); return; }
      setIsLocked(!!prod?.is_locked);
      setForm({
        issue_no: data.issue_no,
        paid_content: data.paid_content ?? "",
        publish_at: toLocal(data.publish_at),
        reveal_at: toLocal(data.reveal_at),
        status: data.status,
        result: data.result,
        result_note: data.result_note ?? "",
      });
    })();
  }, [issueId, productId]);

  const submit = async () => {
    setLoading(true);
    const patch: Record<string, unknown> = {
      issue_no: form.issue_no,
      publish_at: new Date(form.publish_at).toISOString(),
      reveal_at: form.reveal_at ? new Date(form.reveal_at).toISOString() : null,
      status: form.status,
      result: form.result,
      result_note: form.result_note || null,
    };
    // 锁定后“料”（付费内容）不可修改
    if (!isLocked) patch.paid_content = form.paid_content || null;
    const { error } = await (supabase as any).from("product_issues").update(patch).eq("id", issueId);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("已保存");
    navigate({ to: "/merchant/products/$productId/issues", params: { productId } });
  };

  if (!form) return <div className="h5-shell h5-shell-fluid"><PageHeader title="编辑期号" /><p className="p-4 text-sm text-muted-foreground">加载中…</p></div>;

  return (
    <div className="h5-shell h5-shell-fluid flex min-h-screen flex-col">
      <PageHeader title="编辑期号" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {isLocked && (
          <div className="bg-warning/10 text-warning text-xs rounded-md px-3 py-2">
            🔒 此方案已锁定，付费内容（料）不可修改。如需修改请先在方案列表中取消锁定。
          </div>
        )}
        <Field label="期号"><Input value={form.issue_no} onChange={(e) => setForm({ ...form, issue_no: e.target.value })} /></Field>
        <Field label="发布时间"><Input type="datetime-local" value={form.publish_at} onChange={(e) => setForm({ ...form, publish_at: e.target.value })} /></Field>
        <Field label="公开时间"><Input type="datetime-local" value={form.reveal_at} onChange={(e) => setForm({ ...form, reveal_at: e.target.value })} /></Field>
        <Field label={isLocked ? "付费内容（已锁定）" : "付费内容"}>
          <Textarea
            rows={5}
            value={form.paid_content}
            onChange={(e) => setForm({ ...form, paid_content: e.target.value })}
            disabled={isLocked}
            readOnly={isLocked}
            className={isLocked ? "opacity-70 cursor-not-allowed" : ""}
          />
        </Field>
        <Field label="状态">
          <select className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="published">已上架</option>
            <option value="unpublished">已下架</option>
            <option value="draft">草稿</option>
          </select>
        </Field>
        <Field label="结果">
          <select className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
            <option value="pending">待判定</option>
            <option value="won">中奖</option>
            <option value="lost">未中</option>
          </select>
        </Field>
        <Field label="结果备注"><Input value={form.result_note} onChange={(e) => setForm({ ...form, result_note: e.target.value })} placeholder="选填" /></Field>
        <Button className="w-full" size="lg" onClick={submit} disabled={loading || isLocked && false}>{loading ? "保存中…" : "保存"}</Button>
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
