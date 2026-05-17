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

export const Route = createFileRoute("/agent_/invitees")({
  component: InviteesGuarded,
});

function InviteesGuarded() {
  return (
    <RouteGuard title="我邀请的买家">
      <InviteesPage />
    </RouteGuard>
  );
}

interface Invitee {
  user_id: string;
  profile_id: string;
  nickname: string | null;
  user_code: string;
  joined_at: string;
  orders_count: number;
  spent_total: number;
  commission_total: number;
}

function InviteesPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [items, setItems] = useState<Invitee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) { setLoading(false); return; }
      setLoading(true);
      try {
        const [smSelfRes, pRes] = await Promise.all([
          supabase.from("shop_memberships").select("is_agent").eq("user_id", user.id).eq("is_agent", true).limit(1).maybeSingle(),
          supabase.from("profiles").select("id, user_code").eq("user_id", user.id).maybeSingle(),
        ]);
        if (smSelfRes.error) reportRpcError(smSelfRes.error, { op: "shop_memberships.self_check", scope: "Invitees" });
        const isAgent = !!smSelfRes.data?.is_agent;
        setInfo({ is_agent: isAgent });

        if (!pRes.data?.id || !isAgent) { setItems([]); return; }

        // 拉取直接下级（按 SM.upline_user_id = 自己），可能跨多个店铺，按 user_id 去重
        const { data: rels, error: rErr } = await supabase
          .from("shop_memberships")
          .select("user_id, joined_at")
          .eq("upline_user_id", user.id)
          .order("joined_at", { ascending: false });
        if (rErr) reportRpcError(rErr, { op: "shop_memberships.list_invitees", scope: "Invitees" });

        // 去重：同一个 user 可能在多家店都挂在我下面，取最早一次
        const dedupMap = new Map<string, { user_id: string; created_at: string }>();
        (rels ?? []).forEach((r: any) => {
          const prev = dedupMap.get(r.user_id);
          if (!prev || new Date(r.joined_at) < new Date(prev.created_at)) {
            dedupMap.set(r.user_id, { user_id: r.user_id, created_at: r.joined_at });
          }
        });
        const dedupRels = Array.from(dedupMap.values());
        const userIds = dedupRels.map((r) => r.user_id);
        if (userIds.length === 0) { setItems([]); return; }

        const [profsRes, ordsRes, commsRes] = await Promise.all([
          supabase.from("profiles").select("id, user_id, nickname, user_code").in("user_id", userIds),
          supabase.from("orders").select("buyer_id, amount").in("buyer_id", userIds).eq("status", "paid"),
          supabase
            .from("commission_records")
            .select("amount, order_id, orders!commission_records_order_id_fkey(buyer_id)")
            .eq("beneficiary_id", user.id),
        ]);
        if (profsRes.error) reportRpcError(profsRes.error, { op: "profiles.in", scope: "Invitees" });
        if (ordsRes.error) reportRpcError(ordsRes.error, { op: "orders.in", scope: "Invitees" });
        if (commsRes.error) reportRpcError(commsRes.error, { op: "commission_records.select", scope: "Invitees" });

        const profMap = new Map((profsRes.data ?? []).map((p) => [p.user_id, p]));
        const orderAgg = new Map<string, { count: number; spent: number }>();
        (ordsRes.data ?? []).forEach((o) => {
          const cur = orderAgg.get(o.buyer_id) ?? { count: 0, spent: 0 };
          cur.count += 1;
          cur.spent += Number(o.amount);
          orderAgg.set(o.buyer_id, cur);
        });
        const commByBuyer = new Map<string, number>();
        (commsRes.data ?? []).forEach((c: any) => {
          const bid = c.orders?.buyer_id;
          if (!bid) return;
          commByBuyer.set(bid, (commByBuyer.get(bid) ?? 0) + Number(c.amount));
        });

        const list: Invitee[] = (rels ?? []).map((r) => {
          const p = profMap.get(r.user_id);
          const agg = orderAgg.get(r.user_id);
          return {
            user_id: r.user_id,
            profile_id: p?.id ?? "",
            nickname: p?.nickname ?? null,
            user_code: p?.user_code ?? "",
            joined_at: r.created_at,
            orders_count: agg?.count ?? 0,
            spent_total: agg?.spent ?? 0,
            commission_total: commByBuyer.get(r.user_id) ?? 0,
          };
        });
        setItems(list);
      } catch (e: any) {
        reportRpcError(e, { op: "invitees.load", scope: "Invitees" });
      } finally {
        // 保证无论成功失败都退出"加载中"，避免页面永久卡住
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const totals = useMemo(() => ({
    count: items.length,
    orders: items.reduce((s, x) => s + x.orders_count, 0),
    commission: items.reduce((s, x) => s + x.commission_total, 0),
  }), [items]);

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
            <Users className="h-3.5 w-3.5" /> 客户数
          </div>
          <div className="text-lg font-bold mt-1">{totals.count}</div>
        </div>
        <div className="bg-card rounded-xl p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShoppingBag className="h-3.5 w-3.5" /> 总订单
          </div>
          <div className="text-lg font-bold mt-1">{totals.orders}</div>
        </div>
        <div className="bg-card rounded-xl p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> 我的分成
          </div>
          <div className="text-lg font-bold mt-1 text-success">¥{totals.commission.toFixed(2)}</div>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-card mx-3 mt-3 mb-6 rounded-2xl divide-y divide-border">
        {items.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            还没有人通过你的推广码注册
            <div className="mt-3">
              <Button size="sm" onClick={() => navigate({ to: "/agent/share" })}>
                <Share2 className="h-3.5 w-3.5 mr-1" /> 立即推广
              </Button>
            </div>
          </div>
        )}
        {items.map((inv) => (
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
