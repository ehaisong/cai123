import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { Copy, Users, TrendingUp, Share2 } from "lucide-react";
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
  const { user, refreshRoles, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [config, setConfig] = useState<{ l1_rate: number; l2_rate: number; platform_rate: number } | null>(null);
  const [counts, setCounts] = useState<{ l1: number; l2: number }>({ l1: 0, l2: 0 });
  const [origin, setOrigin] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setOrigin(window.location.origin);

    const [arRes, pRes, cRes, cfgRes] = await Promise.all([
      supabase.from("agent_relations").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("id, user_code, nickname").eq("user_id", user.id).maybeSingle(),
      supabase.from("commission_records").select("amount, level, created_at, order_id").eq("beneficiary_id", user.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("commission_config").select("l1_rate, l2_rate, platform_rate").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (arRes.error) reportRpcError(arRes.error, { op: "agent_relations.select", scope: "AgentPage" });
    if (cRes.error) reportRpcError(cRes.error, { op: "commission_records.select", scope: "AgentPage" });
    if (cfgRes.error) reportRpcError(cfgRes.error, { op: "commission_config.select", scope: "AgentPage" });

    setInfo(arRes.data);
    setProfile(pRes.data);
    setCommissions(cRes.data ?? []);
    setConfig(cfgRes.data ?? null);

    // 邀请人数：直推（upline_id = 我的 profile.id），二级（upline_l2_id = 我的 profile.id）
    if (pRes.data?.id) {
      const [l1, l2] = await Promise.all([
        supabase.from("agent_relations").select("*", { count: "exact", head: true }).eq("upline_id", pRes.data.id),
        supabase.from("agent_relations").select("*", { count: "exact", head: true }).eq("upline_l2_id", pRes.data.id),
      ]);
      setCounts({ l1: l1.count ?? 0, l2: l2.count ?? 0 });
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const totals = useMemo(() => {
    const l1 = commissions.filter((c) => c.level === 1).reduce((s, r) => s + Number(r.amount), 0);
    const l2 = commissions.filter((c) => c.level === 2).reduce((s, r) => s + Number(r.amount), 0);
    return { all: l1 + l2, l1, l2 };
  }, [commissions]);

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

  const become = async () => {
    const { error } = await supabase.rpc("become_agent");
    if (error) { reportRpcError(error, { op: "rpc:become_agent", scope: "AgentPage" }); return; }
    toast.success("已开通代理");
    await refreshRoles();
    load();
  };

  if (!info?.is_agent) {
    const l1Pct = config ? (config.l1_rate * 100).toFixed(0) : "—";
    const l2Pct = config ? (config.l2_rate * 100).toFixed(0) : "—";
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="代理推广" />
        <div className="bg-card m-3 p-6 rounded-2xl text-center">
          <div className="text-4xl mb-3">🤝</div>
          <h2 className="text-lg font-bold mb-2">成为推广代理</h2>
          <p className="text-sm text-muted-foreground mb-4">分享专属二维码，好友购买即可获得分成奖励</p>
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
          <Button className="w-full" onClick={become}>立即成为代理</Button>
        </div>
      </div>
    );
  }

  const code = info.agent_code ?? profile?.user_code ?? "";
  const url = `${origin}/?ref=${code}`;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("已复制"); }
    catch { toast.error("复制失败"); }
  };

  const share = async () => {
    const shareData = { title: "邀请你加入", text: "扫码或点击链接加入，享受专属预测内容", url };
    // @ts-expect-error - navigator.share is not in all TS libs
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await (navigator as any).share(shareData); } catch { /* user cancel */ }
    } else {
      copy(url);
    }
  };

  const l1Pct = config ? (config.l1_rate * 100).toFixed(0) : "—";
  const l2Pct = config ? (config.l2_rate * 100).toFixed(0) : "—";

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="代理中心" />

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

      {/* 邀请统计 */}
      <div className="mx-3 grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">直接邀请</div>
            <div className="text-lg font-bold">{counts.l1}</div>
          </div>
        </div>
        <div className="bg-card rounded-xl p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">间接邀请</div>
            <div className="text-lg font-bold">{counts.l2}</div>
          </div>
        </div>
      </div>

      {/* 二维码 */}
      <div className="bg-card m-3 p-5 rounded-2xl flex flex-col items-center">
        <p className="text-xs text-muted-foreground mb-3">扫码邀请好友注册</p>
        <div className="bg-white p-3 rounded-xl border border-border">
          <QRCodeSVG value={url} size={200} level="M" />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground break-all text-center px-2">{url}</div>
        <div className="grid grid-cols-2 gap-2 w-full mt-4">
          <Button variant="outline" onClick={() => copy(url)}>
            <Copy className="h-4 w-4 mr-1" /> 复制链接
          </Button>
          <Button onClick={share}>
            <Share2 className="h-4 w-4 mr-1" /> 立即分享
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">推广码：<span className="font-mono">{code}</span></div>
      </div>

      {/* 分成规则 */}
      <div className="bg-card mx-3 mb-3 p-4 rounded-2xl">
        <div className="text-sm font-medium mb-3">分成规则</div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>· 一级代理（直接推广）</span>
            <span className="text-primary font-semibold">{l1Pct}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span>· 二级代理（间接推广）</span>
            <span className="text-primary font-semibold">{l2Pct}%</span>
          </div>
          <p className="pt-2 border-t border-border leading-relaxed">
            好友通过你的二维码注册并购买商品，你将自动获得对应比例分成。分成实时到账钱包，可随时申请提现。
          </p>
        </div>
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
