import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { fmtDate, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/wallet_/transactions")({
  component: TxPage,
});

interface Tx { id: string; type: string; amount: number; balance_after: number; description: string | null; created_at: string; }

const TYPE_LABEL: Record<string, string> = {
  recharge: "充值", purchase: "消费", commission: "分成", withdraw: "提现", refund: "退款", admin_adjust: "管理员调整",
};

function TxPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Tx[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("wallet_transactions").select("id, type, amount, balance_after, description, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100).then(({ data }) => setList(data ?? []));
  }, [user?.id]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="资金明细" />
      <main className="flex-1 px-3 py-3">
        {list.length === 0 ? (
          <p className="text-center py-12 text-sm text-muted-foreground">暂无明细</p>
        ) : (
          <div className="bg-card rounded-xl divide-y divide-border">
            {list.map((t) => {
              const positive = Number(t.amount) > 0;
              return (
                <div key={t.id} className="p-3 flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{TYPE_LABEL[t.type] ?? t.type}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(t.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold ${positive ? "text-success" : "text-primary"}`}>
                      {positive ? "+" : ""}{Number(t.amount).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">余额 {fmtMoney(t.balance_after)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
