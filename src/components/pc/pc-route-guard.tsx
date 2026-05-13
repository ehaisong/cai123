import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { ShieldAlert, LogIn, Loader2 } from "lucide-react";

interface Props { children: ReactNode }

/** PC 端守卫：仅 admin 可访问，未登录跳 /pc/login，无权限提示。 */
export function PcRouteGuard({ children }: Props) {
  const { user, loading, rolesLoaded, hasRole } = useAuth();

  if (loading || (user && !rolesLoaded)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full bg-card rounded-xl p-8 text-center shadow-sm border border-border">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LogIn className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-semibold mb-1">请先登录管理后台</h2>
          <p className="text-sm text-muted-foreground mb-5">使用具备管理员权限的账号登录</p>
          <Link to="/pc/login" className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            前往登录
          </Link>
        </div>
      </div>
    );
  }

  if (!hasRole("admin")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full bg-card rounded-xl p-8 text-center shadow-sm border border-border">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-semibold mb-1">无访问权限</h2>
          <p className="text-sm text-muted-foreground mb-5">当前账号不是管理员</p>
          <Link to="/" className="inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
