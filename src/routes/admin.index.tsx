import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  const { user, hasRole, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"apps" | "withdraw" | "recharge" | "config">("apps");

  if (loading) return <div className="h5-shell"><PageHeader title="管理后台" /><p className="text-center py-12 text-sm text-muted-foreground">加载中…</p></div>;
  if (!user) return <div className="h5-shell"><PageHeader title="管理后台" /><div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div></div>;
  if (!hasRole("admin")) return <div className="h5-shell"><PageHeader title="管理后台" /><p className="text-center py-12 text-sm text-destructive">您不是管理员</p></div>;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="管理后台" />
      <div className="bg-card border-b border-border flex">
        {[
          { k: "apps", l: "商家审核" }, { k: "withdraw", l: "提现审批" },
          { k: "recharge", l: "手动充值" }, { k: "config", l: "分成配置" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k as any)} className={`flex-1 py-3 text-xs ${tab === t.k ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
            {t.l}
          </button>
        ))}
      </div>
      <main className="flex-1 px-3 py-3">
        {tab === "apps" && <ApplicationsTab />}
        {tab === "withdraw" && <WithdrawTab />}
        {tab === "recharge" && <RechargeTab />}
        {tab === "config" && <ConfigTab />}
      </main>
    </div>
  );
}

function ApplicationsTab() {
  const [list, setList] = useState<any[]>([]);
  const load = () => supabase.from("merchant_applications").select("*").order("created_at", { ascending: false }).then(({ data }) => setList(data ?? []));
  useEffect(() => { load(); }, []);
  const review = async (app: any, approve: boolean, reason?: string) => {
    if (approve) {
      // 创建商家
      const { error: me } = await supabase.from("merchants").upsert({
        user_id: app.user_id,
        shop_name: app.real_name + " 的店铺",
        real_name: app.real_name,
        wechat_id: app.wechat_id,
        fans_count: app.fans_count,
        public_account: app.public_account,
        shop_description: app.description,
        status: "approved",
      }, { onConflict: "user_id" });
      if (me) { toast.error(me.message); return; }
      await supabase.from("user_roles").insert({ user_id: app.user_id, role: "merchant" }).select();
    }
    const { error } = await supabase.from("merchant_applications").update({
      status: approve ? "approved" : "rejected",
      reject_reason: reason ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", app.id);
    if (error) toast.error(error.message); else { toast.success(approve ? "已通过" : "已驳回"); load(); }
  };
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无申请</p>}
      {list.map((a) => (
        <div key={a.id} className="bg-card rounded-md p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{a.real_name}</div>
            <span className={`text-xs px-2 py-0.5 rounded ${a.status === "approved" ? "bg-success/10 text-success" : a.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
              {({ pending: "待审核", approved: "已通过", rejected: "已驳回" } as any)[a.status]}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">{a.phone} · 微信 {a.wechat_id} · 粉丝 {a.fans_count}</div>
          <p className="text-xs mt-1 text-muted-foreground line-clamp-2">{a.description}</p>
          {a.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-success-foreground" onClick={() => review(a, true)}>通过</Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { const r = prompt("驳回理由"); if (r) review(a, false, r); }}>驳回</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WithdrawTab() {
  const [list, setList] = useState<any[]>([]);
  const load = () => supabase.from("withdrawals").select("*, profiles!inner(nickname, user_code)").order("created_at", { ascending: false }).then(({ data }) => setList(data ?? []));
  useEffect(() => { load(); }, []);
  const review = async (w: any, status: "approved" | "rejected" | "paid", reason?: string) => {
    const { error } = await supabase.from("withdrawals").update({ status, reject_reason: reason ?? null, reviewed_at: new Date().toISOString() }).eq("id", w.id);
    if (error) toast.error(error.message); else { toast.success("已更新"); load(); }
  };
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无提现</p>}
      {list.map((w) => (
        <div key={w.id} className="bg-card rounded-md p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{fmtMoney(w.amount)} · {w.channel}</div>
            <span className="text-xs text-muted-foreground">{fmtDate(w.created_at)}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">{w.account_info}</div>
          {w.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => review(w, "paid")}>标记已打款</Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { const r = prompt("驳回理由"); if (r) review(w, "rejected", r); }}>驳回</Button>
            </div>
          )}
          {w.status !== "pending" && <div className="mt-1 text-xs text-success">{w.status}</div>}
        </div>
      ))}
    </div>
  );
}

function RechargeTab() {
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const submit = async () => {
    const { data: p } = await supabase.from("profiles").select("user_id").eq("user_code", code).maybeSingle();
    if (!p) { toast.error("用户不存在"); return; }
    const { error } = await supabase.rpc("admin_recharge_user", { _user_id: p.user_id, _amount: amount, _note: note || undefined });
    if (error) toast.error(error.message); else { toast.success("充值成功"); setCode(""); setAmount(100); setNote(""); }
  };
  return (
    <div className="bg-card rounded-md p-4 space-y-3">
      <div><label className="text-xs">用户编号 (uXXXXXX)</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 u12345678" /></div>
      <div><label className="text-xs">金额 (¥)</label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
      <div><label className="text-xs">备注（可选）</label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <Button className="w-full" onClick={submit}>立即充值</Button>
    </div>
  );
}

function ConfigTab() {
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => { supabase.from("commission_config").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => setCfg(data)); }, []);
  if (!cfg) return <p>加载中…</p>;
  const save = async () => {
    const { error } = await supabase.from("commission_config").update({ l1_rate: cfg.l1_rate, l2_rate: cfg.l2_rate, platform_rate: cfg.platform_rate, updated_at: new Date().toISOString() }).eq("id", cfg.id);
    if (error) toast.error(error.message); else toast.success("已保存");
  };
  return (
    <div className="bg-card rounded-md p-4 space-y-3">
      <div><label className="text-xs">一级代理分成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l1_rate} onChange={(e) => setCfg({ ...cfg, l1_rate: Number(e.target.value) })} /></div>
      <div><label className="text-xs">二级代理分成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l2_rate} onChange={(e) => setCfg({ ...cfg, l2_rate: Number(e.target.value) })} /></div>
      <div><label className="text-xs">平台抽成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.platform_rate} onChange={(e) => setCfg({ ...cfg, platform_rate: Number(e.target.value) })} /></div>
      <p className="text-xs text-muted-foreground">商家实得 = 1 - L1 - L2 - 平台</p>
      <Button className="w-full" onClick={save}>保存配置</Button>
    </div>
  );
}
