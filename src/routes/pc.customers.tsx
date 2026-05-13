import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search, Eye } from "lucide-react";

export const Route = createFileRoute("/pc/customers")({
  component: CustomersPage,
});

type Row = {
  user_id: string;
  user_code: string;
  nickname: string | null;
  phone: string | null;
  created_at: string;
  is_disabled: boolean;
  upline_nickname: string | null;
  upline_phone: string | null;
  balance: number;
  total_recharge: number;
};

function CustomersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,user_id,user_code,nickname,phone,created_at,is_disabled")
        .order("created_at", { ascending: false })
        .limit(1000);
      const list = profs ?? [];
      const uids = list.map((p: any) => p.user_id);

      const [{ data: rels }, { data: wallets }] = await Promise.all([
        uids.length ? supabase.from("agent_relations").select("user_id,upline_id").in("user_id", uids) : Promise.resolve({ data: [] as any[] }),
        uids.length ? supabase.from("wallets").select("user_id,balance,total_recharge").in("user_id", uids) : Promise.resolve({ data: [] as any[] }),
      ]);
      const upMap = Object.fromEntries((rels ?? []).map((r: any) => [r.user_id, r.upline_id]));
      const upIds = Array.from(new Set(Object.values(upMap).filter(Boolean) as string[]));
      const { data: upProfs } = upIds.length
        ? await supabase.from("profiles").select("id,nickname,phone").in("id", upIds)
        : { data: [] as any[] };
      const upPMap = Object.fromEntries((upProfs ?? []).map((p: any) => [p.id, p]));
      const wMap = Object.fromEntries((wallets ?? []).map((w: any) => [w.user_id, w]));

      setRows(list.map((p: any) => {
        const upId = upMap[p.user_id];
        const up = upId ? upPMap[upId] : null;
        const w = wMap[p.user_id];
        return {
          ...p,
          upline_nickname: up?.nickname ?? null,
          upline_phone: up?.phone ?? null,
          balance: Number(w?.balance ?? 0),
          total_recharge: Number(w?.total_recharge ?? 0),
        };
      }));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!kw.trim()) return rows;
    const k = kw.toLowerCase();
    return rows.filter((r) =>
      r.nickname?.toLowerCase().includes(k) ||
      r.phone?.includes(k) ||
      r.user_code?.toLowerCase().includes(k) ||
      r.upline_nickname?.toLowerCase().includes(k),
    );
  }, [rows, kw]);

  return (
    <div>
      <PcPageHeader title="客户管理" description={`共 ${rows.length} 位用户`} />
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索昵称/手机号/编号/归属代理" className="h-8 w-80" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>手机号</TableHead>
              <TableHead>归属代理</TableHead>
              <TableHead className="text-right">余额</TableHead>
              <TableHead className="text-right">累计充值</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">暂无用户</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell><div className="font-medium">{r.nickname ?? "—"}</div><div className="text-xs text-muted-foreground">{r.user_code}</div></TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.phone ?? "—"}</TableCell>
                <TableCell className="text-sm">{r.upline_nickname ? `${r.upline_nickname} · ${r.upline_phone ?? "—"}` : <span className="text-muted-foreground">未绑定</span>}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.balance)}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.total_recharge)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</TableCell>
                <TableCell>
                  {r.is_disabled
                    ? <span className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive">已禁用</span>
                    : <span className="text-xs px-2 py-0.5 rounded bg-success/10 text-success">正常</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Link to="/pc/users/buyer/$userId" params={{ userId: r.user_id }}>
                    <Button size="sm" variant="outline"><Eye className="h-3 w-3 mr-1" />详情</Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
