import { createFileRoute, Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { signInAsDemo, DEMO_ROLE_OPTIONS, type DemoRole } from "@/lib/demo-login";
import { Sparkles, Shield, Store, Handshake, User, MessageCircle, Phone } from "lucide-react";

const searchSchema = z.object({ ref: z.string().optional(), redirect: z.string().optional() });

export const Route = createFileRoute("/auth/login")({
  validateSearch: searchSchema,
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/auth/login" });
  const [loading, setLoading] = useState(false);
  const [demoRole, setDemoRole] = useState<DemoRole | null>(null);

  const roleIcon = (r: DemoRole) => {
    if (r === "admin") return <Shield className="w-4 h-4 text-primary" />;
    if (r === "merchant") return <Store className="w-4 h-4 text-info" />;
    if (r === "agent") return <Handshake className="w-4 h-4 text-success" />;
    return <User className="w-4 h-4 text-warning" />;
  };

  const roleHome: Record<DemoRole, string> = {
    admin: "/admin",
    merchant: "/merchant",
    agent: "/agent",
    buyer: "/",
  };

  const safeRedirect = (raw?: string): string | null => {
    if (!raw) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    return raw;
  };

  const goAfterAuth = (fallback: string) => {
    const target = safeRedirect(search.redirect);
    if (target) {
      router.history.push(target);
      return;
    }
    navigate({ to: fallback });
  };

  const handleWechatLogin = async () => {
    // 绑定推荐码：在跳走前先暂存到 localStorage，登录回来后写入
    if (search.ref) {
      try {
        localStorage.setItem("pending_referrer", search.ref);
      } catch {
        // ignore
      }
    }
    const back = safeRedirect(search.redirect) ?? "/";
    const url =
      `https://wx.lovclaw.com/oauth/wechat/start?client=66cai` +
      `&return_path=${encodeURIComponent(back)}`;
    window.location.href = url;
  };

  const handleDemo = async (role: DemoRole) => {
    setDemoRole(role);
    setLoading(true);
    try {
      await signInAsDemo(role);
      // 处理推荐码
      if (search.ref) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          await supabase.rpc("bind_referrer", { _agent_code: search.ref });
        } catch {
          // ignore
        }
      }
      toast.success("已登录 Demo 账号");
      goAfterAuth(roleHome[role]);
    } catch (e: any) {
      toast.error(e?.message ?? "Demo 登录失败");
    } finally {
      setLoading(false);
      setDemoRole(null);
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted">
      <div className="px-6 pt-16 pb-8">
        <h1 className="text-2xl font-bold text-foreground">预马当先</h1>
        <p className="mt-1 text-sm text-muted-foreground">专业数据分析内容平台</p>
      </div>

      <Card className="mx-4 p-6">
        {/* 微信登录主入口 */}
        <div className="space-y-3">
          <Button
            className="w-full bg-success hover:bg-success/90 text-success-foreground"
            size="lg"
            onClick={handleWechatLogin}
            disabled={loading}
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

        <div className="relative my-5 text-center">
          <span className="px-2 text-[11px] text-muted-foreground bg-card relative z-10">或</span>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border -z-0" />
        </div>

        {/* Demo 角色入口 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-warning" />
            <span>选择角色一键体验 Demo 账号</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ROLE_OPTIONS.map((opt) => (
              <Button
                key={opt.role}
                variant="outline"
                size="sm"
                className="h-auto py-2 flex-col items-start gap-0.5 text-left"
                disabled={loading}
                onClick={() => handleDemo(opt.role)}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {roleIcon(opt.role)}
                  {demoRole === opt.role ? "登录中…" : opt.label}
                </span>
                <span className="text-[10px] text-muted-foreground font-normal leading-tight">
                  {opt.desc}
                </span>
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* 员工登录入口 */}
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
