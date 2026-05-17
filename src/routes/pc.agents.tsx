import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search, Eye } from "lucide-react";

export const Route = createFileRoute("/pc/agents")({
  component: AgentsPage,
});

type Row = {
  user_id: string;
  agent_code: string | null;
  l1_rate: number | null;
  merchant_id: string | null;
  joined_at: string;
  nickname: string | null;
  phone: string | null;
  user_code: string | null;
  shop_name: string | null;
  total_commission: number;
  customer_count: number;
};

function AgentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: sm } = await supabase
        .from("shop_memberships")
        .select("user_id,agent_code,l1_rate,merchant_id,joined_at")
        .eq("is_agent", true)
        .order("joined_at", { ascending: false })
        .limit(1000);
      const list = sm ?? [];
      const uids = Array.from(new Set(list.map((a: any) => a.user_id)));
      const mids = Array.from(new Set(list.map((a: any) => a.merchant_id).filter(Boolean)));
      const [{ data: profs }, { data: ms }, { data: ws }] = await Promise.all([
        uids.length ? supabase.from("profiles").select("user_id,nickname,phone,user_code").in("user_id", uids) : Promise.resolve({ data: [] as any[] }),
        mids.length ? supabase.from("merchants").select("id,shop_name").in("id", mids as string[]) : Promise.resolve({ data: [] as any[] }),
        uids.length ? supabase.from("wallets").select("user_id,total_commission").in("user_id", uids) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pmap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
      const mmap = Object.fromEntries((ms ?? []).map((m: any) => [m.id, m.shop_name]));
      const wmap = Object.fromEntries((ws ?? []).map((w: any) => [w.user_id, Number(w.total_commission)]));

      // 每个 (agent user_id, merchant_id) 的客户数
      const custMap: Record<string, number> = {};
      if (uids.length) {
        const { data: cs } = await supabase
          .from("shop_memberships")
          .select("upline_user_id,merchant_id")
          .in("upline_user_id", uids)
          .eq("is_agent", false);
        (cs ?? []).forEach((c: any) => {
          const k = `${c.upline_user_id}::${c.merchant_id}`;
          custMap[k] = (custMap[k] ?? 0) + 1;
        });
      }

      setRows(list.map((a: any) => ({
        user_id: a.user_id,
        agent_code: a.agent_code,
        l1_rate: a.l1_rate,
        merchant_id: a.merchant_id,
        joined_at: a.joined_at,
        nickname: pmap[a.user_id]?.nickname ?? null,
        phone: pmap[a.user_id]?.phone ?? null,
        user_code: pmap[a.user_id]?.user_code ?? null,
        shop_name: a.merchant_id ? mmap[a.merchant_id] ?? null : null,
        total_commission: wmap[a.user_id] ?? 0,
        customer_count: custMap[`${a.user_id}::${a.merchant_id}`] ?? 0,
      })));
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
      r.agent_code?.toLowerCase().includes(k) ||
      r.shop_name?.toLowerCase().includes(k),
    );
  }, [rows, kw]);

  return (
    <div>
      <PcPageHeader title="代理管理" description={`共 ${rows.length} 位代理`} />
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索昵称/手机号/编号/代理码/归属店铺" className="h-8 w-80" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>代理</TableHead>
              <TableHead>手机号</TableHead>
              <TableHead>归属店铺</TableHead>
              <TableHead className="text-right">分成比例</TableHead>
              <TableHead className="text-right">累计佣金</TableHead>
              <TableHead className="text-right">客户数</TableHead>
              <TableHead>加入时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">加载中…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">暂无代理</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={`${r.user_id}::${r.merchant_id ?? "_"}`}>
                <TableCell>
                  <Link to="/pc/customers" search={{ agentId: r.user_id }} className="font-medium hover:underline">{r.nickname ?? "—"}</Link>
                  <div className="text-xs text-muted-foreground">{r.agent_code ?? r.user_code ?? "—"}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.phone ?? "—"}</TableCell>
                <TableCell className="text-sm">{r.shop_name ?? <span className="text-muted-foreground">未绑定</span>}</TableCell>
                <TableCell className="text-right">{r.l1_rate != null ? `${(r.l1_rate * 100).toFixed(0)}%` : <span className="text-muted-foreground">默认</span>}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.total_commission)}</TableCell>
                <TableCell className="text-right">{r.customer_count}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtDate(r.joined_at)}</TableCell>
                <TableCell className="text-right">
                  <Link to="/pc/users/agent/$userId" params={{ userId: r.user_id }}>
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
