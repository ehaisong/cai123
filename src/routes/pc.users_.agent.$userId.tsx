import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, Eye } from "lucide-react";

export const Route = createFileRoute("/pc/users_/agent/$userId")({
  component: AgentDetail,
});

function AgentDetail() {
  const { userId } = Route.useParams();
  const [profile, setProfile] = useState<any>(null);
  const [relation, setRelation] = useState<any>(null);
  const [merchant, setMerchant] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, today: 0, month: 0 });

  const load = async () => {
    const [{ data: p }, { data: ar }, { data: cr }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("agent_relations").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("commission_records").select("*").eq("beneficiary_id", userId).order("created_at", { ascending: false }).limit(200),
    ]);
    setProfile(p);
    setRelation(ar);
    if (ar?.bound_merchant_id) {
      const { data: m } = await supabase.from("merchants").select("id,shop_name").eq("id", ar.bound_merchant_id).maybeSingle();
      setMerchant(m);
    } else setMerchant(null);

    setCommissions(cr ?? []);
    const total = (cr ?? []).reduce((a, c: any) => a + Number(c.amount), 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const tSum = (cr ?? []).filter((c: any) => new Date(c.created_at) >= today).reduce((a, c: any) => a + Number(c.amount), 0);
    const mSum = (cr ?? []).filter((c: any) => new Date(c.created_at) >= monthStart).reduce((a, c: any) => a + Number(c.amount), 0);
    setStats({ total, today: tSum, month: mSum });

    if (p?.id) {
      const { data: cs } = await supabase.from("agent_relations").select("user_id,created_at,is_agent").eq("upline_id", p.id);
      const cuids = (cs ?? []).map((c: any) => c.user_id);
      const { data: cps } = cuids.length ? await supabase.from("profiles").select("user_id,nickname,phone,user_code").in("user_id", cuids) : { data: [] as any[] };
      const cmap = Object.fromEntries((cps ?? []).map((x: any) => [x.user_id, x]));
      setCustomers((cs ?? []).map((c: any) => ({ ...c, profile: cmap[c.user_id] })));
    }
  };
  useEffect(() => { load(); }, [userId]);

  const unbindCustomer = async (c: any) => {
    if (!confirm(`确定将「${c.profile?.nickname ?? c.user_id}」从该代理解绑？`)) return;
    const { error } = await supabase.from("agent_relations").update({ upline_id: null }).eq("user_id", c.user_id);
    if (error) { toast.error(error.message); return; }
    toast.success("已解绑");
    load();
  };

  if (!profile) return <div className="text-sm text-muted-foreground">加载中…</div>;

  return (
    <div>
      <Link to="/pc/users" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-4 w-4 mr-1" />返回用户列表
      </Link>
      <PcPageHeader
        title={profile.nickname ?? "未命名"}
        description={`代理 · 编号 ${profile.user_code} · 手机 ${profile.phone ?? "—"}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="今日佣金">{fmtMoney(stats.today)}</Stat>
        <Stat label="本月佣金">{fmtMoney(stats.month)}</Stat>
        <Stat label="累计佣金">{fmtMoney(stats.total)}</Stat>
        <Stat label="归属店铺">
          {merchant ? (
            <Link to="/pc/users/merchant/$merchantId" params={{ merchantId: merchant.id }} className="text-primary hover:underline">{merchant.shop_name}</Link>
          ) : <span className="text-muted-foreground">未绑定</span>}
        </Stat>
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">旗下客户（{customers.length}）</TabsTrigger>
          <TabsTrigger value="commissions">返佣明细（{commissions.length}）</TabsTrigger>
        </TabsList>
        <TabsContent value="customers">
          <div className="bg-card border border-border rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>昵称</TableHead>
                  <TableHead>编号 / 手机</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>绑定时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">暂无下线</TableCell></TableRow>}
                {customers.map((c) => (
                  <TableRow key={c.user_id}>
                    <TableCell className="font-medium">{c.profile?.nickname ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.profile?.user_code} · {c.profile?.phone ?? "—"}</TableCell>
                    <TableCell><span className={`text-xs px-2 py-0.5 rounded ${c.is_agent ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{c.is_agent ? "代理" : "客户"}</span></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link to="/pc/users/buyer/$userId" params={{ userId: c.user_id }}>
                          <Button size="sm" variant="outline"><Eye className="h-3 w-3 mr-1" />详情</Button>
                        </Link>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => unbindCustomer(c)}>解绑</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="commissions">
          <div className="bg-card border border-border rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>订单</TableHead>
                  <TableHead>级别</TableHead>
                  <TableHead className="text-right">比例</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">暂无返佣记录</TableCell></TableRow>}
                {commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs font-mono text-muted-foreground">{c.order_id?.slice(0, 8)}</TableCell>
                    <TableCell>L{c.level}</TableCell>
                    <TableCell className="text-right">{(Number(c.rate) * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(c.amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{children}</div>
    </div>
  );
}
