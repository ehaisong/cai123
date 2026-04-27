import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/merchant/products/$productId/issues/")({
  component: Page,
});

type Issue = {
  id: string;
  product_id: string;
  issue_no: string;
  paid_content: string | null;
  publish_at: string;
  reveal_at: string | null;
  result: "pending" | "won" | "lost";
  result_note: string | null;
  status: "published" | "unpublished" | "draft";
  sales_count: number;
};

function Page() {
  return (
    <RouteGuard title="期数管理" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

function Inner() {
  const { productId } = useParams({ from: "/merchant/products/$productId/issues/" });
  const [product, setProduct] = useState<{ title: string } | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkRevealOpen, setBulkRevealOpen] = useState(false);
  const [bulkRevealAt, setBulkRevealAt] = useState(new Date().toISOString().slice(0, 16));

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: list }] = await Promise.all([
      supabase.from("products").select("title").eq("id", productId).maybeSingle(),
      supabase.from("product_issues").select("*").eq("product_id", productId).order("publish_at", { ascending: false }),
    ]);
    setProduct(p as any);
    setIssues((list ?? []) as Issue[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [productId]);

  const allSelected = useMemo(() => issues.length > 0 && selected.size === issues.length, [issues, selected]);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(issues.map((i) => i.id)));

  const refresh = async () => { setSelected(new Set()); await load(); };
  const ids = () => Array.from(selected);

  const bulkSetResult = async (result: "won" | "lost") => {
    if (selected.size === 0) return toast.error("请选择期数");
    const { error } = await supabase.from("product_issues").update({ result }).in("id", ids());
    if (error) return toast.error(error.message);
    toast.success(`已批量判${result === "won" ? "中" : "未中"}`);
    refresh();
  };
  const bulkPublishNow = async () => {
    if (selected.size === 0) return toast.error("请选择期数");
    const now = new Date().toISOString();
    const { error } = await supabase.from("product_issues").update({ status: "published", reveal_at: now }).in("id", ids());
    if (error) return toast.error(error.message);
    toast.success("已立即公开");
    refresh();
  };
  const bulkUnpublish = async () => {
    if (selected.size === 0) return toast.error("请选择期数");
    const { error } = await supabase.from("product_issues").update({ status: "unpublished" }).in("id", ids());
    if (error) return toast.error(error.message);
    toast.success("已批量下架");
    refresh();
  };
  const bulkDelete = async () => {
    if (selected.size === 0) return toast.error("请选择期数");
    if (!confirm(`确定删除选中的 ${selected.size} 期？此操作不可恢复`)) return;
    const { error } = await supabase.from("product_issues").delete().in("id", ids());
    if (error) return toast.error(error.message);
    toast.success("已删除");
    refresh();
  };
  const submitBulkReveal = async () => {
    if (selected.size === 0) return toast.error("请选择期数");
    const iso = new Date(bulkRevealAt).toISOString();
    const { error } = await supabase.from("product_issues").update({ reveal_at: iso }).in("id", ids());
    if (error) return toast.error(error.message);
    setBulkRevealOpen(false);
    toast.success("公开时间已更新");
    refresh();
  };

  // 单条操作
  const setOneResult = async (id: string, result: "won" | "lost") => {
    const { error } = await supabase.from("product_issues").update({ result }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };
  const publishOneNow = async (id: string) => {
    const { error } = await supabase.from("product_issues").update({ status: "published", reveal_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("已立即公开");
    load();
  };

  // 复制为下一期：期号 +1，发布/公开时间各 +1 天
  const copyAsNext = async (it: Issue) => {
    const nextNo = bumpIssueNo(it.issue_no);
    const nextPublish = shiftDays(it.publish_at, 1);
    const nextReveal = it.reveal_at ? shiftDays(it.reveal_at, 1) : null;
    const { error } = await supabase.from("product_issues").insert({
      product_id: productId,
      issue_no: nextNo,
      paid_content: it.paid_content,
      publish_at: nextPublish,
      reveal_at: nextReveal,
      status: "draft",
      result: "pending",
    });
    if (error) return toast.error(error.message);
    toast.success(`已生成草稿：${nextNo}`);
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader
        title="管理期数"
        right={
          <Link to="/merchant/products/$productId/issues/new" params={{ productId }} className="text-xs text-info">＋ 新一期</Link>
        }
      />
      <main className="flex-1 px-3 py-3 space-y-3">
        <div className="bg-card rounded-md p-3">
          <div className="text-xs text-muted-foreground">系列</div>
          <div className="text-sm font-medium line-clamp-1">{product?.title ?? "—"}</div>
          <div className="mt-2 flex gap-2">
            <Link to="/merchant/products/$productId/issues/new" params={{ productId }} className="flex-1">
              <Button size="sm" className="w-full">＋ 添加新一期</Button>
            </Link>
            <Link to="/merchant/products/$productId/issues/bulk-import" params={{ productId }} className="flex-1">
              <Button size="sm" variant="outline" className="w-full">批量添加</Button>
            </Link>
          </div>
        </div>

        {/* 批量操作条 */}
        {issues.length > 0 && (
          <div className="bg-card rounded-md p-2 flex items-center gap-2 sticky top-12 z-10">
            <label className="flex items-center gap-2 text-xs px-1">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              全选 ({selected.size})
            </label>
            <div className="flex-1 overflow-x-auto whitespace-nowrap flex gap-1">
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={bulkPublishNow}>立即公开</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => bulkSetResult("won")}>判中</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => bulkSetResult("lost")}>判未中</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setBulkRevealOpen(true)}>改公开时间</Button>
              <Button size="sm" variant="secondary" disabled={!selected.size} onClick={bulkUnpublish}>下架</Button>
              <Button size="sm" variant="destructive" disabled={!selected.size} onClick={bulkDelete}>删除</Button>
            </div>
          </div>
        )}

        {loading && <p className="text-center py-4 text-xs text-muted-foreground">加载中…</p>}
        {!loading && issues.length === 0 && (
          <p className="text-center py-12 text-sm text-muted-foreground">还没有任何一期，点上方按钮添加</p>
        )}

        {issues.map((it) => (
          <div key={it.id} className="bg-card rounded-md p-3">
            <div className="flex items-start gap-2">
              <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggle(it.id)} className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">期号 {it.issue_no}</div>
                  <ResultBadge result={it.result} status={it.status} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  发布：{fmtDate(it.publish_at)}
                </div>
                <div className="text-xs text-muted-foreground">
                  公开：{it.reveal_at ? fmtDate(it.reveal_at) : "未设置"}
                </div>
                {it.paid_content && (
                  <div className="mt-2 text-xs bg-muted/40 rounded px-2 py-1 line-clamp-2 whitespace-pre-wrap">
                    {it.paid_content}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <Link to="/merchant/products/$productId/issues/$issueId/edit" params={{ productId, issueId: it.id }}>
                    <Button size="sm" variant="outline">编辑</Button>
                  </Link>
                  <Button size="sm" variant="outline" onClick={() => copyAsNext(it)}>复制为下一期</Button>
                  {it.status !== "published" || (it.reveal_at && new Date(it.reveal_at) > new Date()) ? (
                    <Button size="sm" variant="outline" onClick={() => publishOneNow(it.id)}>立即公开</Button>
                  ) : null}
                  {it.result === "pending" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setOneResult(it.id, "won")}>判中</Button>
                      <Button size="sm" variant="outline" onClick={() => setOneResult(it.id, "lost")}>判未中</Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </main>

      <Dialog open={bulkRevealOpen} onOpenChange={setBulkRevealOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>批量设置公开时间</DialogTitle></DialogHeader>
          <Input type="datetime-local" value={bulkRevealAt} onChange={(e) => setBulkRevealAt(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRevealOpen(false)}>取消</Button>
            <Button onClick={submitBulkReveal}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResultBadge({ result, status }: { result: string; status: string }) {
  if (status !== "published") return <span className="text-xs text-muted-foreground">{status === "draft" ? "草稿" : "已下架"}</span>;
  if (result === "won") return <span className="text-xs text-success bg-success/10 px-2 py-0.5 rounded">✅ 中奖</span>;
  if (result === "lost") return <span className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded">❌ 未中</span>;
  return <span className="text-xs text-warning bg-warning/10 px-2 py-0.5 rounded">⏳ 待判定</span>;
}

function bumpIssueNo(no: string): string {
  const m = no.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return no + "-next";
  const prefix = m[1];
  const num = m[2];
  const suffix = m[3];
  const next = (BigInt(num) + 1n).toString().padStart(num.length, "0");
  return `${prefix}${next}${suffix}`;
}
function shiftDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
