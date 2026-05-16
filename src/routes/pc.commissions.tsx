import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search } from "lucide-react";

export const Route = createFileRoute("/pc/commissions")({
  component: CommissionsPage,
});

function CommissionsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [level, setLevel] = useState<"all" | 1>("all");
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: cs } = await supabase.from("commission_records")
        .select("id,order_id,beneficiary_id,level,amount,rate,created_at")
        .order("created_at", { ascending: false }).limit(500);
      const list = cs ?? [];
      const benIds = Array.from(new Set(list.map((c: any) => c.beneficiary_id)));
      const orderIds = Array.from(new Set(list.map((c: any) => c.order_id)));
      const [{ data: profs }, { data: ods }] = await Promise.all([
        benIds.length ? supabase.from("profiles").select("user_id,nickname,phone,user_code").in("user_id", benIds) : Promise.resolve({ data: [] as any[] }),
        orderIds.length ? supabase.from("orders").select("id,amount,merchant_id,buyer_id").in("id", orderIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pMap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
      const oMap = Object.fromEntries((ods ?? []).map((o: any) => [o.id, o]));
      const mIds = Array.from(new Set((ods ?? []).map((o: any) => o.merchant_id)));
      const { data: ms } = mIds.length ? await supabase.from("merchants").select("id,shop_name").in("id", mIds) : { data: [] as any[] };
      const mMap = Object.fromEntries((ms ?? []).map((m: any) => [m.id, m.shop_name]));

      setRows(list.map((c: any) => ({
        ...c,
        beneficiary: pMap[c.beneficiary_id],
        order: oMap[c.order_id],
        shop_name: oMap[c.order_id] ? mMap[oMap[c.order_id].merchant_id] : null,
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let l = rows;
    if (level !== "all") l = l.filter((c) => c.level === level);
    if (kw.trim()) {
      const k = kw.toLowerCase();
      l = l.filter((c) =>
        c.beneficiary?.nickname?.toLowerCase().includes(k) ||
        c.beneficiary?.phone?.includes(kw) ||
        c.shop_name?.toLowerCase().includes(k) ||
        c.order_id?.includes(kw),
      );
    }
    return l;
  }, [rows, level, kw]);

  const totalAmount = filtered.reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div>
      <PcPageHeader title="返佣记录" description={`当前筛选合计 ${fmtMoney(totalAmount)}`} />
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1">
            {([["all", "全部"], [1, "L1 直推"], [2, "L2 间推"]] as const).map(([k, label]) => (
              <button key={String(k)} onClick={() => setLevel(k as any)} className={`px-3 py-1.5 text-sm rounded-md ${level === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="代理/订单号/店铺" className="h-8 w-72" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>店铺</TableHead>
              <TableHead>受益代理</TableHead>
              <TableHead>级别</TableHead>
              <TableHead className="text-right">订单金额</TableHead>
              <TableHead className="text-right">比例</TableHead>
              <TableHead className="text-right">佣金</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">暂无返佣记录</TableCell></TableRow>}
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs font-mono text-muted-foreground">{c.order_id?.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{c.shop_name ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {c.beneficiary ? (
                    <Link to="/pc/users/agent/$userId" params={{ userId: c.beneficiary_id }} className="hover:underline">
                      {c.beneficiary.nickname ?? "—"} <span className="text-xs text-muted-foreground">{c.beneficiary.phone ?? ""}</span>
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell>L{c.level}</TableCell>
                <TableCell className="text-right">{fmtMoney(c.order?.amount ?? 0)}</TableCell>
                <TableCell className="text-right">{(Number(c.rate) * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right text-success font-medium">{fmtMoney(c.amount)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
