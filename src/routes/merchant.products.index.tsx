import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtCredits } from "@/lib/format";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/merchant/products/")({
  component: ProductsList,
});

function ProductsList() {
  return (
    <RouteGuard title="方案管理" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

type ProductRow = {
  id: string;
  title: string;
  price: number;
  status: string;
  sales_count: number;
  tags: string[] | null;
  issue_no: string | null;
  virtual_views: number | null;
  result: string | null;
  is_public: boolean;
  is_locked: boolean;
  sort: number;
  created_at: string;
  publish_at: string | null;
};

function Inner() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"selling" | "off">("selling");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);

  const load = async () => {
    if (!user) return;
    const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
    if (!m) return;
    const { data } = await (supabase as any)
      .from("products")
      .select("id, title, price, status, sales_count, tags, issue_no, virtual_views, result, is_public, is_locked, sort, created_at, publish_at")
      .eq("merchant_id", m.id)
      .order("sort", { ascending: false })
      .order("created_at", { ascending: false });
    setRows((data ?? []) as ProductRow[]);
  };
  useEffect(() => { load(); }, [user?.id]);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    return rows
      .filter((r) => (tab === "selling" ? !r.is_public : r.is_public))
      .filter((r) => (kw ? (r.title ?? "").includes(kw) : true));
  }, [rows, tab, keyword]);

  const sellingCount = rows.filter((r) => !r.is_public).length;
  const offCount = rows.filter((r) => r.is_public).length;

  const upd = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase as any).from("products").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    return true;
  };

  const onDelete = async (p: ProductRow) => {
    if (!confirm(`确认删除「${p.title}」？`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) toast.error(error.message); else { toast.success("已删除"); load(); }
  };
  const onPin = async (p: ProductRow) => {
    const next = p.sort > 0 ? 0 : Math.floor(Date.now() / 1000);
    if (await upd(p.id, { sort: next })) { toast.success(next ? "已置顶" : "已取消置顶"); load(); }
  };
  const onToggleStatus = async (p: ProductRow) => {
    const next = p.status === "published" ? "unpublished" : "published";
    if (await upd(p.id, { status: next })) { toast.success(next === "published" ? "已上架" : "已下架"); load(); }
  };
  const onToggleHit = async (p: ProductRow) => {
    const next = p.result === "won" ? "pending" : "won";
    if (await upd(p.id, { result: next })) { toast.success("设置成功"); load(); }
  };
  const onToggleLock = async (p: ProductRow) => {
    if (await upd(p.id, { is_locked: !p.is_locked })) { toast.success(!p.is_locked ? "已锁定" : "已取消锁定"); load(); }
  };
  const onTogglePublic = async (p: ProductRow) => {
    const nextPublic = !p.is_public;
    const patch: Record<string, unknown> = { is_public: nextPublic };
    // 公开后归入"已停售"，自动下架避免继续被付款
    if (nextPublic) patch.status = "unpublished";
    if (await upd(p.id, patch)) { toast.success(nextPublic ? "已公开" : "已取消公开"); load(); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="方案管理" />

      <div className="flex items-center justify-around bg-card border-b border-border">
        {([
          { k: "selling" as const, label: `售卖中` },
          { k: "off" as const, label: `已停售` },
        ]).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 text-center py-3 text-sm relative",
              tab === k ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
            {tab === k && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-info rounded-full" />
            )}
          </button>
        ))}
        <Link to="/merchant/products/new" className="flex-1 text-center py-3 text-sm text-info">
          +添加新方案
        </Link>
      </div>

      <div className="px-3 pt-3">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="🔍 搜索产品名"
          className="bg-muted/40 border-0"
        />
      </div>

      <main className="flex-1 px-3 py-3 space-y-3">
        {filtered.length === 0 && (
          <p className="text-center py-12 text-muted-foreground text-sm">
            {tab === "selling" ? "暂无售卖中方案" : "暂无已停售方案"}
          </p>
        )}

        {filtered.map((p) => {
          const hit = p.result === "won";
          return (
            <div key={p.id} className="bg-card rounded-md p-3 space-y-2">
              <Link
                to="/product/$productId"
                params={{ productId: p.id }}
                className="block text-base font-medium text-foreground hover:text-info"
              >
                {p.issue_no ? `${p.issue_no}期 ` : ""}{p.title}
              </Link>

              {tab === "off" && (
                <div className="text-lg font-semibold text-foreground">{p.issue_no ?? ""}期</div>
              )}

              {(p.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {p.tags!.map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "px-2 py-0.5 rounded text-xs",
                        hit ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
                      )}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center text-xs text-muted-foreground gap-3 flex-wrap">
                <span>{fmtDate(p.publish_at ?? p.created_at)} 发布</span>
                <span>浏览:{p.virtual_views ?? 0}次</span>
                <span>已售:{p.sales_count}次</span>
                <span className="text-destructive font-semibold text-sm ml-auto">
                  {fmtCredits(p.price)} 面包 ›
                </span>
              </div>

              {tab === "off" && (
                <div className="text-xs text-destructive">排序:{p.sort}</div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {tab === "selling" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-3 text-xs"
                    onClick={() => onDelete(p)}
                  >
                    删除
                  </Button>
                )}
                <ChipBtn onClick={() => onPin(p)}>{p.sort > 0 ? "取消置顶" : "置顶"}</ChipBtn>
                <ChipBtn onClick={() => onToggleStatus(p)}>
                  {p.status === "published" ? "下架" : "上架"}
                </ChipBtn>
                <ChipBtn onClick={() => onToggleHit(p)}>
                  {hit ? "取消命中" : "设置命中"}
                </ChipBtn>
                <ChipBtn onClick={() => onToggleLock(p)}>
                  {p.is_locked ? "取消锁定" : "锁定"}
                </ChipBtn>
                <Link to="/merchant/products/$productId/issues" params={{ productId: p.id }}>
                  <ChipBtn>修改</ChipBtn>
                </Link>
                <ChipBtn onClick={() => onTogglePublic(p)}>
                  {p.is_public ? "不公开" : "公开"}
                </ChipBtn>
              </div>
            </div>
          );
        })}

        <p className="text-center text-xs text-muted-foreground py-6">没有更多了</p>
      </main>
    </div>
  );
}

function ChipBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="h-7 px-3 text-xs rounded border border-border bg-background text-foreground hover:bg-muted"
    >
      {children}
    </button>
  );
}
