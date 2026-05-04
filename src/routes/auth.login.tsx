import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";
import heroImage from "@/assets/login-hero.jpg";

const searchSchema = z.object({
  ref: z.string().optional(),
  redirect: z.string().optional(),
  tab: z.enum(["customer", "staff"]).optional(),
});

export const Route = createFileRoute("/auth/login")({
  validateSearch: searchSchema,
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "登录 · 预马当先" },
      { name: "description", content: "客户微信扫码登录 / 商家手机号登录入口" },
    ],
  }),
});

const HUB_BASE = "https://wx.lovclaw.com";
const HUB_CLIENT = "66cai";

type TabKey = "customer" | "staff";

function LoginPage() {
  const search = useSearch({ from: "/auth/login" });
  const { user, refreshRoles } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>(search.tab ?? "customer");
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const requireAgree = (next: () => void) => {
    if (!agreed) {
      toast.error("请先阅读并同意《用户服务协议》和《隐私权政策》");
      return;
    }
    next();
  };

  // 已登录时自动按角色路由
  useEffect(() => {
    if (!user) return;
    void routeAfterLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const safeRedirect = (raw?: string): string | null => {
    if (!raw) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    return raw;
  };

  // 监听 iframe 桥接消息
  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data: any = ev.data;
      if (!data || data.type !== "lovable-login-bridge") return;
      const payload = data.payload as Record<string, string>;
      const ticket = payload?.ticket;
      const provider = payload?.provider;
      // 关闭 iframe
      setIframeUrl(null);
      if (!ticket) return;
      const back = safeRedirect(search.redirect) ?? (search.ref ? `/?ref=${encodeURIComponent(search.ref)}` : "/");
      // 跳到本站 /login/done 完成 ticket 交换
      navigate({
        to: "/login/done",
        search: { ticket, provider: (provider as "wechat" | "phone") ?? undefined, return_path: back },
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate, search.redirect, search.ref]);

  const openWechat = () => {
    if (search.ref) {
      try { localStorage.setItem("pending_referrer", search.ref); } catch {}
    }
    const returnPath = "/login/iframe-bridge";
    const url = `${HUB_BASE}/oauth/wechat/start?client=${HUB_CLIENT}&return_path=${encodeURIComponent(returnPath)}`;
    setIframeUrl(url);
  };

  const openPhone = () => {
    const returnPath = "/login/iframe-bridge";
    const url = `${HUB_BASE}/oauth/phone/start?client=${encodeURIComponent(HUB_CLIENT)}&return_path=${encodeURIComponent(returnPath)}`;
    setIframeUrl(url);
  };

  // 登录后角色优先级路由：admin > agent > merchant > 普通用户
  const routeAfterLogin = async () => {
    setRouting(true);
    try {
      try { await supabase.rpc("bootstrap_admin_role"); await refreshRoles(); } catch {}
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;

      const { data: rolesRows } = await supabase
        .from("user_roles").select("role").eq("user_id", uid);
      const roles = (rolesRows ?? []).map(r => r.role as string);

      if (roles.includes("admin")) { navigate({ to: "/admin" }); return; }
      if (roles.includes("agent")) { navigate({ to: "/agent" }); return; }

      const { data: merchant } = await supabase
        .from("merchants").select("id, status").eq("user_id", uid).maybeSingle();
      if (merchant?.status === "approved") {
        if (!roles.includes("merchant")) {
          await supabase.from("user_roles").insert({ user_id: uid, role: "merchant" });
          await refreshRoles();
        }
        navigate({ to: "/merchant" });
        return;
      }
      if (roles.includes("merchant")) { navigate({ to: "/merchant" }); return; }

      // 普通用户：客户 Tab 走首页（含 ref 解析），商家 Tab 检查申请状态
      if (tab === "staff") {
        const { data: app } = await supabase
          .from("merchant_applications")
          .select("status").eq("user_id", uid)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (app?.status === "pending") { navigate({ to: "/apply" }); return; }
        if (app?.status === "approved") { navigate({ to: "/merchant" }); return; }
        navigate({ to: "/apply" });
        return;
      }

      const back = safeRedirect(search.redirect)
        ?? (search.ref ? `/?ref=${encodeURIComponent(search.ref)}` : "/");
      window.location.href = back;
    } finally {
      setRouting(false);
    }
  };

  return (
    <div className="h5-shell relative flex min-h-screen flex-col bg-background">
      {/* 顶部插画 */}
      <div className="relative h-[36vh] min-h-[220px] max-h-[340px] w-full overflow-hidden">
        <img
          src={heroImage}
          alt="预马当先"
          className="h-full w-full object-cover"
          width={1024}
          height={768}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-background" />
      </div>

      {/* 登录卡片 */}
      <div className="relative -mt-8 flex-1 px-6">
        <div className="mx-auto w-full max-w-sm">
          {/* Tab */}
          <div className="flex items-center justify-center gap-12">
            <TabButton active={tab === "customer"} onClick={() => { setTab("customer"); setIframeUrl(null); }}>
              客户登录
            </TabButton>
            <TabButton active={tab === "staff"} onClick={() => { setTab("staff"); setIframeUrl(null); }}>
              商家登录
            </TabButton>
          </div>

          {/* 副标题 */}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {tab === "customer" ? "微信扫码 · 一键登录" : "管理员 / 商家 / 代理 · 手机验证码"}
          </p>

          {/* 内容区 */}
          <div className="mt-10">
            {iframeUrl ? (
              <IframeCard url={iframeUrl} onClose={() => setIframeUrl(null)} />
            ) : tab === "customer" ? (
              <CustomerPanel onLogin={() => requireAgree(openWechat)} ref_={search.ref} />
            ) : (
              <StaffPanel onLogin={() => requireAgree(openPhone)} />
            )}
          </div>

          {/* 同意协议 */}
          {!iframeUrl && (
            <div className="mt-8 flex items-start justify-center gap-2 px-2">
              <button
                type="button"
                onClick={() => setAgreed((v) => !v)}
                aria-pressed={agreed}
                aria-label="同意用户协议和隐私政策"
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  agreed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40 bg-background",
                )}
              >
                {agreed && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <p className="text-[11px] leading-5 text-muted-foreground">
                阅读并同意
                <Link to="/terms" className="mx-0.5 text-info">《用户服务协议》</Link>
                和
                <Link to="/privacy" className="mx-0.5 text-info">《隐私权政策》</Link>
              </p>
            </div>
          )}

          {/* 切换提示 */}
          <div className="pb-8" />
        </div>
      </div>

      {routing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">正在为您准备工作台…</p>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative pb-2 text-base font-semibold transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {children}
      <span
        className={cn(
          "absolute -bottom-0.5 left-1/2 h-0.5 -translate-x-1/2 rounded-full bg-primary transition-all",
          active ? "w-8" : "w-0",
        )}
      />
    </button>
  );
}

function CustomerPanel({ onLogin, ref_ }: { onLogin: () => void; ref_?: string }) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onLogin}
        className="w-full rounded-full bg-success py-3.5 text-sm font-semibold text-success-foreground shadow-md transition-transform active:scale-[0.98]"
      >
        微信扫码登录
      </button>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        点击后将弹出微信授权窗口，扫码即可登录
      </p>
      {ref_ && (
        <p className="text-center text-xs text-info">将关联推荐人/店铺：{ref_}</p>
      )}
    </div>
  );
}

function StaffPanel({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onLogin}
        className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-md transition-transform active:scale-[0.98]"
      >
        手机号验证码登录
      </button>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        未注册的手机号将自动创建账号
      </p>
    </div>
  );
}

function IframeCard({ url, onClose }: { url: string; onClose: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <span className="text-xs text-muted-foreground">安全登录窗口</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <iframe
        ref={ref}
        src={url}
        title="登录"
        className="block h-[480px] w-full border-0 bg-background"
        // 允许跳转 + 表单 + 同源回跳本站
        sandbox="allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation allow-popups"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
