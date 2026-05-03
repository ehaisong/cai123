import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Smartphone, Clock } from "lucide-react";

const HUB_PHONE_START = "https://wx.lovclaw.com/oauth/phone/start";
const HUB_CLIENT = "66cai";

export const Route = createFileRoute("/auth/staff-login")({
  component: StaffLoginPage,
  head: () => ({
    meta: [
      { title: "员工登录 · 预马当先" },
      { name: "description", content: "管理员、商家、代理使用手机号验证码登录的入口。" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function StaffLoginPage() {
  const { user, refreshRoles } = useAuth();
  const navigate = useNavigate();

  const [routing, setRouting] = useState<string | null>(null);

  // 已登录则自动按角色路由
  useEffect(() => {
    if (!user) return;
    void routeAfterLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const goHubPhoneLogin = () => {
    const ret = "/auth/staff-login";
    window.location.href =
      `${HUB_PHONE_START}?client=${encodeURIComponent(HUB_CLIENT)}` +
      `&return_path=${encodeURIComponent(ret)}`;
  };

  const routeAfterLogin = async () => {
    setRouting("正在为您准备工作台…");
    try {
      // 1) 尝试根据手机号白名单赋予 admin 角色
      try {
        await supabase.rpc("bootstrap_admin_role");
        await refreshRoles();
      } catch {
        // ignore
      }

      // 2) 拉最新角色
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) { setRouting(null); return; }
      const { data: rolesRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const roles = (rolesRows ?? []).map((r) => r.role as string);

      if (roles.includes("admin")) {
        navigate({ to: "/admin" });
        return;
      }

      // 3) 已通过审核的商家
      const { data: merchant } = await supabase
        .from("merchants")
        .select("id, status")
        .eq("user_id", uid)
        .maybeSingle();
      if (merchant && merchant.status === "approved") {
        if (!roles.includes("merchant")) {
          await supabase.from("user_roles").insert({ user_id: uid, role: "merchant" });
          await refreshRoles();
        }
        navigate({ to: "/merchant" });
        return;
      }

      if (roles.includes("merchant")) {
        navigate({ to: "/merchant" });
        return;
      }
      if (roles.includes("agent")) {
        navigate({ to: "/agent" });
        return;
      }

      // 4) 普通用户：检查是否已提交开店申请
      const { data: app } = await supabase
        .from("merchant_applications")
        .select("id, status, shop_name, reject_reason")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (app?.status === "pending") {
        setRouting("pending");
        return;
      }
      if (app?.status === "approved") {
        navigate({ to: "/merchant" });
        return;
      }

      navigate({ to: "/apply" });
    } finally {
      // 不重置 routing，避免界面闪烁
    }
  };

  // 已登录但还未路由完成 / 或显示「审核中」
  if (user && routing) {
    if (routing === "pending") {
      return (
        <div className="h5-shell flex min-h-screen flex-col bg-muted">
          <div className="px-6 pt-16 pb-6">
            <h1 className="text-2xl font-bold text-foreground">员工登录</h1>
          </div>
          <Card className="mx-4 p-6 text-center space-y-3 bg-warning/5 border-warning/30">
            <div className="inline-flex w-14 h-14 rounded-full bg-warning/15 items-center justify-center mx-auto">
              <Clock className="w-7 h-7 text-warning" />
            </div>
            <h2 className="text-lg font-bold">开店申请审核中</h2>
            <p className="text-sm text-muted-foreground">
              您的开店申请正在等待管理员审核，请稍后再回来查看。
            </p>
            <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/apply" })}>
              查看申请详情
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }}
            >
              退出登录
            </Button>
          </Card>
        </div>
      );
    }
    return (
      <div className="h5-shell flex min-h-screen flex-col items-center justify-center">
        <p className="text-sm text-muted-foreground">{routing}</p>
      </div>
    );
  }

  if (user) return null;

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted">
      <div className="px-6 pt-16 pb-6">
        <Link to="/auth/login" className="inline-flex items-center text-sm text-muted-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回微信登录
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-foreground">员工登录</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理员 / 商家 / 代理 专用入口</p>
      </div>

      <Card className="mx-4 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold">手机号短信验证码登录</div>
            <p className="text-[11px] text-muted-foreground">未注册的手机号将自动创建账号</p>
          </div>
        </div>
        <Button className="w-full" onClick={goHubPhoneLogin}>
          使用手机号登录
        </Button>
        <p className="mt-3 text-[11px] text-muted-foreground text-center">
          点击后将跳转至「登录中心」完成短信验证
        </p>
      </Card>

      <p className="mt-6 px-6 text-center text-xs text-muted-foreground">
        若您是通过店铺/代理推广链接进入，请使用
        <Link to="/auth/login" className="text-info">微信扫码登录</Link>
      </p>
    </div>
  );
}
