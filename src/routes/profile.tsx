import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BottomNav } from "@/components/h5/bottom-nav";
import { Settings, FileText, Store, Handshake, MessageSquareWarning, HeadphonesIcon, Eye, Shield, LogOut, UserCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

interface Profile { user_code: string; nickname: string | null; avatar_url: string | null; }

function ProfilePage() {
  const { user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState(0);
  const [hideBalance, setHideBalance] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("user_code, nickname, avatar_url").eq("user_id", user.id).maybeSingle().then(({ data }) => setProfile(data));
    supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle().then(({ data }) => setBalance(Number(data?.balance ?? 0)));
  }, [user?.id]);

  if (!user) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-full bg-accent/40 flex items-center justify-center mb-4">
            <UserCircle2 className="w-12 h-12 text-muted-foreground" />
          </div>
          <p className="mb-1 text-base font-medium text-foreground">还未登录</p>
          <p className="mb-6 text-xs text-muted-foreground">登录后查看余额、订单与代理收益</p>
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            登录页提供：商城管理 / 商家 / 代理 / 普通用户
          </p>
        </div>
        <BottomNav />
      </div>
    );
  }

  const isMerchant = roles.includes("merchant");
  const isAdmin = roles.includes("admin");
  const isAgent = roles.includes("agent");

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      {/* 用户卡片 */}
      <div className="bg-card m-3 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-accent flex items-center justify-center text-2xl">
            {profile?.avatar_url ? <img src={profile.avatar_url} className="w-full h-full rounded-full object-cover" /> : "👤"}
          </div>
          <div className="flex-1">
            <div className="font-bold text-lg">{profile?.nickname ?? "用户"}</div>
            <div className="mt-1 inline-flex items-center gap-1 text-xs">
              <span className="bg-info/10 text-info px-1.5 py-0.5 rounded text-[10px]">ID</span>
              <span className="text-muted-foreground">{profile?.user_code}</span>
            </div>
          </div>
          <Settings className="w-5 h-5 text-muted-foreground" />
        </div>

        {/* 余额卡 - 仅代理/商家可见 */}
        {(isAgent || isMerchant) && (
          <>
            <div className="mt-4 rounded-xl p-4 text-white" style={{ background: "var(--gradient-orange)" }}>
              <div className="flex items-center gap-2 text-sm opacity-90">
                <span>我的余额</span>
                <button onClick={() => setHideBalance((v) => !v)}><Eye className="w-4 h-4" /></button>
              </div>
              <div className="mt-1 text-3xl font-bold">{hideBalance ? "****" : balance.toFixed(2)}</div>
            </div>

            <Button className="w-full mt-3 bg-success hover:bg-success/90 text-success-foreground" size="lg" onClick={() => navigate({ to: "/wallet" })}>
              提 现
            </Button>
          </>
        )}
      </div>

      {/* 功能格子 */}
      <div className="bg-card mx-3 rounded-2xl p-5 grid grid-cols-3 gap-y-5">
        {(isAgent || isMerchant) && (
          <MenuItem icon={<FileText className="w-6 h-6 text-warning" />} label="资金明细" to="/wallet/transactions" />
        )}
        <MenuItem icon={<Store className="w-6 h-6 text-info" />} label="申请商家" to="/merchant/apply" />
        <MenuItem icon={<Shield className="w-6 h-6 text-primary" />} label="隐私协议" to="/privacy" />
        <MenuItem icon={<Handshake className="w-6 h-6 text-success" />} label="代理推广" to="/agent" />
        <MenuItem icon={<MessageSquareWarning className="w-6 h-6 text-warning" />} label="反馈建议" to="/feedback" />
        <MenuItem icon={<HeadphonesIcon className="w-6 h-6 text-info" />} label="联系客服" to="/contact" />
      </div>

      {/* 后台入口 */}
      {(isMerchant || isAdmin) && (
        <div className="mx-3 mt-3 rounded-2xl bg-card p-4 space-y-2">
          {isMerchant && (
            <Link to="/merchant" className="flex items-center justify-between text-sm py-2">
              <span className="flex items-center gap-2"><Store className="w-4 h-4 text-info" /> 进入商家后台</span>
              <span className="text-muted-foreground">›</span>
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" className="flex items-center justify-between text-sm py-2">
              <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> 进入管理后台</span>
              <span className="text-muted-foreground">›</span>
            </Link>
          )}
        </div>
      )}

      <div className="flex-1" />

      <div className="px-3 py-4">
        <Button variant="outline" className="w-full" onClick={async () => { await signOut(); navigate({ to: "/" }); }}>
          <LogOut className="w-4 h-4 mr-2" /> 退出登录
        </Button>
      </div>

      <BottomNav />
    </div>
  );
}

function MenuItem({ icon, label, to }: { icon: React.ReactNode; label: string; to: string }) {
  return (
    <Link to={to} className="flex flex-col items-center gap-2">
      <div className="w-12 h-12 rounded-full bg-accent/40 flex items-center justify-center">{icon}</div>
      <span className="text-xs text-foreground">{label}</span>
    </Link>
  );
}
