import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const load = async () => {
    const { data, error } = await supabase
      .from("merchant_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      reportRpcError(error, { op: "merchant_applications.select", scope: "AdminHome/ApplicationsTab" });
      return;
    }
    setList(data ?? []);
  };
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
      if (me) {
        reportRpcError(me, {
          op: "merchants.upsert",
          scope: "AdminHome/ApplicationsTab.review",
          payload: { user_id: app.user_id, application_id: app.id },
        });
        return;
      }
      const { error: re } = await supabase
        .from("user_roles")
        .insert({ user_id: app.user_id, role: "merchant" })
        .select();
      if (re && re.code !== "23505") {
        // 23505 重复角色可忽略
        reportRpcError(re, {
          op: "user_roles.insert(merchant)",
          scope: "AdminHome/ApplicationsTab.review",
          payload: { user_id: app.user_id },
        });
      }
    }
    const { error } = await supabase.from("merchant_applications").update({
      status: approve ? "approved" : "rejected",
      reject_reason: reason ?? null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", app.id);
    if (error) {
      reportRpcError(error, {
        op: "merchant_applications.update",
        scope: "AdminHome/ApplicationsTab.review",
        payload: { id: app.id, approve, reason },
      });
    } else {
      reportRpcSuccess("merchant_applications.update", { id: app.id, approve });
      toast.success(approve ? "已通过" : "已驳回");
      load();
    }
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
  const load = async () => {
    const { data, error } = await supabase
      .from("withdrawals")
      .select("*, profiles!inner(nickname, user_code)")
      .order("created_at", { ascending: false });
    if (error) {
      reportRpcError(error, { op: "withdrawals.select", scope: "AdminHome/WithdrawTab" });
      return;
    }
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);
  const review = async (w: any, status: "approved" | "rejected" | "paid", reason?: string) => {
    const { error } = await supabase
      .from("withdrawals")
      .update({ status, reject_reason: reason ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", w.id);
    if (error) {
      reportRpcError(error, {
        op: "withdrawals.update",
        scope: "AdminHome/WithdrawTab.review",
        payload: { id: w.id, status, reason },
      });
    } else {
      reportRpcSuccess("withdrawals.update", { id: w.id, status });
      toast.success("已更新");
      load();
    }
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
    if (!code.trim()) { toast.error("请输入用户编号"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("金额必须大于 0"); return; }
    const { data: p, error: pe } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_code", code.trim())
      .maybeSingle();
    if (pe) {
      reportRpcError(pe, {
        op: "profiles.lookup",
        scope: "AdminHome/RechargeTab.submit",
        payload: { user_code: code },
      });
      return;
    }
    if (!p) { toast.error("用户不存在"); return; }
    const { data, error } = await supabase.rpc("admin_recharge_user", {
      _user_id: p.user_id,
      _amount: amount,
      _note: note || undefined,
    });
    if (error) {
      reportRpcError(error, {
        op: "rpc:admin_recharge_user",
        scope: "AdminHome/RechargeTab.submit",
        payload: { user_id: p.user_id, amount, note: note || null },
      });
      return;
    }
    reportRpcSuccess("rpc:admin_recharge_user", { tx_id: data });
    toast.success("充值成功");
    setCode(""); setAmount(100); setNote("");
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
  useEffect(() => {
    supabase
      .from("commission_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          reportRpcError(error, { op: "commission_config.select", scope: "AdminHome/ConfigTab" });
          return;
        }
        setCfg(data);
      });
  }, []);
  if (!cfg) return <p>加载中…</p>;
  const save = async () => {
    const l1 = Number(cfg.l1_rate), l2 = Number(cfg.l2_rate), plat = Number(cfg.platform_rate);
    if (![l1, l2, plat].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
      toast.error("分成比例必须在 0-1 之间"); return;
    }
    if (l1 + l2 + plat > 1) { toast.error("L1 + L2 + 平台 不能超过 1"); return; }
    const { error } = await supabase
      .from("commission_config")
      .update({ l1_rate: l1, l2_rate: l2, platform_rate: plat, updated_at: new Date().toISOString() })
      .eq("id", cfg.id);
    if (error) {
      reportRpcError(error, {
        op: "commission_config.update",
        scope: "AdminHome/ConfigTab.save",
        payload: { id: cfg.id, l1_rate: l1, l2_rate: l2, platform_rate: plat },
      });
    } else {
      reportRpcSuccess("commission_config.update");
      toast.success("已保存");
    }
  };
  return (
    <div className="space-y-3">
      <WalletPurchaseToggle />
      <div className="bg-card rounded-md p-4 space-y-3">
        <h3 className="text-sm font-medium">分成比例</h3>
        <div><label className="text-xs">一级代理分成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l1_rate} onChange={(e) => setCfg({ ...cfg, l1_rate: Number(e.target.value) })} /></div>
        <div><label className="text-xs">二级代理分成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l2_rate} onChange={(e) => setCfg({ ...cfg, l2_rate: Number(e.target.value) })} /></div>
        <div><label className="text-xs">平台抽成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.platform_rate} onChange={(e) => setCfg({ ...cfg, platform_rate: Number(e.target.value) })} /></div>
        <p className="text-xs text-muted-foreground">商家实得 = 1 - L1 - L2 - 平台</p>
        <Button className="w-full" onClick={save}>保存配置</Button>
      </div>
    </div>
  );
}

function WalletPurchaseToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "wallet_purchase_enabled")
      .maybeSingle()
      .then(({ data }) => setEnabled(data?.value === true));
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: "wallet_purchase_enabled", value: next as any, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    setSaving(false);
    if (error) {
      reportRpcError(error, { op: "app_settings.upsert", scope: "AdminHome/WalletPurchaseToggle" });
      return;
    }
    setEnabled(next);
    toast.success(next ? "已开启钱包余额购买" : "已关闭钱包余额购买");
  };

  if (enabled === null) return <div className="bg-card rounded-md p-4 text-xs text-muted-foreground">加载购买配置中…</div>;

  return (
    <div className="bg-card rounded-md p-4 space-y-2">
      <h3 className="text-sm font-medium">钱包余额购买</h3>
      <p className="text-xs text-muted-foreground">
        开启后，普通用户购买商品需先充值至钱包；关闭后，购买不扣余额（仅作演示/对接外部支付）。商家与代理的佣金入账始终生效。
      </p>
      <div className="flex items-center justify-between pt-1">
        <span className={`text-sm ${enabled ? "text-success" : "text-muted-foreground"}`}>
          当前：{enabled ? "已开启" : "已关闭"}
        </span>
        <Button size="sm" variant={enabled ? "outline" : "default"} disabled={saving} onClick={() => toggle(!enabled)}>
          {enabled ? "关闭" : "开启"}
        </Button>
      </div>
    </div>
  );
}
