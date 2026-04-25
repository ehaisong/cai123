import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { fmtDate, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/merchant/agents")({
  component: AgentsPage,
});

function AgentsPage() {
  const { user } = useAuth();
  const [list, setList] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (!m) return;
      // 该商家旗下所有订单关联的代理
      const { data } = await supabase
        .from("orders")
        .select("agent_l1_id, amount, paid_at, profiles!orders_agent_l1_id_fkey(nickname, user_code)")
        .eq("merchant_id", m.id)
        .eq("status", "paid")
        .not("agent_l1_id", "is", null)
        .order("paid_at", { ascending: false })
        .limit(50);
      setList((data ?? []) as any);
    })();
  }, [user?.id]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理订单" />
      <main className="flex-1 px-3 py-3">
        {list.length === 0 ? <p className="text-center py-12 text-sm text-muted-foreground">暂无代理订单</p> : (
          <div className="bg-card rounded-xl divide-y divide-border">
            {list.map((r, i) => (
              <div key={i} className="p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm">{r.profiles?.nickname ?? "代理"}</div>
                  <div className="text-xs text-muted-foreground">{r.profiles?.user_code} · {fmtDate(r.paid_at)}</div>
                </div>
                <div className="text-primary font-semibold text-sm">{fmtMoney(r.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
