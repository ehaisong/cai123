import { ReactNode, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, CreditCard, LogOut,
  ShoppingCart, Coins, Wallet, ChevronDown, ChevronRight,
  Store, UserCog, User as UserIcon, Receipt,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; icon: any; exact?: boolean };
type Group = { key: string; label: string; icon: any; children: Item[] };
type Entry = Item | Group;

const NAV: Entry[] = [
  { to: "/pc", label: "概览", icon: LayoutDashboard, exact: true },
  {
    key: "users", label: "用户管理", icon: Users, children: [
      { to: "/pc/users", label: "商家", icon: Store },
      { to: "/pc/agents", label: "代理", icon: UserCog },
      { to: "/pc/customers", label: "客户", icon: UserIcon },
    ],
  },
  {
    key: "trade", label: "交易管理", icon: Receipt, children: [
      { to: "/pc/orders", label: "订单", icon: ShoppingCart },
      { to: "/pc/commissions", label: "返佣记录", icon: Coins },
      { to: "/pc/wallet-transactions", label: "钱包流水", icon: Wallet },
    ],
  },
  { to: "/pc/payments", label: "支付通道", icon: CreditCard },
];

function isGroup(e: Entry): e is Group {
  return (e as Group).children !== undefined;
}

export function PcShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  // 默认展开当前分组
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    NAV.forEach((e) => {
      if (isGroup(e)) o[e.key] = e.children.some((c) => isActive(c.to));
    });
    // 默认展开"用户管理"和"交易管理"
    o["users"] = o["users"] ?? true;
    o["trade"] = o["trade"] ?? true;
    return o;
  });

  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="w-56 shrink-0 bg-card border-r border-border flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-border">
          <span className="text-base font-semibold tracking-wide">66 PC 后台</span>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((e) => {
            if (!isGroup(e)) {
              const active = isActive(e.to, e.exact);
              const Icon = e.icon;
              return (
                <Link
                  key={e.to}
                  to={e.to}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {e.label}
                </Link>
              );
            }
            const Icon = e.icon;
            const expanded = open[e.key];
            const groupActive = e.children.some((c) => isActive(c.to));
            return (
              <div key={e.key}>
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [e.key]: !s[e.key] }))}
                  className={cn(
                    "w-full flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                    groupActive ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {e.label}
                  </span>
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                {expanded && (
                  <div className="mt-1 ml-3 pl-3 border-l border-border space-y-1">
                    {e.children.map((c) => {
                      const active = isActive(c.to);
                      const CIcon = c.icon;
                      return (
                        <Link
                          key={c.to}
                          to={c.to}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                            active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <CIcon className="h-3.5 w-3.5" />
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          <div className="px-3 text-xs text-muted-foreground truncate">{user?.phone ?? user?.email ?? "管理员"}</div>
          <button
            onClick={async () => { await signOut(); navigate({ to: "/pc/login" }); }}
            className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="p-6 max-w-[1600px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

export function PcPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
