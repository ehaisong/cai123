import { Link, useLocation } from "@tanstack/react-router";
import { Home, MessageSquare, ClipboardList, User } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

const items = [
  { to: "/", label: "主页", icon: Home, key: "home" },
  { to: "/messages", label: "消息", icon: MessageSquare, key: "messages" },
  { to: "/orders", label: "订单", icon: ClipboardList, key: "orders" },
  { to: "/profile", label: "我的", icon: User, key: "profile" },
] as const;

export function BottomNav() {
  const loc = useLocation();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) { setUnread(0); return; }
    let active = true;
    const fetchCount = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (active) setUnread(count ?? 0);
    };
    fetchCount();

    const channel = supabase
      .channel(`notif-badge-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => fetchCount(),
      )
      .subscribe();

    // 路由切换或定时也刷新
    const t = setInterval(fetchCount, 30_000);
    return () => { active = false; clearInterval(t); supabase.removeChannel(channel); };
  }, [user, loc.pathname]);

  return (
    <nav className="sticky bottom-0 inset-x-0 z-30 border-t border-border bg-card">
      <ul className="grid grid-cols-4">
        {items.map(({ to, label, icon: Icon, key }) => {
          const active = to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(to);
          const badge = key === "messages" && unread > 0 ? unread : 0;
          return (
            <li key={to}>
              <Link
                to={to}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-xs ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-white text-[10px] flex items-center justify-center font-medium">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
