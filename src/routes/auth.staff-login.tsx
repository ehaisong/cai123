import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Phone, Clock } from "lucide-react";

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

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [routing, setRouting] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 已登录则自动按角色路由
  useEffect(() => {
    if (!user) return;
    void routeAfterLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const normalizePhone = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/\s|-/g, "");
    if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
    if (/^1\d{10}$/.test(trimmed)) return `+86${trimmed}`;
    return null;
  };

  const sendCode = async () => {
    const p = normalizePhone(phone);
    if (!p) { toast.error("请输入有效的手机号"); return; }
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: p });
    setSending(false);
    if (error) {
      toast.error(error.message || "发送失败，请检查短信通道是否已开通");
      return;
    }
    toast.success("验证码已发送");
    setStep("code");
    setCooldown(60);
  };

  const verifyCode = async () => {
    const p = normalizePhone(phone);
    if (!p || !code) { toast.error("请输入验证码"); return; }
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({ phone: p, token: code, type: "sms" });
    setVerifying(false);
    if (error) {
      toast.error(error.message || "验证失败");
      return;
    }
    toast.success("登录成功");
    // useEffect 监听 user 变化后会自动调 routeAfterLogin
  };

  const routeAfterLogin = async () => {
    setRouting("正在为您准备工作台…");
    try {
      // 1) 尝试根据手机号白名单赋予 admin 角色（命中则继续按 admin 路由）
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
        // 确保有 merchant 角色
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
        // 极少数情况：已通过但 merchants 还没建好，仍跳商家后台
        navigate({ to: "/merchant" });
        return;
      }

      // 无申请 / 已驳回 → 去开店申请页
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
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Phone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold">手机号验证码登录</div>
            <p className="text-[11px] text-muted-foreground">未注册的手机号将自动创建账号</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">手机号</Label>
            <Input
              inputMode="tel"
              placeholder="请输入手机号"
              value={phone}
              disabled={step === "code"}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {step === "code" && (
            <div>
              <Label className="text-xs text-muted-foreground">验证码</Label>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  placeholder="6 位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <Button
                  variant="outline"
                  disabled={cooldown > 0 || sending}
                  onClick={sendCode}
                  className="whitespace-nowrap"
                >
                  {cooldown > 0 ? `${cooldown}s` : "重新发送"}
                </Button>
              </div>
            </div>
          )}

          {step === "phone" ? (
            <Button className="w-full" onClick={sendCode} disabled={sending}>
              {sending ? "发送中…" : "获取验证码"}
            </Button>
          ) : (
            <Button className="w-full" onClick={verifyCode} disabled={verifying}>
              {verifying ? "验证中…" : "登录 / 注册"}
            </Button>
          )}

          {step === "code" && (
            <button
              className="w-full text-xs text-muted-foreground"
              onClick={() => { setStep("phone"); setCode(""); }}
            >
              修改手机号
            </button>
          )}
        </div>
      </Card>

      <p className="mt-6 px-6 text-center text-xs text-muted-foreground">
        若您是通过店铺/代理推广链接进入，请使用<Link to="/auth/login" className="text-info">微信扫码登录</Link>
      </p>
    </div>
  );
}
