import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate, fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/admin/finance")({
  component: () => (
    <RouteGuard title="平台财务" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
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
      const { data: d, error } = await supabase.rpc("admin_platform_income" as any, {
        _from: r.from ?? null, _to: r.to ?? null, _merchant_id: null, _limit: 200,
      });
      if (cancelled) return;
      if (error) reportRpcError(error, { op: "admin_platform_income", scope: "AdminFinance" });
      else setData(d);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range]);

  const s = data?.summary ?? {};
  const byMerchant: any[] = data?.by_merchant ?? [];
  const orders: any[] = data?.orders ?? [];

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="平台财务" />
      <main className="flex-1 px-3 py-3 space-y-3 pb-6">
        <section className="grid grid-cols-2 gap-2">
          <Stat label="今日抽成" value={fmtMoney(Number(s.today ?? 0))} />
          <Stat label="昨日抽成" value={fmtMoney(Number(s.yesterday ?? 0))} />
          <Stat label="本月抽成" value={fmtMoney(Number(s.month ?? 0))} />
          <Stat label="累计抽成" value={fmtMoney(Number(s.total ?? 0))} />
        </section>

        <section className="bg-card rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">按商家统计</div>
            <div className="flex items-center gap-1 text-xs">
              {([["today","今日"],["week","近7天"],["month","本月"],["all","全部"]] as const).map(([k,l]) => (
                <button key={k} onClick={() => setRange(k)}
                  className={`px-2 py-1 rounded ${range===k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mb-2">
            筛选区间合计：{fmtMoney(Number(s.range ?? 0))} · {Number(s.range_orders ?? 0)} 单 · GMV {fmtMoney(Number(s.range_amount ?? 0))}
          </div>
          {loading && <p className="text-xs text-center text-muted-foreground py-4">加载中…</p>}
          {!loading && byMerchant.length === 0 && <p className="text-xs text-center text-muted-foreground py-4">暂无数据</p>}
          <div className="divide-y divide-border">
            {byMerchant.map((m) => (
              <div key={m.merchant_id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm truncate">{m.shop_name ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    抽成 {(Number(m.rate) * 100).toFixed(2).replace(/\.?0+$/,"")}% · {Number(m.order_count)} 单 · GMV {fmtMoney(Number(m.total_amount))}
                  </div>
                </div>
                <div className="text-sm font-medium text-success shrink-0">{fmtMoney(Number(m.platform_amount))}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-card rounded-xl p-3">
          <div className="text-sm font-medium mb-2">明细流水（最近 {orders.length} 条）</div>
          {orders.length === 0 && <p className="text-xs text-center text-muted-foreground py-4">暂无明细</p>}
          <div className="divide-y divide-border">
            {orders.map((o) => (
              <div key={o.order_id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm truncate">{o.shop_name ?? "—"}</div>
                  <div className="text-sm font-medium text-success">+{fmtMoney(Number(o.platform_amount))}</div>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2 mt-0.5">
                  <span className="truncate">{o.product_title ?? "—"} · 买家 {o.buyer_nickname ?? o.buyer_code ?? "—"}</span>
                  <span className="shrink-0">{fmtDate(o.paid_at, "MM-dd HH:mm")} · ¥{Number(o.amount).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-center">
            <Link to="/admin" className="text-xs text-info">返回管理后台 ›</Link>
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
