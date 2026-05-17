import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { reportRpcError } from "@/lib/error-logger";
import { Search } from "lucide-react";

export const Route = createFileRoute("/pc/finance")({
  component: FinancePage,
});

type RangeKey = "today" | "week" | "month" | "all";

function rangeOf(k: RangeKey): { from?: string; to?: string } {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (k === "today") return { from: d.toISOString() };
  if (k === "week") { const f = new Date(d); f.setDate(f.getDate() - 6); return { from: f.toISOString() }; }
  if (k === "month") { const f = new Date(d); f.setDate(1); return { from: f.toISOString() }; }
  return {};
}

function FinancePage() {
  const [range, setRange] = useState<RangeKey>("month");
  const [merchantId, setMerchantId] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = rangeOf(range);
      const { data: d, error } = await supabase.rpc("admin_platform_income" as any, {
        _from: r.from ?? null, _to: r.to ?? null,
        _merchant_id: merchantId || null, _limit: 500,
      });
      if (cancelled) return;
      if (error) reportRpcError(error, { op: "admin_platform_income", scope: "PcFinance" });
      else setData(d);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range, merchantId]);

  const s = data?.summary ?? {};
  const byMerchant: any[] = data?.by_merchant ?? [];
  const orders: any[] = data?.orders ?? [];

  const filteredOrders = useMemo(() => {
    if (!kw.trim()) return orders;
    const k = kw.toLowerCase();
    return orders.filter((o) =>
      o.shop_name?.toLowerCase().includes(k) ||
      o.product_title?.toLowerCase().includes(k) ||
      o.buyer_nickname?.toLowerCase().includes(k) ||
      o.buyer_code?.toLowerCase().includes(k) ||
      o.order_id?.includes(kw),
    );
  }, [orders, kw]);

  return (
    <div>
      <PcPageHeader
        title="平台财务"
        description="按订单实时计算平台抽成（订单金额 × 商家当前抽成比例）"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="今日抽成" value={fmtMoney(Number(s.today ?? 0))} />
        <KpiCard label="昨日抽成" value={fmtMoney(Number(s.yesterday ?? 0))} />
        <KpiCard label="本月抽成" value={fmtMoney(Number(s.month ?? 0))} />
        <KpiCard label="累计抽成" value={fmtMoney(Number(s.total ?? 0))} />
      </div>

      <div className="bg-card border border-border rounded-xl mb-4">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm font-medium">按商家分组</div>
          <div className="flex items-center gap-1">
            {([["today","今日"],["week","近7天"],["month","本月"],["all","全部"]] as const).map(([k,l]) => (
              <button key={k} onClick={() => setRange(k)}
                className={`px-3 py-1.5 text-sm rounded-md ${range===k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
          区间合计：{fmtMoney(Number(s.range ?? 0))} · {Number(s.range_orders ?? 0)} 单 · GMV {fmtMoney(Number(s.range_amount ?? 0))} · 默认抽成 {(Number(s.default_rate ?? 0) * 100).toFixed(2).replace(/\.?0+$/,"")}%
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>店铺</TableHead>
              <TableHead className="text-right">抽成比例</TableHead>
              <TableHead className="text-right">订单数</TableHead>
              <TableHead className="text-right">GMV</TableHead>
              <TableHead className="text-right">平台抽成</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && byMerchant.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">暂无数据</TableCell></TableRow>}
            {byMerchant.map((m) => (
              <TableRow key={m.merchant_id} className={merchantId === m.merchant_id ? "bg-accent/50" : ""}>
                <TableCell className="text-sm">{m.shop_name ?? "—"}</TableCell>
                <TableCell className="text-right text-sm">{(Number(m.rate) * 100).toFixed(2).replace(/\.?0+$/,"")}%</TableCell>
                <TableCell className="text-right text-sm">{Number(m.order_count)}</TableCell>
                <TableCell className="text-right text-sm">{fmtMoney(Number(m.total_amount))}</TableCell>
                <TableCell className="text-right text-sm font-medium text-success">{fmtMoney(Number(m.platform_amount))}</TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => setMerchantId(merchantId === m.merchant_id ? "" : m.merchant_id)}
                    className="text-xs text-info hover:underline"
                  >{merchantId === m.merchant_id ? "取消筛选" : "查看明细"}</button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm font-medium">
            提成明细流水{merchantId ? "（已筛选当前商家）" : ""}
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="店铺/商品/买家/订单号" className="h-8 w-72" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>店铺</TableHead>
              <TableHead>商品</TableHead>
              <TableHead>买家</TableHead>
              <TableHead className="text-right">订单金额</TableHead>
              <TableHead className="text-right">抽成比例</TableHead>
              <TableHead className="text-right">平台抽成</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && filteredOrders.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">暂无明细</TableCell></TableRow>}
            {filteredOrders.map((o) => (
              <TableRow key={o.order_id}>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(o.paid_at)}</TableCell>
                <TableCell className="text-sm">{o.shop_name ?? "—"}</TableCell>
                <TableCell className="text-sm truncate max-w-[260px]">{o.product_title ?? "—"}</TableCell>
                <TableCell className="text-sm">{o.buyer_nickname ?? o.buyer_code ?? "—"}</TableCell>
                <TableCell className="text-right text-sm">{fmtMoney(Number(o.amount))}</TableCell>
                <TableCell className="text-right text-sm">{(Number(o.rate) * 100).toFixed(2).replace(/\.?0+$/,"")}%</TableCell>
                <TableCell className="text-right text-sm font-medium text-success">{fmtMoney(Number(o.platform_amount))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
