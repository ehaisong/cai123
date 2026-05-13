import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { Search, Eye } from "lucide-react";

export const Route = createFileRoute("/pc/users")({
  component: UsersPage,
});

type Row = {
  id: string;
  user_id: string;
  shop_name: string;
  status: string;
  is_disabled: boolean;
  total_sales: number;
  created_at: string;
  real_name: string | null;
  phone?: string | null;
  agents: number;
  customers: number;
};

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待审核（申请）" },
  { key: "approved", label: "已开店" },
  { key: "disabled", label: "已禁用" },
] as const;

function UsersPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [pendings, setPendings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);

    // merchants + 申请列表
    const [{ data: merchants }, { data: apps }] = await Promise.all([
      supabase.from("merchants").select("id,user_id,shop_name,status,is_disabled,total_sales,created_at,real_name").order("created_at", { ascending: false }).limit(500),
      supabase.from("merchant_applications").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);

    const userIds = (merchants ?? []).map((m: any) => m.user_id);
    const merchantIds = (merchants ?? []).map((m: any) => m.id);
    const [{ data: profs }, { data: ar }] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("user_id,phone").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
      merchantIds.length ? supabase.from("agent_relations").select("bound_merchant_id,is_agent").in("bound_merchant_id", merchantIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const phoneMap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p.phone]));
    const agentCount: Record<string, number> = {};
    const custCount: Record<string, number> = {};
    (ar ?? []).forEach((a: any) => {
      const k = a.bound_merchant_id;
      if (a.is_agent) agentCount[k] = (agentCount[k] ?? 0) + 1;
      else custCount[k] = (custCount[k] ?? 0) + 1;
    });

    setRows((merchants ?? []).map((m: any) => ({
      ...m,
      phone: phoneMap[m.user_id] ?? null,
      agents: agentCount[m.id] ?? 0,
      customers: custCount[m.id] ?? 0,
    })));
    setPendings(apps ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (tab === "approved") list = list.filter((r) => r.status === "approved" && !r.is_disabled);
    else if (tab === "disabled") list = list.filter((r) => r.is_disabled);
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter((r) =>
        r.shop_name?.toLowerCase().includes(k) ||
        r.real_name?.toLowerCase().includes(k) ||
        r.phone?.includes(k),
      );
    }
    return list;
  }, [rows, tab, keyword]);

  const reviewApp = async (app: any, approve: boolean, reason?: string) => {
    if (approve) {
      const { error: me } = await supabase.from("merchants").upsert({
        user_id: app.user_id,
        shop_name: app.shop_name ?? (app.real_name ? app.real_name + " 的店铺" : "新店铺"),
        shop_avatar_url: app.shop_avatar_url ?? null,
        real_name: app.real_name,
        wechat_id: app.wechat_id,
        fans_count: app.fans_count,
        public_account: app.public_account,
        shop_description: app.description,
        status: "approved",
      }, { onConflict: "user_id" });
      if (me) { toast.error(me.message); return; }
      const { error: re } = await supabase.from("user_roles").insert({ user_id: app.user_id, role: "merchant" }).select();
      if (re && re.code !== "23505") { toast.error(re.message); return; }
    }
    const { error } = await supabase.from("merchant_applications").update({
      status: approve ? "approved" : "rejected",
      reject_reason: reason ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", app.id);
    if (error) { toast.error(error.message); return; }
    toast.success(approve ? "已通过" : "已驳回");
    load();
  };

  const toggleDisable = async (m: Row) => {
    const next = !m.is_disabled;
    const reason = next ? prompt("关店原因（可选）") ?? null : null;
    const { error } = await supabase.from("merchants").update({
      is_disabled: next,
      disabled_reason: reason,
      disabled_at: next ? new Date().toISOString() : null,
    }).eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? "已关店" : "已恢复");
    load();
  };

  return (
    <div>
      <PcPageHeader
        title="用户管理"
        description="按商家维度展开 → 旗下代理 → 代理旗下客户"
      />

      <div className="bg-card border border-border rounded-xl mb-4">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {t.label}
                {t.key === "pending" && pendings.length > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[11px] px-1">
                    {pendings.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-72">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索店铺名 / 联系人 / 手机号" className="h-8" />
          </div>
        </div>

        {tab === "pending" ? (
          <div className="p-4 space-y-2">
            {pendings.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">暂无待审核申请</p> : pendings.map((a) => (
              <div key={a.id} className="border border-border rounded-md p-3 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.shop_name ?? a.real_name ?? "未填店铺名"}</div>
                  <div className="text-xs text-muted-foreground mt-1">手机号 {a.phone ?? "—"} · 联系人 {a.real_name ?? "—"} · 微信 {a.wechat_id ?? "—"}</div>
                  {a.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</div>}
                  <div className="text-xs text-muted-foreground mt-1">提交时间：{fmtDate(a.created_at)}</div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button size="sm" onClick={() => reviewApp(a, true)}>通过 / 开店</Button>
                  <Button size="sm" variant="outline" onClick={() => { const r = prompt("驳回理由"); if (r) reviewApp(a, false, r); }}>驳回</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>店铺</TableHead>
                <TableHead>负责人/手机</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">销售总额</TableHead>
                <TableHead className="text-right">代理 / 客户</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">暂无数据</TableCell></TableRow>
              )}
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.shop_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.real_name ?? "—"} / {m.phone ?? "—"}</TableCell>
                  <TableCell>
                    {m.is_disabled
                      ? <span className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive">已关店</span>
                      : m.status === "approved"
                        ? <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">营业中</span>
                        : <span className="text-xs px-2 py-0.5 rounded bg-warning/10 text-warning">{m.status}</span>}
                  </TableCell>
                  <TableCell className="text-right">{fmtMoney(m.total_sales)}</TableCell>
                  <TableCell className="text-right text-sm">{m.agents} / {m.customers}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(m.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link to="/pc/users/merchant/$merchantId" params={{ merchantId: m.id }}>
                        <Button size="sm" variant="outline"><Eye className="h-3 w-3 mr-1" />详情</Button>
                      </Link>
                      <Button size="sm" variant={m.is_disabled ? "default" : "outline"} onClick={() => toggleDisable(m)}>
                        {m.is_disabled ? "重新开店" : "关店"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
