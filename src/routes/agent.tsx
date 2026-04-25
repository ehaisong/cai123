import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/agent")({
  component: AgentPage,
});

function AgentPage() {
  const { user, refreshRoles } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [origin, setOrigin] = useState("");

  const load = async () => {
    if (!user) return;
    setOrigin(window.location.origin);
    const { data: ar } = await supabase.from("agent_relations").select("*").eq("user_id", user.id).maybeSingle();
    setInfo(ar);
    const { data: p } = await supabase.from("profiles").select("user_code, nickname").eq("user_id", user.id).maybeSingle();
    setProfile(p);
    const { data: c } = await supabase.from("commission_records").select("amount, level, created_at").eq("beneficiary_id", user.id).order("created_at", { ascending: false }).limit(20);
    setCommissions(c ?? []);
  };
  useEffect(() => { load(); }, [user?.id]);

  if (!user) return <div className="h5-shell"><PageHeader title="代理推广" /><div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div></div>;

  const become = async () => {
    const { error } = await supabase.rpc("become_agent");
    if (error) { toast.error(error.message); return; }
    toast.success("已开通代理");
    await refreshRoles();
    load();
  };

  const totalCommission = commissions.reduce((s, r) => s + Number(r.amount), 0);

  if (!info?.is_agent) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="代理推广" />
        <div className="bg-card m-3 p-6 rounded-2xl text-center">
          <div className="text-4xl mb-3">🤝</div>
          <h2 className="text-lg font-bold mb-2">成为推广代理</h2>
          <p className="text-sm text-muted-foreground mb-4">分享专属二维码，好友购买即可获得分成奖励</p>
          <Button className="w-full" onClick={become}>立即成为代理</Button>
        </div>
      </div>
    );
  }

  const url = `${origin}/?ref=${info.agent_code ?? profile?.user_code}`;
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理中心" />
      <div className="m-3 rounded-2xl p-5 text-white" style={{ background: "var(--gradient-orange)" }}>
        <div className="text-sm opacity-90">累计分成（元）</div>
        <div className="text-3xl font-bold mt-1">{totalCommission.toFixed(2)}</div>
        <div className="text-xs opacity-80 mt-2">推广码：{info.agent_code}</div>
      </div>
      <div className="bg-card m-3 p-5 rounded-2xl flex flex-col items-center">
        <p className="text-xs text-muted-foreground mb-3">扫码邀请好友注册</p>
        <div className="bg-white p-3 rounded-xl border border-border">
          <QRCodeSVG value={url} size={200} level="M" />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground break-all text-center px-2">{url}</div>
      </div>

      <div className="px-3 pt-3 pb-2 text-sm text-muted-foreground">分成记录</div>
      <div className="bg-card mx-3 mb-6 rounded-xl divide-y divide-border">
        {commissions.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无分成</p>}
        {commissions.map((c, i) => (
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
