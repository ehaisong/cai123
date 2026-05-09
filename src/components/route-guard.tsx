import { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogIn } from "lucide-react";

interface RouteGuardProps {
  /** 需要的角色；满足任一角色即放行（admin 自动拥有所有权限） */
  roles?: AppRole[];
  /** 头部标题（用于无权限/未登录占位页） */
  title: string;
  /** 自定义无权限提示文案 */
  forbiddenText?: string;
  children: ReactNode;
}

/**
 * 通用路由守卫：
 * - 加载中 → 占位
 * - 未登录 → 引导跳转登录页
 * - 角色不匹配 → 展示无权限提示
 */
export function RouteGuard({ roles, title, forbiddenText, children }: RouteGuardProps) {
  const { user, loading, rolesLoaded, hasRole } = useAuth();
  const navigate = useNavigate();

  // 已登录但角色尚未从数据库加载完成时，不能立刻判"无权限"，否则会出现登录后被弹回首页的现象
  if (loading || (user && !rolesLoaded)) {
    return (
      <div className="h5-shell">
        <PageHeader title={title} />
        <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h5-shell">
        <PageHeader title={title} />
        <div className="m-3 rounded-2xl bg-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LogIn className="h-7 w-7" />
          </div>
          <h2 className="text-base font-semibold mb-1">请先登录</h2>
          <p className="text-xs text-muted-foreground mb-4">登录后才能访问此页面</p>
          <Button className="w-full" onClick={() => navigate({ to: "/auth/login" })}>
            前往登录
          </Button>
        </div>
      </div>
    );
  }

  if (roles && roles.length > 0) {
    const ok = roles.some((r) => hasRole(r)) || hasRole("admin");
    if (!ok) {
      return (
        <div className="h5-shell">
          <PageHeader title={title} />
          <div className="m-3 rounded-2xl bg-card p-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h2 className="text-base font-semibold mb-1">无访问权限</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {forbiddenText ?? `当前账号没有访问「${title}」的权限`}
            </p>
            <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>
              返回首页
            </Button>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
