import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useLogout } from "@/lib/use-logout";
import { BottomNav } from "@/components/h5/bottom-nav";
import { ChevronRight, UserCircle2, Sparkles, Store, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

interface Profile { user_code: string; nickname: string | null; avatar_url: string | null; phone: string | null; }

function maskPhone(p?: string | null) {
  if (!p) return "未绑定";
  const s = p.replace(/^\+?86/, "");
  if (s.length < 7) return s;
  return s.slice(0, 3) + "****" + s.slice(-4);
}

function ProfilePage() {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const logout = useLogout();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("user_code, nickname, avatar_url, phone")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [user?.id]);

  if (!user) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-full bg-accent/40 flex items-center justify-center mb-4">
            <UserCircle2 className="w-12 h-12 text-muted-foreground" />
          </div>
          <p className="mb-1 text-base font-medium text-foreground">还未登录</p>
          <p className="mb-6 text-xs text-muted-foreground">登录后查看个人信息</p>
          <Button className="w-full max-w-[240px]" size="lg" onClick={() => navigate({ to: "/auth/login" })}>
            去登录 / 注册
          </Button>
          <Button
            variant="outline"
            className="w-full max-w-[240px] mt-3"
            size="lg"
            onClick={() => navigate({ to: "/auth/login" })}
          >
            <Sparkles className="w-4 h-4 mr-2 text-warning" />
            选择角色体验 Demo
          </Button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const isMerchant = roles.includes("merchant");
  const isAdmin = roles.includes("admin");

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      {/* 顶部标题（沿用 H5 风格） */}
      <div className="px-4 pt-4 pb-3 bg-card border-b border-border">
        <h1 className="text-center text-base font-medium">个人信息</h1>
      </div>

      {/* 信息列表 */}
      <div className="bg-card divide-y divide-border">
        <RowAvatar avatar={profile?.avatar_url ?? null} />
        <Row label="昵称" value={profile?.nickname ?? "未设置"} />
        <Row label="登录号码" value={maskPhone(profile?.phone)} to="/profile/bind-phone" />
        <Row label="实名认证" to="/profile/kyc" />
        <Row label="用户服务协议" to="/terms" />
        <Row label="隐私权政策" to="/privacy" />
        <Row label="注销账号" to="/contact" />
      </div>

      {/* 后台入口（仅角色可见） */}
      {(isMerchant || isAdmin) && (
        <div className="mt-3 bg-card divide-y divide-border">
          {isMerchant && (
            <Link to="/merchant" className="flex items-center justify-between px-4 py-4 text-sm">
              <span className="flex items-center gap-2"><Store className="w-4 h-4 text-info" /> 进入商家后台</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" className="flex items-center justify-between px-4 py-4 text-sm">
              <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> 进入管理后台</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          )}
        </div>
      )}

      <div className="flex-1" />

      <div className="px-4 py-6">
        <Button
          variant="outline"
          className="w-full rounded-full border-destructive text-destructive hover:bg-destructive/5 hover:text-destructive"
          size="lg"
          onClick={() => { void logout(); }}
        >
          退出登录
        </Button>
      </div>

      <BottomNav />
    </div>
  );
}

function Row({ label, value, to }: { label: string; value?: string; to?: string }) {
  const content = (
    <div className="flex items-center justify-between px-4 py-4">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {value && <span>{value}</span>}
        {to && <ChevronRight className="w-4 h-4" />}
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function RowAvatar({ avatar }: { avatar: string | null }) {
  return (
    <Link to="/profile/bind-phone" className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-foreground">头像</span>
      <div className="flex items-center gap-1.5">
        <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center overflow-hidden">
          {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserCircle2 className="w-7 h-7 text-muted-foreground" />}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
