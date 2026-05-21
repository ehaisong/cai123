import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";
import { MerchantBottomNav } from "@/components/h5/merchant-bottom-nav";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/merchant/products/new")({
  component: () => (
    <RouteGuard title="新建" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

type Author = { id: string; name: string };

function Inner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const [authorId, setAuthorId] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [issueNo, setIssueNo] = useState<string>("");
  const [tagText, setTagText] = useState<string>("");
  const [paidContent, setPaidContent] = useState<string>("");
  const [virtualViews, setVirtualViews] = useState<string>("0");
  const [purchaseLimit, setPurchaseLimit] = useState<string>("100");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (!m) return;
      setMerchantId(m.id);
      const [{ data: aData }, { data: cData }] = await Promise.all([
        (supabase as any).from("authors").select("id, name").eq("merchant_id", m.id)
          .order("sort", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("lottery_categories").select("id").order("sort_order").limit(1),
      ]);
      setAuthors((aData ?? []) as Author[]);
      setCategoryId(cData?.[0]?.id ?? null);
    })();
  }, [user?.id]);

  const tags = tagText.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);

  const submit = async () => {
    if (!merchantId) return toast.error("商家信息缺失");
    if (!authorId) return toast.error("请选择作者");
    const p = Number(price);
    if (!p || p <= 0) return toast.error("请输入价格");
    if (!issueNo.trim()) return toast.error("请输入期数");
    if (!paidContent.trim()) return toast.error("请输入付费内容");
    if (paidContent.length > 500) return toast.error("付费内容不能超过 500 字");
    if (!categoryId) return toast.error("彩种分类未配置");

    setSaving(true);
    const payload: any = {
      merchant_id: merchantId,
      category_id: categoryId,
      author_id: authorId,
      kind: "single",
      title: issueNo.trim(),
      types: [],
      tags,
      issue_no: issueNo.trim(),
      paid_content: paidContent,
      paid_images: [],
      intro_images: [],
      price: p,
      virtual_views: Number(virtualViews) || 0,
      purchase_limit: Number(purchaseLimit) || 0,
      publish_at: new Date().toISOString(),
      status: "published",
    };
    const { error } = await (supabase as any).from("products").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("已添加");
    navigate({ to: "/merchant/products" });
  };

  return (
    <div className="h5-shell h5-shell-fluid flex min-h-screen flex-col bg-background">
      <PageHeader title="新建" />

      {/* 顶部 Tab */}
      <div className="flex items-center justify-around bg-card border-b border-border">
        <Link
          to="/merchant/products"
          search={{ tab: "selling" } as any}
          className="flex-1 text-center py-3 text-sm text-muted-foreground"
        >
          售卖中
        </Link>
        <Link
          to="/merchant/products"
          search={{ tab: "off" } as any}
          className="flex-1 text-center py-3 text-sm text-muted-foreground"
        >
          已停售
        </Link>
        <div className="flex-1 text-center py-3 text-sm font-medium text-info relative">
          +添加新方案
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-info rounded-full" />
        </div>
        <Link
          to="/merchant/products/bulk-import"
          className="flex-1 text-center py-3 text-sm text-info"
        >
          批量导入
        </Link>
      </div>

      <main className="flex-1 px-4 py-4 space-y-5">
        {/* 作者名称 */}
        <Field label="作者名称" required>
          <div className="relative">
            <select
              value={authorId}
              onChange={(e) => setAuthorId(e.target.value)}
              className={cn(
                "w-full appearance-none bg-background border border-input rounded-md",
                "h-9 px-3 pr-8 text-sm shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                authorId ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <option value="">无</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">›</span>
          </div>
          {authors.length === 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              暂无作者，
              <Link to="/merchant/authors/new" className="text-info underline">去新增</Link>
            </div>
          )}
        </Field>

        <Field label="价格" required>
          <Input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="请输入内容"
          />
        </Field>

        <Field label="期数" required>
          <Input
            value={issueNo}
            onChange={(e) => setIssueNo(e.target.value)}
            placeholder="请输入内容"
          />
        </Field>

        <Field label="命中率标签">
          <Input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="手动输入，使用英文逗号,分割"
          />
        </Field>

        {/* 付费内容 */}
        <div>
          <div className="mb-2 flex items-baseline gap-1">
            <span className="text-destructive">*</span>
            <span className="text-sm font-medium text-foreground">付费内容</span>
          </div>
          <div className="relative rounded-md border border-input bg-background shadow-sm">
            <Textarea
              rows={6}
              maxLength={500}
              value={paidContent}
              onChange={(e) => setPaidContent(e.target.value)}
              placeholder="请输入内容"
              className="bg-transparent border-0 resize-none focus-visible:ring-0 shadow-none min-h-[120px]"
            />
            <div className="absolute bottom-2 right-3 text-xs text-muted-foreground">
              {paidContent.length}/500
            </div>
          </div>
        </div>

        <Field label="虚拟浏览量" required>
          <Input
            type="number"
            inputMode="numeric"
            value={virtualViews}
            onChange={(e) => setVirtualViews(e.target.value)}
          />
        </Field>

        <Field label="限购数量" required>
          <Input
            type="number"
            inputMode="numeric"
            value={purchaseLimit}
            onChange={(e) => setPurchaseLimit(e.target.value)}
          />
        </Field>
      </main>


      <div className="p-4 flex items-center justify-center gap-6 bg-card border-t border-border">
        <Button
          variant="outline"
          className="min-w-[96px]"
          onClick={() => navigate({ to: "/merchant/products" })}
          disabled={saving}
        >
          取消
        </Button>
        <Button variant="outline" className="min-w-[96px]" onClick={submit} disabled={saving}>
          {saving ? "提交中…" : "确认"}
        </Button>
      </div>
      <MerchantBottomNav />
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1">
        {required && <span className="text-destructive">*</span>}
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}
