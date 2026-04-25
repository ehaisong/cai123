import { Link, useLocation } from "@tanstack/react-router";
import { Home, MessageSquare, ClipboardList, User } from "lucide-react";

const items = [
  { to: "/", label: "主页", icon: Home },
  { to: "/messages", label: "消息", icon: MessageSquare },
  { to: "/orders", label: "订单", icon: ClipboardList },
  { to: "/profile", label: "我的", icon: User },
] as const;

export function BottomNav() {
  const loc = useLocation();
  return (
    <nav className="sticky bottom-0 inset-x-0 z-30 border-t border-border bg-card">
      <ul className="grid grid-cols-4">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to);
          return (
            <li key={to}>
              <Link
                to={to}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs ${
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
