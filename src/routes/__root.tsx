import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { PaymentService } from "@/lib/payment-service";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">页面不存在</h2>
        <p className="mt-2 text-sm text-muted-foreground">您访问的页面不存在或已被移除。</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { title: "预马当先" },
      { name: "description", content: "专业的数据分析内容平台，专业分析师入驻发布优质内容" },
      { name: "theme-color", content: "#e85d2e" },
      { property: "og:title", content: "预马当先" },
      { name: "twitter:title", content: "预马当先" },
      { property: "og:description", content: "专业的数据分析内容平台，专业分析师入驻发布优质内容" },
      { name: "twitter:description", content: "专业的数据分析内容平台，专业分析师入驻发布优质内容" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/86f95e8d-791a-4b9c-bb7e-c8c259264345/id-preview-a43965ee--898f4f0d-897f-437c-94c0-77d9f030fbc2.lovable.app-1777170660633.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/86f95e8d-791a-4b9c-bb7e-c8c259264345/id-preview-a43965ee--898f4f0d-897f-437c-94c0-77d9f030fbc2.lovable.app-1777170660633.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  useEffect(() => {
    void PaymentService.resumeFromWxOAuthIfAny();
    PaymentService.checkPendingAlipay();
  }, []);
  return (
    <AuthProvider>
      <Outlet />
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}
