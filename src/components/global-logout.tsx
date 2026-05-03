import { useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLogout } from "@/lib/use-logout";

// Routes where we don't need an extra floating logout button
// (auth flow pages, or pages that already render their own 退出登录 button)
const HIDE_ON_PREFIX = ["/auth", "/login"];
const HIDE_EXACT = new Set<string>([
  "/profile", // 个人中心已自带退出登录
  "/admin",   // 管理后台首页已自带退出登录
]);

export function GlobalLogout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!user) return null;
  if (HIDE_ON_PREFIX.some((p) => pathname.startsWith(p))) return null;
  if (HIDE_EXACT.has(pathname)) return null;

  const handle = async () => {
    try {
      await signOut();
      toast.success("已退出登录");
      navigate({ to: "/auth/staff-login" });
    } catch {
      toast.error("退出失败，请重试");
    }
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label="退出登录"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full bg-card/95 px-3 py-2 text-xs text-foreground shadow-lg ring-1 ring-border backdrop-blur hover:bg-card"
    >
      <LogOut className="h-3.5 w-3.5" />
      退出登录
    </button>
  );
}
