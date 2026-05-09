import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { reportRpcError } from "@/lib/error-logger";
import { Users, TrendingUp, Share2, Wallet, CalendarDays, ArrowRightLeft, Store, ShieldCheck } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/agent")({
  component: AgentPageGuarded,
});

function AgentPageGuarded() {
  return (
    <RouteGuard title="代理推广">
      <AgentPage />
    </RouteGuard>
  );
}

type Tab = "all" | "1" | "2";

function AgentPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [config, setConfig] = useState<{ l1_rate: number; l2_rate: number; platform_rate: number } | null>(null);
  const [counts, setCounts] = useState<{ l1: number; l2: number }>({ l1: 0, l2: 0 });
  const [recentInvitees, setRecentInvitees] = useState<{ date: string; count: number }[]>([]);
  
  const [tab, setTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    

    const since14 = new Date();
    since14.setDate(since14.getDate() - 13);
    since14.setHours(0, 0, 0, 0);

    const [arRes, pRes, cRes, cfgRes] = await Promise.all([
      supabase.from("agent_relations").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("id, user_code, nickname").eq("user_id", user.id).maybeSingle(),
      supabase.from("commission_records").select("amount, level, created_at, order_id").eq("beneficiary_id", user.id).order("created_at", { ascending: false }).limit(500),
      supabase.from("commission_config").select("l1_rate, l2_rate, platform_rate").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (arRes.error) reportRpcError(arRes.error, { op: "agent_relations.select", scope: "AgentPage" });
    if (cRes.error) reportRpcError(cRes.error, { op: "commission_records.select", scope: "AgentPage" });
    if (cfgRes.error) reportRpcError(cfgRes.error, { op: "commission_config.select", scope: "AgentPage" });

    setInfo(arRes.data);
    setProfile(pRes.data);
    setCommissions(cRes.data ?? []);
    setConfig(cfgRes.data ?? null);

    // 邀请人数 + 最近 14 天每日新增引流（基于 agent_relations.created_at）
    if (pRes.data?.id) {
      const [l1, l2, recentRel] = await Promise.all([
        supabase.from("agent_relations").select("*", { count: "exact", head: true }).eq("upline_id", pRes.data.id),
        supabase.from("agent_relations").select("*", { count: "exact", head: true }).eq("upline_l2_id", pRes.data.id),
        supabase.from("agent_relations").select("created_at").or(`upline_id.eq.${pRes.data.id},upline_l2_id.eq.${pRes.data.id}`).gte("created_at", since14.toISOString()),
      ]);
      setCounts({ l1: l1.count ?? 0, l2: l2.count ?? 0 });

      // 按日聚合
      const buckets: Record<string, number> = {};
      for (let i = 0; i < 14; i++) {
        const d = new Date(since14); d.setDate(since14.getDate() + i);
        buckets[d.toISOString().slice(0, 10)] = 0;
      }
      (recentRel.data ?? []).forEach((r) => {
        const k = new Date(r.created_at).toISOString().slice(0, 10);
        if (k in buckets) buckets[k] += 1;
      });
      setRecentInvitees(Object.entries(buckets).map(([date, count]) => ({ date, count })));
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const totals = useMemo(() => {
    const l1 = commissions.filter((c) => c.level === 1).reduce((s, r) => s + Number(r.amount), 0);
    const l2 = commissions.filter((c) => c.level === 2).reduce((s, r) => s + Number(r.amount), 0);
    return { all: l1 + l2, l1, l2 };
  }, [commissions]);

  const todayEarnings = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return commissions
      .filter((c) => new Date(c.created_at) >= start)
      .reduce((s, r) => s + Number(r.amount), 0);
  }, [commissions]);

  const dailyEarnings = useMemo(() => {
    const since14 = new Date(); since14.setDate(since14.getDate() - 13); since14.setHours(0, 0, 0, 0);
    const buckets: Record<string, number> = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(since14); d.setDate(since14.getDate() + i);
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    commissions.forEach((c) => {
      const k = new Date(c.created_at).toISOString().slice(0, 10);
      if (k in buckets) buckets[k] += Number(c.amount);
    });
    return Object.entries(buckets).map(([date, amount]) => ({
      date,
      label: date.slice(5),
      amount: Number(amount.toFixed(2)),
    }));
  }, [commissions]);

  const inviteesChart = useMemo(
    () => recentInvitees.map((r) => ({ ...r, label: r.date.slice(5) })),
    [recentInvitees],
  );

  const filtered = useMemo(
    () => (tab === "all" ? commissions : commissions.filter((c) => String(c.level) === tab)),
    [commissions, tab],
  );

  if (authLoading || loading) {
    return <div className="h5-shell"><PageHeader title="代理推广" /><p className="text-center py-12 text-sm text-muted-foreground">加载中…</p></div>;
  }
  if (!user) {
    return (
      <div className="h5-shell"><PageHeader title="代理推广" />
        <div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div>
      </div>
    );
  }

  if (!info?.is_agent) {
    const l1Pct = config ? (config.l1_rate * 100).toFixed(0) : "—";
    const l2Pct = config ? (config.l2_rate * 100).toFixed(0) : "—";
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="代理推广" />
        <div className="bg-card m-3 p-6 rounded-2xl text-center">
          <div className="text-4xl mb-3">🤝</div>
          <h2 className="text-lg font-bold mb-2">成为推广代理</h2>
          <p className="text-sm text-muted-foreground mb-4">
            请先进入您要代理的商家店铺，在店铺页点击「申请成为本店代理」。<br />
            一个代理只能归属一家商家。
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
            <div className="bg-muted rounded-lg p-3">
              <div className="text-muted-foreground">一级分成</div>
              <div className="text-primary text-lg font-bold mt-1">{l1Pct}%</div>
            </div>
            <div className="bg-muted rounded-lg p-3">
              <div className="text-muted-foreground">二级分成</div>
              <div className="text-primary text-lg font-bold mt-1">{l2Pct}%</div>
            </div>
          </div>
          <Button className="w-full" onClick={() => navigate({ to: "/" })}>前往店铺</Button>
        </div>
      </div>
    );
  }

  const code = info.agent_code ?? profile?.user_code ?? "";

  const l1Pct = config ? (config.l1_rate * 100).toFixed(0) : "—";
  const l2Pct = config ? (config.l2_rate * 100).toFixed(0) : "—";

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="代理中心" />

      {/* 当前活跃商家 + 切换入口 */}
      <ActiveMerchantCard userId={user.id} />

      {/* 累计分成 */}
      <div className="m-3 rounded-2xl p-5 text-white" style={{ background: "var(--gradient-orange)" }}>
        <div className="text-sm opacity-90">累计分成（元）</div>
        <div className="text-3xl font-bold mt-1">{totals.all.toFixed(2)}</div>
        <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
          <div className="bg-white/15 rounded-lg p-2">
            <div className="opacity-80">一级</div>
            <div className="text-base font-semibold mt-0.5">¥{totals.l1.toFixed(2)}</div>
          </div>
          <div className="bg-white/15 rounded-lg p-2">
            <div className="opacity-80">二级</div>
            <div className="text-base font-semibold mt-0.5">¥{totals.l2.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* 业绩看板：4 个 KPI */}
      <div className="mx-3 grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-warning/10 text-warning flex items-center justify-center">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">累计返佣</div>
            <div className="text-lg font-bold">¥{totals.all.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-card rounded-xl p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">今日收益</div>
            <div className="text-lg font-bold">¥{todayEarnings.toFixed(2)}</div>
          </div>
        </div>
        <Link to="/agent/invitees" className="bg-card rounded-xl p-3 flex items-center gap-3 active:opacity-70">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">直接邀请</div>
            <div className="text-lg font-bold">{counts.l1}</div>
          </div>
        </Link>
        <Link to="/agent/invitees" className="bg-card rounded-xl p-3 flex items-center gap-3 active:opacity-70">
          <div className="h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">间接邀请</div>
            <div className="text-lg font-bold">{counts.l2}</div>
          </div>
        </Link>
      </div>

      {/* 业绩走势图：14 天每日返佣 */}
      <div className="bg-card mx-3 mt-3 p-4 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">近 14 天返佣走势</div>
          <div className="text-xs text-muted-foreground">单位：元</div>
        </div>
        <div className="h-44 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyEarnings} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="agentEarn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={32} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`¥${Number(v).toFixed(2)}`, "返佣"]}
                labelFormatter={(l) => `日期：${l}`}
              />
              <Area type="monotone" dataKey="amount" stroke="var(--primary)" strokeWidth={2} fill="url(#agentEarn)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 引流走势图：14 天每日新增引流 */}
      <div className="bg-card mx-3 mt-3 p-4 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">近 14 天每日引流</div>
          <div className="text-xs text-muted-foreground">单位：人</div>
        </div>
        <div className="h-40 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={inviteesChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v} 人`, "新增引流"]}
                labelFormatter={(l) => `日期：${l}`}
              />
              <Bar dataKey="count" fill="var(--success)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>


      {/* 操作入口：推广分享 / 申请提现 */}
      <div className="mx-3 mt-3 grid grid-cols-3 gap-3">
        <Link
          to="/agent/share"
          className="rounded-2xl p-4 text-white flex flex-col items-start justify-between min-h-[88px]"
          style={{ background: "var(--gradient-orange)" }}
        >
          <Share2 className="h-5 w-5" />
          <div>
            <div className="text-sm font-semibold">推广分享</div>
            <div className="text-[11px] opacity-90">二维码 / 链接</div>
          </div>
        </Link>
        <Link
          to="/wallet"
          className="rounded-2xl p-4 bg-card flex flex-col items-start justify-between min-h-[88px] border border-border"
        >
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">申请提现</div>
            <div className="text-[11px] text-muted-foreground">分成实时到账</div>
          </div>
        </Link>
        <Link
          to="/profile/kyc"
          className="rounded-2xl p-4 bg-card flex flex-col items-start justify-between min-h-[88px] border border-border"
        >
          <ShieldCheck className="h-5 w-5 text-success" />
          <div>
            <div className="text-sm font-semibold">实名绑定</div>
            <div className="text-[11px] text-muted-foreground">提现转账必填</div>
          </div>
        </Link>
        <Link
          to="/apply"
          className="rounded-2xl p-4 bg-card flex flex-col items-start justify-between min-h-[88px] border border-border"
        >
          <Store className="h-5 w-5 text-success" />
          <div>
            <div className="text-sm font-semibold">我要开店</div>
            <div className="text-[11px] text-muted-foreground">申请成为商家</div>
          </div>
        </Link>
      </div>

      <div className="px-3 pt-3 text-[11px] text-muted-foreground">
        当前分成规则：一级 <span className="text-primary font-semibold">{l1Pct}%</span> · 二级 <span className="text-primary font-semibold">{l2Pct}%</span> · 推广码 <span className="font-mono">{code}</span>
      </div>

      {/* 分成记录 */}
      <div className="px-3 pt-1 pb-2 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">分成记录</div>
        <div className="flex gap-1 text-xs">
          {([
            { k: "all", l: "全部" },
            { k: "1", l: "一级" },
            { k: "2", l: "二级" },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-2 py-0.5 rounded ${tab === t.k ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-muted"}`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-card mx-3 mb-6 rounded-xl divide-y divide-border">
        {filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无分成记录</p>}
        {filtered.map((c, i) => (
          <div key={i} className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm">{c.level === 1 ? "一级分成" : "二级分成"}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(c.created_at)}</div>
            </div>
            <div className="text-success font-semibold">+{fmtMoney(c.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveMerchantCard({ userId }: { userId: string }) {
  const [active, setActive] = useState<{ shop_name: string; shop_avatar_url: string | null; merchant_id: string } | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("agent_my_bound_merchants");
      const list = (data as any[]) ?? [];
      setCount(list.length);
      const a = list.find((r) => r.is_active);
      if (a) setActive({ shop_name: a.shop_name, shop_avatar_url: a.shop_avatar_url, merchant_id: a.merchant_id });
    })();
  }, [userId]);

  if (!active) return null;
  return (
    <div className="mx-3 mt-3 bg-card rounded-2xl p-3 flex items-center gap-3">
      <div className="h-12 w-12 rounded-full bg-muted overflow-hidden shrink-0">
        {active.shop_avatar_url
          ? <img src={active.shop_avatar_url} alt={active.shop_name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Store className="h-5 w-5" /></div>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{active.shop_name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">已绑定 {count} 家商家</div>
      </div>
      <Link
        to="/agent/merchants"
        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" /> 切换
      </Link>
    </div>
  );
}
