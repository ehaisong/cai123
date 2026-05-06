import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/merchant/agents/$userId")({
  component: () => (
    <RouteGuard title="代理详情" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { userId } = Route.useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: d, error } = await supabase.rpc("merchant_agent_detail" as any, { _user_id: userId });
      if (error) { reportRpcError(error, { op: "merchant_agent_detail", scope: "MerchantAgentDetail" }); setLoading(false); return; }
      setData(d);
      setLoading(false);
    })();
  }, [userId]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理详情" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {loading && <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p>}
        {!loading && !data && <p className="text-center py-8 text-sm text-muted-foreground">未找到</p>}
        {data && (
          <>
            <section className="bg-card rounded-md p-3">
              <div className="text-base font-medium">{data.profile?.nickname ?? "未命名"}</div>
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <div>代理码：{data.relation?.agent_code ?? "-"}</div>
                <div>用户编号：{data.profile?.user_code ?? "-"}</div>
                <div>手机号：{data.profile?.phone ?? "-"}</div>
                <div>分成比例：{data.relation?.l1_rate != null ? (Number(data.relation.l1_rate) * 100).toFixed(2).replace(/\.?0+$/, "") + "%" : "默认"}</div>
                <div>加入时间：{fmtDate(data.relation?.created_at)}</div>
              </div>
            </section>

            <section className="grid grid-cols-3 gap-2">
              <Stat label="今日收入" value={fmtMoney(data.today_income)} />
              <Stat label="昨日收入" value={fmtMoney(data.yesterday_income)} />
              <Stat label="累计收入" value={fmtMoney(data.total_income)} />
              <Stat label="引流客户" value={`${Number(data.customer_count ?? 0)} 人`} />
              <Stat label="发展代理" value={`${Number(data.agent_invitee_count ?? 0)} 人`} />
              <Stat label="分成订单" value={`${Number(data.order_count ?? 0)} 单`} />
            </section>

            <section className="bg-card rounded-md p-3">
              <div className="text-sm font-medium mb-2">引流客户（{(data.customers ?? []).length}）</div>
              {(data.customers ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground py-3 text-center">暂无引流客户</p>
              )}
              <div className="divide-y divide-border">
                {(data.customers ?? []).map((c: any) => (
                  <div key={c.user_id} className="py-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{c.nickname ?? "未命名"}</div>
                      <div className="text-xs text-muted-foreground">{c.phone ?? c.user_code ?? "-"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 ml-2">{fmtDate(c.created_at)}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-md p-2 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 truncate">{value}</div>
    </div>
  );
}
