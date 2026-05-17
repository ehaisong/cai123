import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { fmtMoney } from "@/lib/format";
import { Users, Store, UserCheck, ShoppingBag, Wallet, CreditCard } from "lucide-react";

export const Route = createFileRoute("/pc/")({
  component: PcOverview,
});

type Stats = {
  users: number;
  merchants: number;
  agents: number;
  orders7d: number;
  orderAmount7d: number;
  paySuccess7d: number;
  payAmount7d: number;
};

function PcOverview() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [users, merchants, agentsRaw, orders, pays] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("merchants").select("*", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("shop_memberships").select("user_id").eq("is_agent", true).limit(5000),
        supabase.from("orders").select("amount").gte("created_at", since).eq("status", "paid"),
        supabase.from("payment_orders").select("amount,status").gte("created_at", since),
      ]);
      const orderAmount = (orders.data ?? []).reduce((a, o: any) => a + Number(o.amount || 0), 0);
      const paySuccess = (pays.data ?? []).filter((p: any) => p.status === "paid").length;
      const payAmount = (pays.data ?? []).filter((p: any) => p.status === "paid").reduce((a, p: any) => a + Number(p.amount || 0), 0);
      const agentCount = new Set((agentsRaw.data ?? []).map((a: any) => a.user_id)).size;
      setS({
        users: users.count ?? 0,
        merchants: merchants.count ?? 0,
        agents: agentCount,
        orders7d: orders.data?.length ?? 0,
        orderAmount7d: orderAmount,
        paySuccess7d: paySuccess,
        payAmount7d: payAmount,
      });
    })();
  }, []);

  const cards = [
    { label: "用户总数", value: s?.users ?? "—", icon: Users, color: "text-blue-600 bg-blue-100" },
    { label: "已开店商家", value: s?.merchants ?? "—", icon: Store, color: "text-emerald-600 bg-emerald-100" },
    { label: "代理总数", value: s?.agents ?? "—", icon: UserCheck, color: "text-purple-600 bg-purple-100" },
    { label: "近 7 天订单数", value: s?.orders7d ?? "—", icon: ShoppingBag, color: "text-amber-600 bg-amber-100" },
    { label: "近 7 天订单总额", value: s ? fmtMoney(s.orderAmount7d) : "—", icon: Wallet, color: "text-pink-600 bg-pink-100" },
    { label: "近 7 天支付成功", value: s ? `${s.paySuccess7d} 笔 / ${fmtMoney(s.payAmount7d)}` : "—", icon: CreditCard, color: "text-cyan-600 bg-cyan-100" },
  ];

  return (
    <div>
      <PcPageHeader title="数据概览" description="平台关键指标速览（近 7 天）" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
              <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${c.color}`}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="text-2xl font-semibold truncate">{c.value}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
