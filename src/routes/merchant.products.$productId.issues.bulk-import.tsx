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

export const Route = createFileRoute("/merchant/products/$productId/issues/bulk-import")({
  component: Page,
});

function Page() {
  return (
    <RouteGuard title="批量添加期号" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

type Row = {
  issue_no: string;
  publish_at: string; // datetime-local format
  reveal_at: string;
  paid_content: string;
  error?: string;
};

const SAMPLE = `2026115 | 2026-11-12 20:00 | 2026-11-13 21:30 | 三肖：龙虎兔
2026116 | 2026-11-13 20:00 | 2026-11-14 21:30 | 三肖：蛇马羊`;

function parseDate(s: string): string | null {
  if (!s) return "";
  const t = s.trim().replace("T", " ").replace(/\//g, "-");
  // 支持 yyyy-mm-dd HH:MM 或 yyyy-mm-dd HH:MM:SS
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const local = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}`;
  return local;
}

function parseText(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(/[|,\t]/).map((p) => p.trim());
    const [issue_no = "", pub = "", rev = "", ...rest] = parts;
    const paid_content = rest.join(" | ");
    const publish = parseDate(pub);
    const reveal = parseDate(rev);
    let error: string | undefined;
    if (!issue_no) error = "缺少期号";
    else if (publish === null) error = "发布时间格式错误";
    else if (reveal === null && rev) error = "公开时间格式错误";
    return {
      issue_no,
      publish_at: publish ?? "",
      reveal_at: reveal ?? "",
      paid_content,
      error,
    };
  });
}

function Inner() {
  const { productId } = useParams({ from: "/merchant/products/$productId/issues/bulk-import" });
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const doParse = () => {
    const parsed = parseText(text);
    if (parsed.length === 0) return toast.error("没有可识别的行");
    setRows(parsed);
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch, error: undefined } : row)));
  };
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const submit = async () => {
    const bad = rows.find((r) => !r.issue_no || !r.publish_at);
    if (bad) return toast.error("有行缺少期号或发布时间");
    setLoading(true);
    const payload = rows.map((r) => ({
      product_id: productId,
      issue_no: r.issue_no,
      paid_content: r.paid_content || null,
      publish_at: new Date(r.publish_at).toISOString(),
      reveal_at: r.reveal_at ? new Date(r.reveal_at).toISOString() : null,
      status: "published" as const,
      result: "pending" as const,
    }));
    const { error } = await supabase.from("product_issues").insert(payload);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(`已导入 ${payload.length} 期`);
    navigate({ to: "/merchant/products/$productId/issues", params: { productId } });
  };

  return (
    <div className="h5-shell h5-shell-fluid flex min-h-screen flex-col">
      <PageHeader title="批量添加期号" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <div className="bg-card rounded-md p-3">
          <Label className="text-xs text-muted-foreground mb-1 block">
            每行一期，使用「|」分隔：期号 | 发布时间 | 公开时间 | 付费内容
          </Label>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setText(SAMPLE)}>填入示例</Button>
            <Button size="sm" onClick={doParse}>解析预览</Button>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">共 {rows.length} 行，确认无误后提交</div>
            {rows.map((r, i) => (
              <div key={i} className={`bg-card rounded-md p-2 space-y-1 ${r.error ? "border border-destructive" : ""}`}>
                <div className="flex gap-2">
                  <Input className="flex-1 h-8 text-xs" value={r.issue_no} placeholder="期号" onChange={(e) => updateRow(i, { issue_no: e.target.value })} />
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" onClick={() => removeRow(i)}>删</Button>
                </div>
                <div className="flex gap-2">
                  <Input className="flex-1 h-8 text-xs" type="datetime-local" value={r.publish_at} onChange={(e) => updateRow(i, { publish_at: e.target.value })} />
                  <Input className="flex-1 h-8 text-xs" type="datetime-local" value={r.reveal_at} onChange={(e) => updateRow(i, { reveal_at: e.target.value })} />
                </div>
                <Textarea rows={2} className="text-xs" value={r.paid_content} placeholder="付费内容" onChange={(e) => updateRow(i, { paid_content: e.target.value })} />
                {r.error && <div className="text-xs text-destructive">{r.error}</div>}
              </div>
            ))}
            <Button className="w-full" size="lg" onClick={submit} disabled={loading}>{loading ? "提交中…" : `全部提交 ${rows.length} 期`}</Button>
          </div>
        )}
      </main>
    </div>
  );
}
