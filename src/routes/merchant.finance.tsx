import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/merchant/finance")({
  component: () => (
    <RouteGuard title="商家财务" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

type RangeKey = "today" | "week" | "month" | "all";

function rangeOf(k: RangeKey): { from?: string; to?: string } {
  const now = new Date();
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (k === "today") return { from: d.toISOString() };
  if (k === "week") { const f = new Date(d); f.setDate(f.getDate() - 6); return { from: f.toISOString() }; }
  if (k === "month") { const f = new Date(d); f.setDate(1); return { from: f.toISOString() }; }
  return {};
}

function Inner() {
  const [range, setRange] = useState<RangeKey>("month");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = rangeOf(range);
      const { data: d, error } = await supabase.rpc("merchant_finance" as any, {
        _from: r.from ?? null, _to: r.to ?? null, _limit: 200,
      });
      if (cancelled) return;
      if (error) reportRpcError(error, { op: "merchant_finance", scope: "MerchantFinance" });
      else setData(d);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range]);

  const s = data?.summary ?? {};
  const orders: any[] = data?.orders ?? [];

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="商家财务" />
      <main className="flex-1 px-3 py-3 space-y-3 pb-6">
        <section className="grid grid-cols-2 gap-2">
          <Stat label="今日实得" value={fmtMoney(Number(s.today_income ?? 0))} />
          <Stat label="昨日实得" value={fmtMoney(Number(s.yesterday_income ?? 0))} />
          <Stat label="本月实得" value={fmtMoney(Number(s.month_income ?? 0))} />
          <Stat label="累计实得" value={fmtMoney(Number(s.total_income ?? 0))} />
        </section>

        <section className="bg-card rounded-xl p-3 space-y-1.5">
          <div className="text-sm font-medium">累计概览</div>
          <Row label="累计订单数" value={String(Number(s.total_orders ?? 0))} />
          <Row label="累计 GMV" value={fmtMoney(Number(s.total_gmv ?? 0))} />
          <Row label="累计平台抽成" value={fmtMoney(Number(s.total_platform ?? 0))} />
          <Row label="累计代理分成" value={fmtMoney(Number(s.total_agent ?? 0))} />
        </section>

        <section className="bg-card rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">区间筛选</div>
            <div className="flex items-center gap-1 text-xs">
              {([["today","今日"],["week","近7天"],["month","本月"],["all","全部"]] as const).map(([k,l]) => (
                <button key={k} onClick={() => setRange(k)}
                  className={`px-2 py-1 rounded ${range===k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            区间实得：{fmtMoney(Number(s.range_income ?? 0))} · {Number(s.range_orders ?? 0)} 单 · GMV {fmtMoney(Number(s.range_gmv ?? 0))}
          </div>
        </section>

        <section className="bg-card rounded-xl p-3">
          <div className="text-sm font-medium mb-2">订单流水（最近 {orders.length} 条）</div>
          {loading && <p className="text-xs text-center text-muted-foreground py-4">加载中…</p>}
          {!loading && orders.length === 0 && <p className="text-xs text-center text-muted-foreground py-4">暂无明细</p>}
          <div className="divide-y divide-border">
            {orders.map((o) => (
              <div key={o.order_id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm truncate flex-1">
                    {o.product_issue_no ? `${o.product_issue_no}期 ` : ""}
                    {o.author_name ?? o.product_title ?? "—"}
                    {o.author_name && o.product_title ? (
                      <span className="text-muted-foreground text-xs ml-1">（{o.product_title}）</span>
                    ) : null}
                  </div>
                  <div className="text-sm font-medium text-success shrink-0">+{fmtMoney(Number(o.merchant_income))}</div>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2 mt-0.5">
                  <span className="truncate">买家 {o.buyer_nickname ?? o.buyer_code ?? "—"}</span>
                  <span className="shrink-0">{fmtDate(o.paid_at, "MM-dd HH:mm")}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  订单 ¥{Number(o.amount).toFixed(2)} · 平台 -¥{Number(o.platform_fee).toFixed(2)} · 代理 -¥{Number(o.agent_fee).toFixed(2)}
                </div>
              </div>
            ))}

          </div>
          <div className="mt-3 text-center">
            <Link to="/merchant" className="text-xs text-info">返回商家后台 ›</Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-xl p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
