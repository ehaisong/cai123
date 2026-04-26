import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Search, Ban, CheckCircle2 } from "lucide-react";
import { AdminUserDetailExtras, DisableHistory, OrdersLink } from "@/components/admin/user-detail-extras";

export const Route = createFileRoute("/admin/users")({
  component: () => (
    <RouteGuard title="用户管理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

type Profile = {
  id: string;
  user_id: string;
  user_code: string;
  nickname: string | null;
  phone: string | null;
  is_disabled: boolean;
  disabled_reason: string | null;
  disabled_at: string | null;
  created_at: string;
};

function Inner() {
  const [list, setList] = useState<Profile[]>([]);
  const [walletMap, setWalletMap] = useState<Record<string, number>>({});
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, user_id, user_code, nickname, phone, is_disabled, disabled_reason, disabled_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) { reportRpcError(error, { op: "profiles.select", scope: "AdminUsers" }); setLoading(false); return; }
    const profiles = (data ?? []) as Profile[];
    setList(profiles);
    const ids = profiles.map((p) => p.user_id);
    if (ids.length > 0) {
      const { data: wallets } = await supabase.from("wallets").select("user_id, balance").in("user_id", ids);
      const m: Record<string, number> = {};
      (wallets ?? []).forEach((w: any) => { m[w.user_id] = Number(w.balance); });
      setWalletMap(m);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => list.filter((p) =>
    !keyword.trim() ||
    p.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
    p.user_code?.toLowerCase().includes(keyword.toLowerCase()) ||
    p.phone?.includes(keyword),
  ), [list, keyword]);

  const toggleDisable = async (p: Profile) => {
    const next = !p.is_disabled;
    const reason = next ? prompt("请输入禁用原因（可选）") ?? null : null;
    const { error } = await supabase.from("profiles").update({
      is_disabled: next,
      disabled_reason: reason,
      disabled_at: next ? new Date().toISOString() : null,
    }).eq("id", p.id);
    if (error) { reportRpcError(error, { op: "profiles.update(is_disabled)", scope: "AdminUsers" }); return; }
    toast.success(next ? "已禁用账号" : "已恢复账号");
    setSelected(null);
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="用户管理" />
      <div className="bg-card border-b border-border px-3 py-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input className="h-8 text-sm" placeholder="搜索昵称/用户编号/手机号" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-4 text-sm text-muted-foreground">加载中…</p>}
        {!loading && filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无用户</p>}
        {filtered.map((p) => (
          <button key={p.id} onClick={() => setSelected(p)} className="w-full text-left bg-card rounded-md p-3 hover:bg-accent">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">{p.nickname ?? "未命名"}</div>
              {p.is_disabled
                ? <span className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive">已禁用</span>
                : <span className="text-xs text-muted-foreground">{fmtMoney(walletMap[p.user_id] ?? 0)}</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              编号 {p.user_code} · {p.phone ?? "未绑定手机"}
            </div>
          </button>
        ))}
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setSelected(null)}>
          <div className="w-full bg-card rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between sticky top-0 bg-card pb-2 -mx-4 px-4 border-b border-border">
              <h3 className="text-base font-medium">{selected.nickname ?? "未命名"}</h3>
              <button onClick={() => setSelected(null)} className="text-sm text-muted-foreground">关闭</button>
            </div>
            <div className="text-sm space-y-1">
              <div>用户编号：{selected.user_code}</div>
              <div>手机号：{selected.phone ?? "-"}</div>
              <div>注册时间：{fmtDate(selected.created_at)}</div>
              <div>状态：{selected.is_disabled ? "已禁用" : "正常"}</div>
            </div>
            <DisableHistory isDisabled={selected.is_disabled} reason={selected.disabled_reason} at={selected.disabled_at} />
            <AdminUserDetailExtras
              userId={selected.user_id}
              ordersLink={<OrdersLink to="/admin/orders" search={{ buyer_id: selected.user_id }} label="查看该用户的订单" />}
            />
            <Button variant={selected.is_disabled ? "default" : "destructive"} className="w-full" onClick={() => toggleDisable(selected)}>
              {selected.is_disabled
                ? <><CheckCircle2 className="h-4 w-4 mr-1" />恢复账号</>
                : <><Ban className="h-4 w-4 mr-1" />禁用账号</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
