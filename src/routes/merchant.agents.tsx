import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/agents")({
  component: () => (
    <RouteGuard title="代理管理" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchant, setMerchant] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [rate, setRate] = useState("");

  const load = async () => {
    if (!user) return;
    const { data: m } = await supabase.from("merchants").select("id, l1_rate, l1_max_rate").eq("user_id", user.id).maybeSingle();
    setMerchant(m);
    if (!m) return;
    const { data, error } = await supabase.rpc("merchant_agents_with_stats" as any);
    if (error) { reportRpcError(error, { op: "merchant_agents_with_stats", scope: "MerchantAgents" }); return; }
    setRows((data as any[]) ?? []);
  };
  useEffect(() => { load(); }, [user?.id]);

  const filtered = useMemo(() => rows.filter((r) =>
    !keyword.trim() ||
    r.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
    r.agent_code?.toLowerCase().includes(keyword.toLowerCase()) ||
    r.phone?.includes(keyword),
  ), [rows, keyword]);

  const maxPct = merchant ? Number(merchant.l1_max_rate) * 100 : 0;
  const defaultPct = merchant ? Number(merchant.l1_rate) * 100 : 0;

  const openEdit = (e: React.MouseEvent, r: any) => {
    e.stopPropagation();
    setEditing(r);
    setRate(r.l1_rate != null ? (Number(r.l1_rate) * 100).toString() : "");
  };

  const save = async () => {
    if (!editing) return;
    const v = rate.trim() === "" ? null : Number(rate);
    if (v != null && (!Number.isFinite(v) || v < 0 || v > maxPct)) { toast.error(`比例需在 0 - ${maxPct}% 之间，留空表示使用默认`); return; }
    const { error } = await supabase.rpc("merchant_set_agent_rate", { _user_id: editing.user_id, _rate: (v == null ? null : v / 100) as any });
    if (error) { reportRpcError(error, { op: "merchant_set_agent_rate", scope: "MerchantAgents" }); toast.error(error.message); return; }
    toast.success("已保存");
    setEditing(null);
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理管理" />
      <div className="bg-card border-b border-border px-3 py-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input className="h-8 text-sm" placeholder="搜索昵称/代理码/手机号" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      {merchant && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          默认分成 {defaultPct}% · 上限 {maxPct}%
        </div>
      )}
      <main className="flex-1 px-3 pb-3 space-y-2">
        {filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无代理</p>}
        {filtered.map((r) => {
          const pct = r.l1_rate != null ? (Number(r.l1_rate) * 100).toFixed(2).replace(/\.?0+$/, "") + "%" : `默认 ${defaultPct}%`;
          return (
            <div
              key={r.user_id}
              onClick={() => navigate({ to: "/merchant/agents/$userId", params: { userId: r.user_id } })}
              className="w-full text-left bg-card rounded-md p-3 hover:bg-accent cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium truncate flex items-center gap-1">
                  {r.nickname ?? "未命名"}
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </div>
                <span className="text-xs text-primary">{pct}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">代理码 {r.agent_code ?? "-"} · {r.phone ?? "-"}</div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="text-xs">
                  <span className="text-muted-foreground">引流客户：</span>
                  <span className="text-foreground font-medium">{Number(r.customer_count ?? 0)} 人</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">昨日收入：</span>
                  <span className="text-success font-medium">{fmtMoney(r.yesterday_income)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-muted-foreground">加入：{fmtDate(r.created_at)}</div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => openEdit(e, r)}>修改比例</Button>
              </div>
            </div>
          );
        })}
      </main>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setEditing(null)}>
          <div className="w-full bg-card rounded-t-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium">设置分成 · {editing.nickname ?? "代理"}</h3>
              <button onClick={() => setEditing(null)} className="text-sm text-muted-foreground">关闭</button>
            </div>
            <p className="text-xs text-muted-foreground">留空使用商家默认分成 {defaultPct}%；上限 {maxPct}%</p>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.5" min={0} max={maxPct} placeholder={`默认 ${defaultPct}`} value={rate} onChange={(e) => setRate(e.target.value)} />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setRate(""); }}>使用默认</Button>
              <Button className="flex-1" onClick={save}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
