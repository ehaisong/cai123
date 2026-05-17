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

export const Route = createFileRoute("/pc/users_/merchant/$merchantId")({
  component: MerchantDetail,
});

function MerchantDetail() {
  const { merchantId } = Route.useParams();
  const [m, setM] = useState<any | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  const load = async () => {
    const [{ data: merchant }, { data: ar }, { data: ords }] = await Promise.all([
      supabase.from("merchants").select("*").eq("id", merchantId).maybeSingle(),
      supabase.from("agent_relations").select("user_id,agent_code,l1_rate,is_agent,created_at").eq("bound_merchant_id", merchantId).eq("is_agent", true),
      supabase.from("orders").select("id,amount,status,created_at,paid_at,buyer_id,product_id,agent_l1_id").eq("merchant_id", merchantId).order("created_at", { ascending: false }).limit(200),
    ]);
    setM(merchant);

    const userIds = (ar ?? []).map((a: any) => a.user_id);
    const buyerIds = Array.from(new Set((ords ?? []).map((o: any) => o.buyer_id)));
    const productIds = Array.from(new Set((ords ?? []).map((o: any) => o.product_id)));
    const allUserIds = Array.from(new Set([...userIds, ...buyerIds]));

    const [{ data: profs }, { data: wallets }, custCounts, { data: products }] = await Promise.all([
      allUserIds.length ? supabase.from("profiles").select("user_id,nickname,phone,user_code,id").in("user_id", allUserIds) : Promise.resolve({ data: [] as any[] }),
      userIds.length ? supabase.from("wallets").select("user_id,total_commission").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
      Promise.resolve(null), // 占位
      productIds.length ? supabase.from("products").select("id,title").in("id", productIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const pmap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
    const pidByUid = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p.id]));
    const wmap = Object.fromEntries((wallets ?? []).map((w: any) => [w.user_id, Number(w.total_commission)]));
    const prodMap = Object.fromEntries((products ?? []).map((p: any) => [p.id, p.title]));

    // 客户数：upline_id = 该代理的 profile.id
    const agentProfIds = userIds.map((uid) => pidByUid[uid]).filter(Boolean);
    const custMap: Record<string, number> = {};
    if (agentProfIds.length) {
      const { data: cs } = await supabase.from("agent_relations").select("upline_id").in("upline_id", agentProfIds).eq("is_agent", false);
      (cs ?? []).forEach((c: any) => { custMap[c.upline_id] = (custMap[c.upline_id] ?? 0) + 1; });
    }

    setAgents((ar ?? []).map((a: any) => ({
      ...a,
      profile: pmap[a.user_id],
      total_commission: wmap[a.user_id] ?? 0,
      customer_count: custMap[pidByUid[a.user_id]] ?? 0,
    })));
    setOrders((ords ?? []).map((o: any) => ({
      ...o,
      buyer: pmap[o.buyer_id],
      agent: o.agent_l1_id ? null : null, // agent_l1_id 是 profile.id
      product_title: prodMap[o.product_id],
    })));
  };
  useEffect(() => { load(); }, [merchantId]);

  const setAgentRate = async (a: any) => {
    const v = prompt(`为代理「${a.profile?.nickname ?? a.user_id}」设置分成比例（0~${m?.l1_max_rate ?? 0.92}，例如 0.30）`, String(a.l1_rate ?? ""));
    if (v === null) return;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0 || n > 1) { toast.error("无效的比例"); return; }
    const { error } = await supabase.from("agent_relations").update({ l1_rate: n }).eq("user_id", a.user_id);
    if (error) { toast.error(error.message); return; }
    toast.success("已更新分成比例");
    load();
  };

  const unbindAgent = async (a: any) => {
    if (!confirm(`确定将「${a.profile?.nickname ?? a.user_id}」从本店解绑？该代理将不再归属本店。`)) return;
    // 解绑：把本店的代理身份取消（保留客户关系），agent_relations 由触发器自动同步
    const { error } = await supabase.from("shop_memberships").update({
      is_agent: false,
      agent_code: null,
      l1_rate: null,
    }).eq("user_id", a.user_id).eq("merchant_id", merchantId);
    if (error) { toast.error(error.message); return; }
    toast.success("已解绑");
    load();
  };

  if (!m) return <div className="text-sm text-muted-foreground">加载中…</div>;

  return (
    <div>
      <Link to="/pc/users" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-4 w-4 mr-1" />返回商家列表
      </Link>
      <PcPageHeader
        title={m.shop_name}
        description={`${m.real_name ?? "—"} · ${m.status}${m.is_disabled ? " · 已关店" : ""}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <Card label="累计销售">{fmtMoney(m.total_sales)}</Card>
        <Card label="一级分成默认 / 上限">{(m.l1_rate * 100).toFixed(0)}% / {(m.l1_max_rate * 100).toFixed(0)}%</Card>
        <Card label="入驻时间">{fmtDate(m.created_at)}</Card>
        <Card label="联系方式">{m.wechat_id ?? "—"}</Card>
      </div>

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">旗下代理（{agents.length}）</TabsTrigger>
          <TabsTrigger value="orders">本店订单（{orders.length}）</TabsTrigger>
          <TabsTrigger value="info">店铺资料</TabsTrigger>
        </TabsList>
        <TabsContent value="agents">
          <div className="bg-card border border-border rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>昵称 / 代理码</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead className="text-right">分成比例</TableHead>
                  <TableHead className="text-right">累计佣金</TableHead>
                  <TableHead className="text-right">客户数</TableHead>
                  <TableHead>加入时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">暂无代理</TableCell></TableRow>}
                {agents.map((a) => (
                  <TableRow key={a.user_id}>
                    <TableCell><div className="font-medium">{a.profile?.nickname ?? "—"}</div><div className="text-xs text-muted-foreground">{a.agent_code ?? a.profile?.user_code}</div></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.profile?.phone ?? "—"}</TableCell>
                    <TableCell className="text-right">{a.l1_rate != null ? `${(a.l1_rate * 100).toFixed(0)}%` : <span className="text-muted-foreground">默认</span>}</TableCell>
                    <TableCell className="text-right">{fmtMoney(a.total_commission)}</TableCell>
                    <TableCell className="text-right">{a.customer_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link to="/pc/users/agent/$userId" params={{ userId: a.user_id }}>
                          <Button size="sm" variant="outline"><Eye className="h-3 w-3 mr-1" />详情</Button>
                        </Link>
                        <Button size="sm" variant="outline" onClick={() => setAgentRate(a)}>调佣金</Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => unbindAgent(a)}>解绑</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="orders">
          <div className="bg-card border border-border rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>订单</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>买家</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>支付时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">暂无订单</TableCell></TableRow>}
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs font-mono text-muted-foreground">{o.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-sm">{o.product_title ?? "—"}</TableCell>
                    <TableCell className="text-sm">{o.buyer?.nickname ?? "—"} <span className="text-xs text-muted-foreground">{o.buyer?.phone ?? ""}</span></TableCell>
                    <TableCell className="text-right">{fmtMoney(o.amount)}</TableCell>
                    <TableCell><span className={`text-xs px-2 py-0.5 rounded ${o.status === "paid" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{o.status}</span></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(o.paid_at ?? o.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="info">
          <div className="bg-card border border-border rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field label="店铺名称">{m.shop_name}</Field>
            <Field label="负责人">{m.real_name ?? "—"}</Field>
            <Field label="微信号">{m.wechat_id ?? "—"}</Field>
            <Field label="公众号">{m.public_account ?? "—"}</Field>
            <Field label="粉丝数">{m.fans_count ?? 0}</Field>
            <Field label="状态">{m.status}{m.is_disabled ? "（已关店）" : ""}</Field>
            <Field label="关店原因">{m.disabled_reason ?? "—"}</Field>
            <Field label="关店时间">{fmtDate(m.disabled_at)}</Field>
            <div className="md:col-span-2"><Field label="店铺简介">{m.shop_description ?? "—"}</Field></div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
