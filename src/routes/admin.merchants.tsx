import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Search, Ban, CheckCircle2 } from "lucide-react";
import { AdminUserDetailExtras, DisableHistory, OrdersLink } from "@/components/admin/user-detail-extras";

export const Route = createFileRoute("/admin/merchants")({
  component: () => (
    <RouteGuard title="商家管理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

type Merchant = {
  id: string;
  user_id: string;
  shop_name: string;
  real_name: string | null;
  status: string;
  is_disabled: boolean;
  disabled_reason: string | null;
  disabled_at: string | null;
  total_sales: number;
  fans_count: number | null;
  wechat_id: string | null;
  created_at: string;
  l1_rate: number;
  l1_max_rate: number;
};

function Inner() {
  const [list, setList] = useState<Merchant[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Merchant | null>(null);
  const [rate, setRate] = useState("");
  const [maxRate, setMaxRate] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("merchants")
      .select("id, user_id, shop_name, real_name, status, is_disabled, disabled_reason, disabled_at, total_sales, fans_count, wechat_id, created_at, l1_rate, l1_max_rate")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { reportRpcError(error, { op: "merchants.select", scope: "AdminMerchants" }); return; }
    setList((data ?? []) as Merchant[]);
  };
  useEffect(() => { load(); }, []);

  const filtered = list.filter((m) =>
    !keyword.trim() ||
    m.shop_name?.toLowerCase().includes(keyword.toLowerCase()) ||
    m.real_name?.toLowerCase().includes(keyword.toLowerCase()) ||
    m.wechat_id?.toLowerCase().includes(keyword.toLowerCase()),
  );

  const toggleDisable = async (m: Merchant) => {
    const next = !m.is_disabled;
    const reason = next ? prompt("请输入禁用原因（可选）") ?? null : null;
    const { error } = await supabase.from("merchants").update({
      is_disabled: next,
      disabled_reason: reason,
      disabled_at: next ? new Date().toISOString() : null,
    }).eq("id", m.id);
    if (error) { reportRpcError(error, { op: "merchants.update(is_disabled)", scope: "AdminMerchants" }); return; }
    toast.success(next ? "已禁用店铺" : "已恢复店铺");
    load();
    setSelected(null);
  };

  const openEdit = (m: Merchant) => {
    setSelected(m);
    setRate((Number(m.l1_rate) * 100).toString());
    setMaxRate((Number(m.l1_max_rate) * 100).toString());
  };

  const saveRate = async () => {
    if (!selected) return;
    const r = Number(rate), mx = Number(maxRate);
    if (!Number.isFinite(r) || !Number.isFinite(mx) || r < 0 || mx < 0 || mx > 92) { toast.error("分成上限不能超过 92%"); return; }
    if (r > mx) { toast.error("默认分成不能超过上限"); return; }
    const { error } = await supabase.from("merchants").update({
      l1_rate: r / 100, l1_max_rate: mx / 100, l2_enabled: false, l2_rate: 0,
    }).eq("id", selected.id);
    if (error) { reportRpcError(error, { op: "merchants.update_rate", scope: "AdminMerchants" }); toast.error(error.message); return; }
    toast.success("已保存分成");
    load();
    setSelected(null);
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家管理" />
      <div className="bg-card border-b border-border px-3 py-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input className="h-8 text-sm" placeholder="搜索店铺名/真实姓名/微信号" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-4 text-sm text-muted-foreground">加载中…</p>}
        {!loading && filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无商家</p>}
        {filtered.map((m) => (
          <button key={m.id} onClick={() => openEdit(m)} className="w-full text-left bg-card rounded-md p-3 hover:bg-accent">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">{m.shop_name}</div>
              <span className="text-xs text-primary">分成 {(Number(m.l1_rate) * 100).toFixed(0)}% / 上限 {(Number(m.l1_max_rate) * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-1">
              <span className={`text-xs px-2 py-0.5 rounded ${m.is_disabled ? "bg-destructive/10 text-destructive" : m.status === "approved" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                {m.is_disabled ? "已禁用" : m.status === "approved" ? "正常" : m.status}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {m.real_name ?? "-"} · 销售额 {fmtMoney(m.total_sales)} · 粉丝 {m.fans_count ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">入驻：{fmtDate(m.created_at)}</div>
          </button>
        ))}
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setSelected(null)}>
          <div className="w-full bg-card rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between sticky top-0 bg-card pb-2 -mx-4 px-4 border-b border-border">
              <h3 className="text-base font-medium">{selected.shop_name}</h3>
              <button onClick={() => setSelected(null)} className="text-sm text-muted-foreground">关闭</button>
            </div>
            <div className="text-sm space-y-1">
              <div>真实姓名：{selected.real_name ?? "-"}</div>
              <div>微信号：{selected.wechat_id ?? "-"}</div>
              <div>粉丝数：{selected.fans_count ?? 0}</div>
              <div>累计销售：{fmtMoney(selected.total_sales)}</div>
              <div>状态：{selected.is_disabled ? "已禁用" : selected.status}</div>
              <div>入驻时间：{fmtDate(selected.created_at)}</div>
            </div>
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              <div className="text-sm font-medium">分成设置（一级，最高 92%）</div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-20 text-muted-foreground">默认分成</span>
                <Input type="number" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} />
                <span className="text-xs">%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-20 text-muted-foreground">分成上限</span>
                <Input type="number" step="0.5" max={92} value={maxRate} onChange={(e) => setMaxRate(e.target.value)} />
                <span className="text-xs">%</span>
              </div>
              <Button className="w-full" size="sm" onClick={saveRate}>保存分成</Button>
            </div>
            <DisableHistory isDisabled={selected.is_disabled} reason={selected.disabled_reason} at={selected.disabled_at} />
            <AdminUserDetailExtras
              userId={selected.user_id}
              asMerchantUser
              ordersLink={<OrdersLink to="/admin/orders" search={{ merchant_id: selected.id }} label="查看该店铺的订单" />}
            />
            <Button
              variant={selected.is_disabled ? "default" : "destructive"}
              className="w-full"
              onClick={() => toggleDisable(selected)}
            >
              {selected.is_disabled
                ? <><CheckCircle2 className="h-4 w-4 mr-1" />恢复店铺</>
                : <><Ban className="h-4 w-4 mr-1" />禁用店铺</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
