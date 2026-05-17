import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search, Eye, Unlink } from "lucide-react";
import { toast } from "sonner";
import { reportRpcError } from "@/lib/error-logger";

export const Route = createFileRoute("/pc/customers")({
  validateSearch: (s: Record<string, unknown>) => ({
    agentId: typeof s.agentId === "string" ? s.agentId : undefined,
    merchantId: typeof s.merchantId === "string" ? s.merchantId : undefined,
  }),
  component: CustomersPage,
});

type Row = {
  user_id: string;
  profile_id: string;
  user_code: string;
  nickname: string | null;
  phone: string | null;
  created_at: string;
  is_disabled: boolean;
  upline_user_id: string | null;
  upline_nickname: string | null;
  upline_phone: string | null;
  upline_merchant_id: string | null;
  balance: number;
  total_recharge: number;
};

type AgentOpt = { user_id: string; nickname: string | null; phone: string | null };
type MerchantOpt = { id: string; shop_name: string };

function CustomersPage() {
  const search = Route.useSearch();
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [merchants, setMerchants] = useState<MerchantOpt[]>([]);
  const [kw, setKw] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>(search.agentId ?? "all");
  const [merchantFilter, setMerchantFilter] = useState<string>(search.merchantId ?? "all");
  const [loading, setLoading] = useState(false);

  useEffect(() => { setAgentFilter(search.agentId ?? "all"); }, [search.agentId]);
  useEffect(() => { setMerchantFilter(search.merchantId ?? "all"); }, [search.merchantId]);

  const load = async () => {
    setLoading(true);
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,user_id,user_code,nickname,phone,created_at,is_disabled")
      .order("created_at", { ascending: false })
      .limit(1000);
    const list = profs ?? [];
    const allUids = list.map((p: any) => p.user_id);

    // Identify agents and merchants to exclude
    const [{ data: smAgents }, { data: ms }] = await Promise.all([
      allUids.length ? supabase.from("shop_memberships").select("user_id").in("user_id", allUids).eq("is_agent", true) : Promise.resolve({ data: [] as any[] }),
      allUids.length ? supabase.from("merchants").select("user_id").in("user_id", allUids) : Promise.resolve({ data: [] as any[] }),
    ]);
    const agentUids = new Set((smAgents ?? []).map((r: any) => r.user_id));
    const merchantUids = new Set((ms ?? []).map((m: any) => m.user_id));
    const buyers = list.filter((p: any) => !agentUids.has(p.user_id) && !merchantUids.has(p.user_id));
    const uids = buyers.map((p: any) => p.user_id);

    const [{ data: rels }, { data: wallets }] = await Promise.all([
      uids.length ? supabase.from("shop_memberships").select("user_id,upline_user_id,merchant_id,joined_at").in("user_id", uids).order("joined_at", { ascending: true }) : Promise.resolve({ data: [] as any[] }),
      uids.length ? supabase.from("wallets").select("user_id,balance,total_recharge").in("user_id", uids) : Promise.resolve({ data: [] as any[] }),
    ]);
    // 取每个 user 第一个有 upline 的店；否则任取第一行
    const relMap: Record<string, any> = {};
    (rels ?? []).forEach((r: any) => {
      const cur = relMap[r.user_id];
      if (!cur) relMap[r.user_id] = r;
      else if (!cur.upline_user_id && r.upline_user_id) relMap[r.user_id] = r;
    });
    const upUids = Array.from(new Set(Object.values(relMap).map((r: any) => r.upline_user_id).filter(Boolean) as string[]));
    const { data: upProfs } = upUids.length
      ? await supabase.from("profiles").select("user_id,nickname,phone").in("user_id", upUids)
      : { data: [] as any[] };
    const upPMap = Object.fromEntries((upProfs ?? []).map((p: any) => [p.user_id, p]));
    const wMap = Object.fromEntries((wallets ?? []).map((w: any) => [w.user_id, w]));

    setRows(buyers.map((p: any) => {
      const rel = relMap[p.user_id];
      const upUid = rel?.upline_user_id ?? null;
      const up = upUid ? upPMap[upUid] : null;
      const w = wMap[p.user_id];
      return {
        user_id: p.user_id,
        profile_id: p.id,
        user_code: p.user_code,
        nickname: p.nickname,
        phone: p.phone,
        created_at: p.created_at,
        is_disabled: p.is_disabled,
        upline_user_id: upUid,
        upline_nickname: up?.nickname ?? null,
        upline_phone: up?.phone ?? null,
        upline_merchant_id: rel?.merchant_id ?? null,
        balance: Number(w?.balance ?? 0),
        total_recharge: Number(w?.total_recharge ?? 0),
      };
    }));
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      // Load agents and merchants for filter dropdowns
      const { data: sm } = await supabase
        .from("shop_memberships")
        .select("user_id")
        .eq("is_agent", true)
        .limit(2000);
      const agUids = Array.from(new Set((sm ?? []).map((a: any) => a.user_id)));
      const { data: agProfs } = agUids.length
        ? await supabase.from("profiles").select("user_id,nickname,phone").in("user_id", agUids)
        : { data: [] as any[] };
      setAgents((agProfs ?? []).map((p: any) => ({
        user_id: p.user_id, nickname: p.nickname ?? null, phone: p.phone ?? null,
      })));

      const { data: mList } = await supabase.from("merchants").select("id,shop_name").order("shop_name");
      setMerchants(((mList ?? []) as any[]).map((m) => ({ id: m.id, shop_name: m.shop_name })));
    })();
    load();
  }, []);

  const unbindAgent = async (r: Row) => {
    if (!confirm(`确定解绑「${r.nickname ?? r.user_code}」与代理「${r.upline_nickname ?? "-"}」的绑定关系？`)) return;
    if (!r.upline_merchant_id) { toast.error("缺少归属店铺信息，无法解绑"); return; }
    const { error } = await supabase
      .from("shop_memberships")
      .update({ upline_user_id: null })
      .eq("user_id", r.user_id)
      .eq("merchant_id", r.upline_merchant_id);
    if (error) { reportRpcError(error, { op: "shop_memberships.unbind_upline", scope: "PcCustomers" }); return; }
    toast.success("已解绑归属代理");
    load();
  };

  const filtered = useMemo(() => {
    let out = rows;
    if (agentFilter === "__none__") out = out.filter((r) => !r.upline_user_id);
    else if (agentFilter !== "all") out = out.filter((r) => r.upline_user_id === agentFilter);
    if (merchantFilter === "__none__") out = out.filter((r) => !r.upline_merchant_id);
    else if (merchantFilter !== "all") out = out.filter((r) => r.upline_merchant_id === merchantFilter);
    if (kw.trim()) {
      const k = kw.toLowerCase();
      out = out.filter((r) =>
        r.nickname?.toLowerCase().includes(k) ||
        r.phone?.includes(k) ||
        r.user_code?.toLowerCase().includes(k) ||
        r.upline_nickname?.toLowerCase().includes(k),
      );
    }
    return out;
  }, [rows, kw, agentFilter, merchantFilter]);

  const merchantNameMap = useMemo(() => Object.fromEntries(merchants.map((m) => [m.id, m.shop_name])), [merchants]);

  return (
    <div>
      <PcPageHeader title="客户管理" description={`共 ${filtered.length} 位用户`} />
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索昵称/手机号/编号/归属代理" className="h-8 w-72" />
          </div>
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="按代理过滤" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部代理</SelectItem>
              <SelectItem value="__none__">未绑定代理</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {a.nickname ?? "未命名"}{a.phone ? ` · ${a.phone}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={merchantFilter} onValueChange={setMerchantFilter}>
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="按归属商家过滤" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部商家</SelectItem>
              <SelectItem value="__none__">未绑定商家</SelectItem>
              {merchants.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.shop_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            {filtered.map((r) => {
              return (
                <TableRow key={r.user_id}>
                  <TableCell><div className="font-medium">{r.nickname ?? "—"}</div><div className="text-xs text-muted-foreground">{r.user_code}</div></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.upline_user_id ? (
                      <div className="space-y-0.5">
                        <div>{r.upline_nickname ?? "—"}{r.upline_phone ? ` · ${r.upline_phone}` : ""}</div>
                        {r.upline_merchant_id && <div className="text-xs text-muted-foreground">{merchantNameMap[r.upline_merchant_id] ?? "—"}</div>}
                        <button
                          onClick={() => unbindAgent(r)}
                          className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
                        >
                          <Unlink className="h-3 w-3" />解绑
                        </button>
                      </div>
                    ) : <span className="text-muted-foreground">未绑定</span>}
                  </TableCell>
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
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
