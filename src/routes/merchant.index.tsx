import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { fmtMoney } from "@/lib/format";
import { Plus, Package, QrCode, Users, Store, Percent, LogOut, Link2, Send, Settings, ShieldCheck } from "lucide-react";
import { RouteGuard } from "@/components/route-guard";
import { useLogout } from "@/lib/use-logout";
import { MerchantBottomNav } from "@/components/h5/merchant-bottom-nav";

export const Route = createFileRoute("/merchant/")({
  component: MerchantHome,
});

function MerchantHome() {
  return (
    <RouteGuard title="商家后台" roles={["merchant"]} forbiddenText="此页面仅限商家访问，请先申请入驻">
      <MerchantHomeInner />
    </RouteGuard>
  );
}

function MerchantHomeInner() {
  const { user } = useAuth();
  const logout = useLogout();
  const [merchant, setMerchant] = useState<any>(null);
  const [merchantLoading, setMerchantLoading] = useState(true);
  const [stats, setStats] = useState({ products: 0, orders: 0, balance: 0, monthSales: 0 });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setMerchantLoading(true);
      const { data: m } = await supabase.from("merchants").select("*").eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      setMerchant(m);
      setMerchantLoading(false);
      if (!m) return;
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const [{ count: pc }, { count: oc }, { data: w }, { data: monthOrders }] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("merchant_id", m.id),
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("merchant_id", m.id).eq("status", "paid"),
        supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase.from("orders").select("amount").eq("merchant_id", m.id).eq("status", "paid").gte("paid_at", monthStart.toISOString()),
      ]);
      if (cancelled) return;
      const monthSales = (monthOrders ?? []).reduce((s, r: any) => s + Number(r.amount), 0);
      setStats({ products: pc ?? 0, orders: oc ?? 0, balance: Number(w?.balance ?? 0), monthSales });
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  if (merchantLoading) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="商家后台" />
        <div className="flex-1 p-6 text-center text-sm text-muted-foreground">加载中…</div>
        <MerchantBottomNav />
      </div>
    );
  }
  if (!merchant) return <div className="h5-shell flex min-h-screen flex-col"><PageHeader title="商家后台" /><div className="flex-1 p-6 text-center text-sm text-muted-foreground">您还不是商家。<Link to="/merchant/apply" className="text-info">去申请 ›</Link></div><MerchantBottomNav /></div>;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家后台" />



      <div className="m-3 rounded-2xl p-5 text-white" style={{ background: "var(--gradient-orange)" }}>
        <div className="text-sm opacity-90">{merchant.shop_name}</div>
        <div className="mt-2 text-xs opacity-80">本月销售额（元）</div>
        <div className="text-3xl font-bold mt-1">{stats.monthSales.toFixed(2)}</div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div><div className="text-xs opacity-80">商品</div><div className="text-lg font-bold">{stats.products}</div></div>
          <div><div className="text-xs opacity-80">订单</div><div className="text-lg font-bold">{stats.orders}</div></div>
          <div><div className="text-xs opacity-80">余额</div><div className="text-lg font-bold">{stats.balance.toFixed(2)}</div></div>
        </div>
      </div>

      <div className="bg-card mx-3 rounded-2xl p-5 grid grid-cols-3 gap-y-5">
        <Cell icon={<Store className="w-6 h-6 text-success" />} label="店铺信息" to="/merchant/shop" />
        <Cell icon={<Plus className="w-6 h-6 text-success" />} label="发布商品" to="/merchant/products/new" />
        <Cell icon={<Package className="w-6 h-6 text-info" />} label="商品管理" to="/merchant/products" />
        
        <Cell icon={<QrCode className="w-6 h-6 text-primary" />} label="推广二维码" to="/merchant/qrcode" />
        <Cell icon={<Users className="w-6 h-6 text-info" />} label="代理管理" to="/merchant/agents" />
        <Cell icon={<Percent className="w-6 h-6 text-warning" />} label="分成设置" to="/merchant/commission" />
        <Cell icon={<Link2 className="w-6 h-6 text-info" />} label="挂靠商家" to="/merchant/affiliations" />
        <Cell icon={<Send className="w-6 h-6 text-primary" />} label="消息群发" to="/merchant/messages" />
        <Cell icon={<ShieldCheck className="w-6 h-6 text-success" />} label="实名绑定" to="/profile/kyc" />
        <Cell icon={<Settings className="w-6 h-6 text-muted-foreground" />} label="设置" to="/profile/bind-phone" />
        <Cell icon={<LogOut className="w-6 h-6 text-destructive" />} label="退出登录" onClick={() => { void logout(); }} />
      </div>
      <div className="flex-1" />
      <MerchantBottomNav />
    </div>
  );
}

function Cell({ icon, label, to, onClick }: { icon: React.ReactNode; label: string; to?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="w-12 h-12 rounded-full bg-accent/40 flex items-center justify-center">{icon}</div>
      <span className="text-xs">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="flex flex-col items-center gap-2">
        {inner}
      </button>
    );
  }
  return (
    <Link to={to!} className="flex flex-col items-center gap-2">
      {inner}
    </Link>
  );
}
