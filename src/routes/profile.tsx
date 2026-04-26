import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BottomNav } from "@/components/h5/bottom-nav";
import { Settings, FileText, Store, Handshake, MessageSquareWarning, HeadphonesIcon, Eye, Shield, LogOut, UserCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signInAsDemo } from "@/lib/demo-login";
import { toast } from "sonner";

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
      <div className="h5-shell flex min-h-screen flex-col items-center justify-center">
        <p className="mb-4 text-muted-foreground">请先登录</p>
        <Button onClick={() => navigate({ to: "/auth/login" })}>去登录</Button>
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

        {/* 余额卡 */}
        <div className="mt-4 rounded-xl p-4 text-white" style={{ background: "var(--gradient-orange)" }}>
          <div className="flex items-center gap-2 text-sm opacity-90">
            <span>我的余额</span>
            <button onClick={() => setHideBalance((v) => !v)}><Eye className="w-4 h-4" /></button>
          </div>
          <div className="mt-1 text-3xl font-bold">{hideBalance ? "****" : balance.toFixed(2)}</div>
        </div>

        <Button className="w-full mt-3 bg-success hover:bg-success/90 text-success-foreground" size="lg" onClick={() => navigate({ to: "/wallet" })}>
          充 值
        </Button>
      </div>

      {/* 功能格子 */}
      <div className="bg-card mx-3 rounded-2xl p-5 grid grid-cols-3 gap-y-5">
        <MenuItem icon={<FileText className="w-6 h-6 text-warning" />} label="资金明细" to="/wallet/transactions" />
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

      <div className="px-3 py-4">
        <Button variant="outline" className="w-full" onClick={async () => { await signOut(); navigate({ to: "/" }); }}>
          <LogOut className="w-4 h-4 mr-2" /> 退出登录
        </Button>
      </div>

      <div className="flex-1" />
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
