import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";
import { MerchantBottomNav } from "@/components/h5/merchant-bottom-nav";

export const Route = createFileRoute("/merchant/products/bulk-import")({
  component: () => (
    <RouteGuard title="批量导入" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

type Author = { id: string; name: string };

type Row = {
  author_name: string;
  price: string;
  tags: string;
  publish_at: string;
  issue_no: string;
  paid_content: string;
  error?: string;
};

function parseDate(v: unknown): string {
  if (v == null || v === "") return new Date().toISOString().slice(0, 16);
  if (v instanceof Date) {
    const d = v;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const s = String(v).trim().replace("T", " ").replace(/\//g, "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return "";
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}`;
}

function Inner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoCreateAuthors, setAutoCreateAuthors] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (!m) return;
      setMerchantId(m.id);
      const [{ data: aData }, { data: cData }] = await Promise.all([
        (supabase as any).from("authors").select("id, name").eq("merchant_id", m.id),
        supabase.from("lottery_categories").select("id").order("sort_order").limit(1),
      ]);
      setAuthors((aData ?? []) as Author[]);
      setCategoryId(cData?.[0]?.id ?? null);
    })();
  }, [user?.id]);

  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    if (!arr.length) return toast.error("文件为空");
    // 跳过表头（第一行），按列序解析：作者名称 | 价格 | 标签 | 发布时间 | 期号 | 付费内容
    const parsed: Row[] = arr.slice(1)
      .filter((r) => Array.isArray(r) && r.some((c) => c != null && String(c).trim() !== ""))
      .map((r) => {
        const author_name = String((r as any)[0] ?? "").trim();
        const price = String((r as any)[1] ?? "").trim();
        const tags = String((r as any)[2] ?? "").trim();
        const publish_at = parseDate((r as any)[3]);
        const issue_no = String((r as any)[4] ?? "").trim();
        const paid_content = String((r as any)[5] ?? "").trim();
        let error: string | undefined;
        if (!author_name) error = "缺少作者名称";
        else if (!price || Number(price) <= 0) error = "价格无效";
        else if (!issue_no) error = "缺少期号";
        else if (!paid_content) error = "缺少付费内容";
        else if (!publish_at) error = "发布时间格式错误";
        return { author_name, price, tags, publish_at, issue_no, paid_content, error };
      });
    if (!parsed.length) return toast.error("没有可识别的数据行");
    setRows(parsed);
    toast.success(`已解析 ${parsed.length} 行`);
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch, error: undefined } : r)));
  };
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!merchantId) return toast.error("商家信息缺失");
    if (!categoryId) return toast.error("彩种分类未配置");
    if (!rows.length) return toast.error("没有数据");
    const bad = rows.find((r) => r.error || !r.author_name || !r.price || !r.issue_no || !r.paid_content || !r.publish_at);
    if (bad) return toast.error("存在无效行，请先修正");

    setLoading(true);
    try {
      // 处理作者：找不到则按需新建
      const nameMap = new Map(authors.map((a) => [a.name.trim(), a.id]));
      const missing = Array.from(new Set(rows.map((r) => r.author_name).filter((n) => !nameMap.has(n))));
      if (missing.length) {
        if (!autoCreateAuthors) {
          setLoading(false);
          return toast.error(`以下作者不存在：${missing.slice(0, 3).join("、")}${missing.length > 3 ? "…" : ""}`);
        }
        const { data: newAuthors, error: aerr } = await (supabase as any)
          .from("authors")
          .insert(missing.map((name) => ({ merchant_id: merchantId, name })))
          .select("id, name");
        if (aerr) { setLoading(false); return toast.error(`新建作者失败：${aerr.message}`); }
        for (const a of newAuthors ?? []) nameMap.set((a as Author).name.trim(), (a as Author).id);
        setAuthors((prev) => [...prev, ...((newAuthors ?? []) as Author[])]);
      }

      const payload = rows.map((r) => ({
        merchant_id: merchantId,
        category_id: categoryId,
        author_id: nameMap.get(r.author_name),
        kind: "single",
        title: r.issue_no,
        types: [],
        tags: r.tags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        issue_no: r.issue_no,
        paid_content: r.paid_content,
        paid_images: [],
        intro_images: [],
        price: Number(r.price),
        virtual_views: 0,
        purchase_limit: 100,
        publish_at: new Date(r.publish_at).toISOString(),
        status: "published",
      }));

      const { error } = await (supabase as any).from("products").insert(payload);
      if (error) { setLoading(false); return toast.error(error.message); }
      toast.success(`已导入 ${payload.length} 条`);
      navigate({ to: "/merchant/products" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h5-shell h5-shell-fluid flex min-h-screen flex-col bg-background">
      <PageHeader title="批量导入方案" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <div className="bg-card rounded-md p-3 space-y-2">
          <div className="text-sm font-medium">上传 Excel 文件</div>
          <div className="text-xs text-muted-foreground leading-5">
            列顺序：作者名称 | 价格 | 标签 | 发布时间 | 期号 | 付费内容
            <br />首行为表头将被自动忽略。日期建议格式：2026-04-26 17:50。
          </div>
          <Input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoCreateAuthors}
              onChange={(e) => setAutoCreateAuthors(e.target.checked)}
            />
            未找到的作者自动创建
          </label>
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              共 {rows.length} 行
              {rows.some((r) => r.error) && (
                <span className="text-destructive ml-2">
                  {rows.filter((r) => r.error).length} 行存在错误
                </span>
              )}
            </div>

            {rows.map((r, i) => {
              const knownAuthor = authors.some((a) => a.name.trim() === r.author_name.trim());
              return (
                <div
                  key={i}
                  className={`bg-card rounded-md p-2 space-y-1 ${r.error ? "border border-destructive" : ""}`}
                >
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-8 text-xs"
                      value={r.author_name}
                      placeholder="作者名称"
                      onChange={(e) => updateRow(i, { author_name: e.target.value })}
                    />
                    <Input
                      className="w-20 h-8 text-xs"
                      value={r.price}
                      placeholder="价格"
                      onChange={(e) => updateRow(i, { price: e.target.value })}
                    />
                    <Input
                      className="w-24 h-8 text-xs"
                      value={r.issue_no}
                      placeholder="期号"
                      onChange={(e) => updateRow(i, { issue_no: e.target.value })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive"
                      onClick={() => removeRow(i)}
                    >
                      删
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-8 text-xs"
                      type="datetime-local"
                      value={r.publish_at}
                      onChange={(e) => updateRow(i, { publish_at: e.target.value })}
                    />
                    <Input
                      className="flex-1 h-8 text-xs"
                      value={r.tags}
                      placeholder="标签"
                      onChange={(e) => updateRow(i, { tags: e.target.value })}
                    />
                  </div>
                  <Textarea
                    rows={2}
                    className="text-xs"
                    value={r.paid_content}
                    placeholder="付费内容"
                    onChange={(e) => updateRow(i, { paid_content: e.target.value })}
                  />
                  {!knownAuthor && r.author_name && (
                    <div className="text-xs text-warning">
                      作者「{r.author_name}」不存在{autoCreateAuthors ? "，提交时将自动新建" : ""}
                    </div>
                  )}
                  {r.error && <div className="text-xs text-destructive">{r.error}</div>}
                </div>
              );
            })}

            <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
              {loading ? "提交中…" : `全部提交 ${rows.length} 条`}
            </Button>
          </div>
        )}

        <div className="pt-2 text-center">
          <Link to="/merchant/products" className="text-xs text-muted-foreground underline">
            返回方案管理
          </Link>
        </div>
      </main>
      <MerchantBottomNav />
    </div>
  );
}
