import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageCircle, Phone } from "lucide-react";

const searchSchema = z.object({ ref: z.string().optional(), redirect: z.string().optional() });

export const Route = createFileRoute("/auth/login")({
  validateSearch: searchSchema,
  component: LoginPage,
});

function LoginPage() {
  const search = useSearch({ from: "/auth/login" });

  const safeRedirect = (raw?: string): string | null => {
    if (!raw) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    return raw;
  };

  const handleWechatLogin = () => {
    if (search.ref) {
      try {
        localStorage.setItem("pending_referrer", search.ref);
      } catch {
        // ignore
      }
    }
    const back = safeRedirect(search.redirect) ?? (search.ref ? `/?ref=${encodeURIComponent(search.ref)}` : "/");
    const url =
      `https://wx.lovclaw.com/oauth/wechat/start?client=66cai` +
      `&return_path=${encodeURIComponent(back)}`;
    window.location.href = url;
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted">
      <div className="px-6 pt-16 pb-8">
        <h1 className="text-2xl font-bold text-foreground">预马当先</h1>
        <p className="mt-1 text-sm text-muted-foreground">专业数据分析内容平台</p>
      </div>

      <Card className="mx-4 p-6">
        <div className="space-y-3">
          <Button
            className="w-full bg-success hover:bg-success/90 text-success-foreground"
            size="lg"
            onClick={handleWechatLogin}
          >
            <MessageCircle className="w-5 h-5 mr-2" />
            使用微信扫码登录
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            点击后将跳转至微信授权页，完成扫码即可登录或注册
          </p>
          {search.ref && (
            <p className="text-center text-xs text-info">
              将关联推荐人/店铺：{search.ref}
            </p>
          )}
        </div>
      </Card>

      <div className="px-4 pt-4">
        <Link
          to="/auth/staff-login"
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Phone className="w-3.5 h-3.5" />
          员工登录入口（管理员 / 商家 / 代理）
        </Link>
      </div>

      <div className="flex-1" />

      <p className="px-6 pb-6 text-center text-xs text-muted-foreground">
        <Link to="/" className="text-info">返回首页</Link>
      </p>
    </div>
  );
}
