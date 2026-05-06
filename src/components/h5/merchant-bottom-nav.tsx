import { Link, useLocation } from "@tanstack/react-router";
import { Home, Plus, HeadphonesIcon, User } from "lucide-react";

const items = [
  { to: "/shop/me", label: "首页", icon: Home, match: (p: string) => p === "/shop/me" || p.startsWith("/shop/") },
  { to: "/merchant/products/new", label: "新建", icon: Plus, match: (p: string) => p === "/merchant/products/new" },
  { to: "/contact", label: "客服", icon: HeadphonesIcon, match: (p: string) => p === "/contact" },
  { to: "/merchant", label: "我的", icon: User, match: (p: string) => p === "/merchant" || (p.startsWith("/merchant") && p !== "/merchant/products/new") },
] as const;

export function MerchantBottomNav() {
  const loc = useLocation();
  return (
    <nav className="sticky bottom-0 inset-x-0 z-30 border-t border-border bg-card">
      <ul className="grid grid-cols-4">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(loc.pathname);
          return (
            <li key={to}>
              <Link
                to={to}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-xs ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
