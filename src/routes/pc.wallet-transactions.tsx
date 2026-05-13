import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search } from "lucide-react";

export const Route = createFileRoute("/pc/wallet-transactions")({
  component: WalletTxPage,
});

function WalletTxPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [type, setType] = useState<string>("all");
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: ts } = await supabase.from("wallet_transactions")
        .select("id,user_id,type,amount,balance_after,description,created_at,reference_id")
        .order("created_at", { ascending: false }).limit(500);
      const list = ts ?? [];
      const uids = Array.from(new Set(list.map((t: any) => t.user_id)));
      const { data: profs } = uids.length ? await supabase.from("profiles").select("user_id,nickname,phone,user_code").in("user_id", uids) : { data: [] as any[] };
      const pMap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
      setRows(list.map((t: any) => ({ ...t, profile: pMap[t.user_id] })));
      setLoading(false);
    })();
  }, []);

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.type))), [rows]);

  const filtered = useMemo(() => {
    let l = rows;
    if (type !== "all") l = l.filter((t) => t.type === type);
    if (kw.trim()) {
      const k = kw.toLowerCase();
      l = l.filter((t) =>
        t.profile?.nickname?.toLowerCase().includes(k) ||
        t.profile?.phone?.includes(kw) ||
        t.description?.toLowerCase().includes(k),
      );
    }
    return l;
  }, [rows, type, kw]);

  const totalIn = filtered.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalOut = filtered.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div>
      <PcPageHeader title="钱包流水" description={`收入合计 ${fmtMoney(totalIn)} · 支出合计 ${fmtMoney(totalOut)}`} />
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setType("all")} className={`px-3 py-1.5 text-sm rounded-md ${type === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>全部</button>
            {types.map((t) => (
              <button key={t} onClick={() => setType(t)} className={`px-3 py-1.5 text-sm rounded-md ${type === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{t}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="用户/手机号/说明" className="h-8 w-72" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead className="text-right">余额</TableHead>
              <TableHead>说明</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">暂无流水</TableCell></TableRow>}
            {filtered.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm">
                  {t.profile ? (
                    <Link to="/pc/users/buyer/$userId" params={{ userId: t.user_id }} className="hover:underline">
                      {t.profile.nickname ?? "—"} <span className="text-xs text-muted-foreground">{t.profile.phone ?? ""}</span>
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-sm">{t.type}</TableCell>
                <TableCell className={`text-right font-medium ${Number(t.amount) > 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(t.amount)}</TableCell>
                <TableCell className="text-right">{fmtMoney(t.balance_after)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.description ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(t.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
