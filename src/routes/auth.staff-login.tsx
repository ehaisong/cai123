import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/auth/staff-login")({
  component: StaffLoginPage,
  head: () => ({
    meta: [
      { title: "员工登录 · 预马当先" },
      { name: "description", content: "管理员、商家、代理使用手机号验证码登录的入口（即将上线）。" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function StaffLoginPage() {
  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted">
      <div className="px-6 pt-16 pb-6">
        <Link to="/auth/login" className="inline-flex items-center text-sm text-muted-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回普通登录
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-foreground">员工登录</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理员 / 商家 / 代理 专用入口</p>
      </div>

      <Card className="mx-4 p-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-foreground">手机号验证码登录</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            该入口将面向管理员、商家、代理开放，使用手机号 + 短信验证码方式登录。
          </p>
          <p className="mt-4 inline-flex items-center rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
            🚧 即将上线
          </p>
        </div>

        <div className="mt-6 space-y-2">
          <Button asChild className="w-full">
            <Link to="/auth/login">使用微信扫码登录</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">返回首页</Link>
          </Button>
        </div>
      </Card>

      <p className="mt-6 px-6 text-center text-xs text-muted-foreground">
        如需紧急登录管理员账号，可在普通登录页选择 Demo 角色入口体验。
      </p>
    </div>
  );
}
