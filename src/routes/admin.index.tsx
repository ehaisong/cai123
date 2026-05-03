import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useLogout } from "@/lib/use-logout";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import {
  Store,
  Users,
  UserCog,
  Wallet,
  Megaphone,
  Settings,
  CreditCard,
  KeyRound,
  Percent,
  ShieldCheck,
  PlusCircle,
  ClipboardList,
  LogOut,
  ShoppingCart,
  TrendingUp,
  QrCode,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <RouteGuard title="管理后台" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <AdminHomeInner />
    </RouteGuard>
  );
}

type Card = {
  to: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  color: string;
};

const groups: Array<{ label: string; items: Card[] }> = [
  {
    label: "审核中心",
    items: [
      { to: "/admin/applications", title: "商家审核", desc: "审核入驻申请", icon: ShieldCheck, color: "bg-amber-500/10 text-amber-600" },
      { to: "/admin/merchant-recruit", title: "商家招募码", desc: "分享开店申请二维码", icon: QrCode, color: "bg-indigo-500/10 text-indigo-600" },
      { to: "/admin/withdrawals", title: "提现审批", desc: "审核打款申请", icon: Wallet, color: "bg-emerald-500/10 text-emerald-600" },
    ],
  },
  {
    label: "对象管理",
    items: [
      { to: "/admin/merchants", title: "商家管理", desc: "查看/禁用店铺", icon: Store, color: "bg-orange-500/10 text-orange-600" },
      { to: "/admin/agents", title: "代理管理", desc: "代理列表与归属", icon: UserCog, color: "bg-green-500/10 text-green-600" },
      { to: "/admin/users", title: "用户管理", desc: "用户列表与禁用", icon: Users, color: "bg-blue-500/10 text-blue-600" },
      { to: "/admin/orders", title: "订单总览", desc: "全平台订单查询", icon: ClipboardList, color: "bg-cyan-500/10 text-cyan-600" },
    ],
  },
  {
    label: "财务",
    items: [
      { to: "/admin/recharge", title: "手动充值", desc: "为用户钱包充值", icon: PlusCircle, color: "bg-pink-500/10 text-pink-600" },
      { to: "/admin/commission", title: "分成配置", desc: "设置代理与平台分成", icon: Percent, color: "bg-purple-500/10 text-purple-600" },
    ],
  },
  {
    label: "商城设置",
    items: [
      { to: "/admin/settings", title: "通用设置", desc: "默认店铺/钱包购买", icon: Settings, color: "bg-slate-500/10 text-slate-600" },
      { to: "/admin/payment", title: "支付通道", desc: "多通道录入与启停管理", icon: CreditCard, color: "bg-rose-500/10 text-rose-600" },
      { to: "/admin/wechat", title: "微信登录", desc: "开放平台 AppID/Secret", icon: KeyRound, color: "bg-teal-500/10 text-teal-600" },
      { to: "/admin/announcements", title: "公告管理", desc: "发布全站公告", icon: Megaphone, color: "bg-yellow-500/10 text-yellow-600" },
    ],
  },
];

type Stats = {
  merchants: number;
  users: number;
  todayOrders: number;
  todayAmount: number;
};

function AdminHomeInner() {
  const navigate = useNavigate();
  const logout = useLogout();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const iso = startOfDay.toISOString();

        const [mc, uc, oc, oa] = await Promise.all([
          supabase.from("merchants").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .gte("created_at", iso),
          supabase
            .from("orders")
            .select("amount")
            .eq("status", "paid")
            .gte("paid_at", iso),
        ]);

        const todayAmount = (oa.data ?? []).reduce(
          (sum, r: { amount: number | string | null }) => sum + Number(r.amount ?? 0),
          0,
        );

        if (!cancel) {
          setStats({
            merchants: mc.count ?? 0,
            users: uc.count ?? 0,
            todayOrders: oc.count ?? 0,
            todayAmount,
          });
        }
      } catch (e) {
        console.error("[admin stats]", e);
      } finally {
        if (!cancel) setLoadingStats(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("已退出登录");
      navigate({ to: "/auth/staff-login" });
    } catch (e) {
      toast.error("退出失败，请重试");
    }
  };

  const statCards: Array<{
    label: string;
    value: string;
    icon: LucideIcon;
    color: string;
  }> = [
    {
      label: "商家总数",
      value: stats ? String(stats.merchants) : "—",
      icon: Store,
      color: "bg-orange-500/10 text-orange-600",
    },
    {
      label: "用户总数",
      value: stats ? String(stats.users) : "—",
      icon: Users,
      color: "bg-blue-500/10 text-blue-600",
    },
    {
      label: "今日订单",
      value: stats ? String(stats.todayOrders) : "—",
      icon: ShoppingCart,
      color: "bg-cyan-500/10 text-cyan-600",
    },
    {
      label: "今日成交",
      value: stats ? fmtMoney(stats.todayAmount) : "—",
      icon: TrendingUp,
      color: "bg-emerald-500/10 text-emerald-600",
    },
  ];

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader
        title="管理后台"
        showBack={false}
        right={
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-0.5 text-info"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
            <span className="text-sm">退出</span>
          </button>
        }
      />
      <main className="flex-1 px-3 py-3 space-y-4 pb-6">
        <section>
          <div className="grid grid-cols-2 gap-2">
            {statCards.map((s) => (
              <div key={s.label} className="bg-card rounded-xl p-3 flex items-center gap-3">
                <div className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground truncate">{s.label}</div>
                  <div className="text-lg font-semibold truncate">
                    {loadingStats ? "…" : s.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="text-xs font-medium text-muted-foreground mb-2 px-1">{g.label}</h2>
            <div className="grid grid-cols-2 gap-2">
              {g.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  className="bg-card rounded-xl p-3 flex items-start gap-2 hover:bg-accent transition-colors"
                >
                  <div className={`shrink-0 h-9 w-9 rounded-lg flex items-center justify-center ${it.color}`}>
                    <it.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{it.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{it.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <div className="pt-2">
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            退出登录
          </Button>
        </div>
      </main>
    </div>
  );
}
