import { ReactNode } from "react";
import { ChevronLeft, Home } from "lucide-react";
import { useRouter, useNavigate } from "@tanstack/react-router";
import { canGoBackInApp, consumeBack } from "@/lib/nav-history";

interface PageHeaderProps {
  title: string;
  showBack?: boolean;
  /** 没有站内可回退历史时的兜底跳转地址，默认 "/" */
  fallback?: string;
  /** 是否在标题右侧显示"主页"快捷按钮（默认 true）。
   *  作用：当微信拦截 history.back() 时，用户可以始终一键回到本站首页，避免被卡死。 */
  showHome?: boolean;
  /** 主页按钮的目标地址，默认 "/" */
  homeTo?: string;
  right?: ReactNode;
}

export function PageHeader({
  title,
  showBack = true,
  fallback = "/",
  showHome = true,
  homeTo = "/",
  right,
}: PageHeaderProps) {
  const router = useRouter();
  const navigate = useNavigate();

  const handleBack = () => {
    // 站内有可回退历史 → 走浏览器后退，保留 SPA 体验
    // 否则（外站直链/扫码进入）→ 直接 navigate 到本站页面，避免微信拦截
    if (canGoBackInApp()) {
      consumeBack();
      router.history.back();
    } else {
      navigate({ to: fallback });
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex w-20 items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-0.5 text-info"
            aria-label="返回"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="text-sm">返回</span>
          </button>
        )}
      </div>
      <h1 className="flex-1 text-center text-base font-medium tracking-wide truncate">{title}</h1>
      <div className="flex w-20 items-center justify-end gap-2">
        {right}
        {showHome && (
          <button
            type="button"
            onClick={() => navigate({ to: homeTo })}
            className="text-muted-foreground hover:text-foreground"
            aria-label="主页"
            title="主页"
          >
            <Home className="h-5 w-5" />
          </button>
        )}
      </div>
    </header>
  );
}
