import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Search, FileX } from "lucide-react";

export const Route = createFileRoute("/merchant/affiliations")({
  component: () => (
    <RouteGuard title="挂靠服务" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

type TabKey = "applied" | "hosts" | "incoming" | "affiliates";
type Aff = {
  id: string;
  affiliate_merchant_id: string;
  host_merchant_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  affiliate?: { shop_name: string; shop_avatar_url: string | null; shop_description: string | null } | null;
  host?: { shop_name: string; shop_avatar_url: string | null; shop_description: string | null } | null;
};
type MerchantOpt = { id: string; shop_name: string; shop_avatar_url: string | null; shop_description: string | null };

const TABS: { key: TabKey; label: string }[] = [
  { key: "applied", label: "申请记录" },
  { key: "hosts", label: "已挂靠商家" },
  { key: "incoming", label: "审核挂靠申请" },
  { key: "affiliates", label: "挂靠我的商家" },
];

function Inner() {
  const { user } = useAuth();
  const [myMerchantId, setMyMerchantId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("applied");
  const [list, setList] = useState<Aff[]>([]);
  const [loading, setLoading] = useState(false);

  // 申请表单
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<MerchantOpt[]>([]);
  const [picked, setPicked] = useState<MerchantOpt | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setMyMerchantId(data?.id ?? null));
  }, [user?.id]);

  const load = async () => {
    if (!myMerchantId) return;
    setLoading(true);
    let q = supabase.from("merchant_affiliations").select("*").order("created_at", { ascending: false });
    if (tab === "applied") q = q.eq("affiliate_merchant_id", myMerchantId);
    if (tab === "hosts") q = q.eq("affiliate_merchant_id", myMerchantId).eq("status", "approved");
    if (tab === "incoming") q = q.eq("host_merchant_id", myMerchantId).eq("status", "pending");
    if (tab === "affiliates") q = q.eq("host_merchant_id", myMerchantId).eq("status", "approved");
    const { data, error } = await q;
    if (error) { reportRpcError(error, { op: "merchant_affiliations.select", scope: "Affiliations" }); setLoading(false); return; }
    const rows = (data ?? []) as Aff[];
    const ids = Array.from(new Set(rows.flatMap(r => [r.affiliate_merchant_id, r.host_merchant_id])));
    if (ids.length) {
      const { data: ms } = await supabase.from("merchants").select("id, shop_name, shop_avatar_url, shop_description").in("id", ids);
      const map = new Map((ms ?? []).map(m => [m.id, m]));
      rows.forEach(r => {
        r.affiliate = map.get(r.affiliate_merchant_id) as any ?? null;
        r.host = map.get(r.host_merchant_id) as any ?? null;
      });
    }
    setList(rows);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, myMerchantId]);

  const search = async () => {
    const kw = keyword.trim();
    if (!kw) { setResults([]); return; }
    const { data } = await supabase
      .from("merchants")
      .select("id, shop_name, shop_avatar_url, shop_description")
      .eq("status", "approved")
      .eq("is_disabled", false)
      .ilike("shop_name", `%${kw}%`)
      .limit(10);
    setResults((data ?? []).filter(m => m.id !== myMerchantId) as MerchantOpt[]);
  };

  const submit = async () => {
    if (!picked) { toast.error("请先选择要挂靠的商家"); return; }
    setSubmitting(true);
    const { error } = await supabase.rpc("apply_affiliation", { _host_merchant_id: picked.id, _note: note || null });
    setSubmitting(false);
    if (error) { toast.error(error.message ?? "申请失败"); return; }
    toast.success("申请已提交");
    setPicked(null); setKeyword(""); setResults([]); setNote("");
    setTab("applied"); load();
  };

  const review = async (id: string, approve: boolean) => {
    const { error } = await supabase.rpc("review_affiliation", { _id: id, _approve: approve });
    if (error) { toast.error(error.message ?? "操作失败"); return; }
    toast.success(approve ? "已通过" : "已拒绝");
    load();
  };
  const cancel = async (id: string) => {
    const { error } = await supabase.rpc("cancel_affiliation", { _id: id });
    if (error) { toast.error(error.message ?? "操作失败"); return; }
    toast.success("已取消");
    load();
  };

  const statusLabel = (s: Aff["status"]) =>
    ({ pending: "待审核", approved: "已通过", rejected: "已拒绝", cancelled: "已取消" })[s];
  const statusClass = (s: Aff["status"]) =>
    s === "approved" ? "bg-success/10 text-success"
    : s === "pending" ? "bg-warning/10 text-warning"
    : "bg-muted text-muted-foreground";

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="挂靠服务" />

      {/* 申请表单 */}
      <div className="px-4 pt-4 space-y-3">
        <div className="relative">
          <Input
            value={picked ? picked.shop_name : keyword}
            onChange={(e) => { setPicked(null); setKeyword(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder="搜索商家"
            className="bg-muted border-0 h-12 pr-10"
          />
          <button onClick={search} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="h-4 w-4" />
          </button>
          {results.length > 0 && !picked && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-md max-h-60 overflow-auto">
              {results.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setPicked(m); setResults([]); setKeyword(""); }}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2"
                >
                  {m.shop_avatar_url
                    ? <img src={m.shop_avatar_url} alt="" className="w-7 h-7 rounded object-cover" />
                    : <div className="w-7 h-7 rounded bg-muted" />}
                  <span className="truncate">{m.shop_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="请输入说明备注（选填）"
          rows={5}
          className="bg-muted border-0 resize-none"
        />

        <Button onClick={submit} disabled={submitting || !picked} className="w-full h-12 text-base">
          {submitting ? "提交中…" : "提交申请"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="mt-2 border-b border-border bg-card">
        <div className="flex overflow-x-auto no-scrollbar">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 px-4 py-3 text-sm relative ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                {t.label}
                {active && <span className="absolute left-1/2 -translate-x-1/2 bottom-0.5 h-0.5 w-6 bg-primary rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-6 text-sm text-muted-foreground">加载中…</p>}
        {!loading && list.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-32 h-32 rounded-full bg-muted/40 flex items-center justify-center">
              <FileX className="w-12 h-12 text-muted-foreground/50" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">暂无数据</p>
          </div>
        )}
        {list.map(r => {
          const showSide = tab === "applied" || tab === "hosts" ? r.host : r.affiliate;
          return (
            <div key={r.id} className="bg-card rounded-md p-3 flex items-center gap-3">
              {showSide?.shop_avatar_url
                ? <img src={showSide.shop_avatar_url} alt="" className="w-12 h-12 rounded object-cover" />
                : <div className="w-12 h-12 rounded bg-muted" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{showSide?.shop_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {showSide?.shop_description || (r.note ? `备注：${r.note}` : "暂无简介")}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(r.created_at)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {tab === "applied" && (
                  <>
                    <span className={`text-xs px-2 py-1 rounded ${statusClass(r.status)}`}>{statusLabel(r.status)}</span>
                    {r.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => cancel(r.id)}>撤销</Button>
                    )}
                  </>
                )}
                {tab === "hosts" && (
                  <>
                    <span className="text-xs px-3 py-1 rounded-full bg-primary text-primary-foreground">已挂靠</span>
                    <Button size="sm" variant="outline" onClick={() => cancel(r.id)}>取消挂靠</Button>
                  </>
                )}
                {tab === "incoming" && (
                  <>
                    <Button size="sm" onClick={() => review(r.id, true)}>通过</Button>
                    <Button size="sm" variant="outline" onClick={() => review(r.id, false)}>拒绝</Button>
                  </>
                )}
                {tab === "affiliates" && (
                  <Button size="sm" variant="outline" onClick={() => cancel(r.id)}>解除</Button>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
