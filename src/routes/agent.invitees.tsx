import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { reportRpcError } from "@/lib/error-logger";
import { Users, ShoppingBag, Wallet, Share2 } from "lucide-react";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/agent/invitees")({
  component: InviteesGuarded,
});

function InviteesGuarded() {
  return (
    <RouteGuard title="我邀请的买家">
      <InviteesPage />
    </RouteGuard>
  );
}

type Tab = "1" | "2";

interface Invitee {
  user_id: string;
  profile_id: string;
  nickname: string | null;
  user_code: string;
  joined_at: string;
  level: 1 | 2;
  orders_count: number;
  spent_total: number;
  commission_total: number;
}

function InviteesPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<Invitee[]>([]);
  const [tab, setTab] = useState<Tab>("1");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) { setLoading(false); return; }
      setLoading(true);

      const [arRes, pRes] = await Promise.all([
        supabase.from("agent_relations").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles").select("id, user_code").eq("user_id", user.id).maybeSingle(),
      ]);
      if (arRes.error) reportRpcError(arRes.error, { op: "agent_relations.select", scope: "Invitees" });
      setInfo(arRes.data);
      setProfileId(pRes.data?.id ?? null);

      if (!pRes.data?.id || !arRes.data?.is_agent) { setLoading(false); return; }
      const myPid = pRes.data.id;

      // 拉取下级 agent_relations（L1 + L2）
      const { data: rels, error: rErr } = await supabase
        .from("agent_relations")
        .select("user_id, upline_id, upline_l2_id, created_at")
        .or(`upline_id.eq.${myPid},upline_l2_id.eq.${myPid}`)
        .order("created_at", { ascending: false });
      if (rErr) reportRpcError(rErr, { op: "agent_relations.list_invitees", scope: "Invitees" });

      const userIds = (rels ?? []).map((r) => r.user_id);
      if (userIds.length === 0) { setItems([]); setLoading(false); return; }

      // 个人资料
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, user_id, nickname, user_code")
        .in("user_id", userIds);
      const profMap = new Map((profs ?? []).map((p) => [p.user_id, p]));

      // 订单聚合（仅已支付）
      const { data: ords } = await supabase
        .from("orders")
        .select("buyer_id, amount")
        .in("buyer_id", userIds)
        .eq("status", "paid");
      const orderAgg = new Map<string, { count: number; spent: number }>();
      (ords ?? []).forEach((o) => {
        const cur = orderAgg.get(o.buyer_id) ?? { count: 0, spent: 0 };
        cur.count += 1;
        cur.spent += Number(o.amount);
        orderAgg.set(o.buyer_id, cur);
      });

      // 我从该下级身上累计获得的分成
      // commission_records.beneficiary_id = me.user_id, 关联 order.buyer_id
      const { data: comms } = await supabase
        .from("commission_records")
        .select("amount, order_id, orders!commission_records_order_id_fkey(buyer_id)")
        .eq("beneficiary_id", user.id);
      const commByBuyer = new Map<string, number>();
      (comms ?? []).forEach((c: any) => {
        const bid = c.orders?.buyer_id;
        if (!bid) return;
        commByBuyer.set(bid, (commByBuyer.get(bid) ?? 0) + Number(c.amount));
      });

      const list: Invitee[] = (rels ?? []).map((r) => {
        const p = profMap.get(r.user_id);
        const agg = orderAgg.get(r.user_id);
        const level: 1 | 2 = r.upline_id === myPid ? 1 : 2;
        return {
          user_id: r.user_id,
          profile_id: p?.id ?? "",
          nickname: p?.nickname ?? null,
          user_code: p?.user_code ?? "",
          joined_at: r.created_at,
          level,
          orders_count: agg?.count ?? 0,
          spent_total: agg?.spent ?? 0,
          commission_total: commByBuyer.get(r.user_id) ?? 0,
        };
      });
      setItems(list);
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filtered = useMemo(
    () => items.filter((i) => String(i.level) === tab),
    [items, tab],
  );

  const totals = useMemo(() => {
    const l1 = items.filter((i) => i.level === 1);
    const l2 = items.filter((i) => i.level === 2);
    const sum = (arr: Invitee[]) => ({
      count: arr.length,
      orders: arr.reduce((s, x) => s + x.orders_count, 0),
      commission: arr.reduce((s, x) => s + x.commission_total, 0),
    });
    return { l1: sum(l1), l2: sum(l2) };
  }, [items]);

  if (authLoading || loading) {
    return <div className="h5-shell"><PageHeader title="我邀请的买家" /><p className="text-center py-12 text-sm text-muted-foreground">加载中…</p></div>;
  }
  if (!user) {
    return (
      <div className="h5-shell"><PageHeader title="我邀请的买家" />
        <div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div>
      </div>
    );
  }
  if (!info?.is_agent) {
    return (
      <div className="h5-shell"><PageHeader title="我邀请的买家" />
        <div className="p-6 text-center text-sm text-muted-foreground">
          您还不是代理，请先在店铺页申请。
          <div className="mt-4"><Button onClick={() => navigate({ to: "/agent" })}>前往代理中心</Button></div>
        </div>
      </div>
    );
  }

  const cur = tab === "1" ? totals.l1 : totals.l2;

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader
        title="我邀请的买家"
        right={
          <Link to="/agent/share" className="text-xs text-primary inline-flex items-center gap-1">
            <Share2 className="h-3.5 w-3.5" /> 推广
          </Link>
        }
      />

      {/* 统计卡 */}
      <div className="mx-3 mt-3 grid grid-cols-3 gap-3">
        <div className="bg-card rounded-xl p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {tab === "1" ? "直接" : "间接"}
          </div>
          <div className="text-lg font-bold mt-1">{cur.count}</div>
        </div>
        <div className="bg-card rounded-xl p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShoppingBag className="h-3.5 w-3.5" /> 总订单
          </div>
          <div className="text-lg font-bold mt-1">{cur.orders}</div>
        </div>
        <div className="bg-card rounded-xl p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> 我的分成
          </div>
          <div className="text-lg font-bold mt-1 text-success">¥{cur.commission.toFixed(2)}</div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="mx-3 mt-3 inline-flex bg-muted rounded-lg p-0.5 text-xs self-start">
        {([
          { k: "1", l: `一级 (${totals.l1.count})` },
          { k: "2", l: `二级 (${totals.l2.count})` },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-3 py-1.5 rounded-md transition ${tab === t.k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="bg-card mx-3 mt-3 mb-6 rounded-2xl divide-y divide-border">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {tab === "1" ? "还没有人通过你的推广码注册" : "还没有间接邀请"}
            <div className="mt-3">
              <Button size="sm" onClick={() => navigate({ to: "/agent/share" })}>
                <Share2 className="h-3.5 w-3.5 mr-1" /> 立即推广
              </Button>
            </div>
          </div>
        )}
        {filtered.map((inv) => (
          <div key={inv.user_id} className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {inv.nickname ?? "未命名用户"}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  <span className="font-mono">{inv.user_code}</span>
                  <span className="mx-1.5">·</span>
                  加入 {fmtDate(inv.joined_at)}
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <div className="text-success font-semibold text-sm">
                  +{fmtMoney(inv.commission_total)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">我的分成</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-muted rounded-md px-2 py-1.5 flex items-center justify-between">
                <span className="text-muted-foreground">订单数</span>
                <span className="font-semibold">{inv.orders_count}</span>
              </div>
              <div className="bg-muted rounded-md px-2 py-1.5 flex items-center justify-between">
                <span className="text-muted-foreground">消费额</span>
                <span className="font-semibold">¥{inv.spent_total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
