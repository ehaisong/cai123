import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { resolveLoginDestination } from "@/lib/route-after-login";

const searchSchema = z.object({
  ticket: z.string().optional(),
  provider: z.enum(["wechat", "phone"]).optional(),
  return_path: z.string().optional(),
});

export const Route = createFileRoute("/login/done")({
  validateSearch: searchSchema,
  ssr: false,
  component: LoginDonePage,
  head: () => ({
    meta: [{ title: "正在登录..." }, { name: "robots", content: "noindex,nofollow" }],
  }),
});

const env = import.meta.env as Record<string, string | undefined>;
const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "https://aonequdtprbhviskbvrw.supabase.co";
const SUPABASE_ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const EXCHANGE_URL = `${SUPABASE_URL}/functions/v1/wechat-exchange`;

type ExchangeResponse = {
  success?: boolean;
  provider?: string;
  tokenHash?: string;
  redirectTo?: string;
  step?: string;
  message?: string;
  errcode?: unknown;
  errmsg?: unknown;
  raw?: unknown;
};

function readTicketFromUrl() {
  if (typeof window === "undefined") return null;
  const match = window.location.href.match(/[?&]ticket=([^&#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function safeBusinessRedirect(raw?: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  const path = raw.split("?")[0];
  if (path === "/login/done" || path === "/login/iframe-bridge" || path === "/auth/login")
    return "/";
  return raw;
}

function LoginDonePage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [slow, setSlow] = useState(false);
  const ranRef = useRef(false);
  const [hint, setHint] = useState("正在完成登录，请稍候…");

  useEffect(() => {
    // 超过 12s 仍在转圈，提示用户网络较慢并提供"重试"
    const slowTimer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(slowTimer);
  }, []);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // 若意外被加载在 iframe 内（例如直接命中本页），把参数转给父页处理，避免重复交换
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      try {
        const payload: Record<string, string> = {};
        new URL(window.location.href).searchParams.forEach((v, k) => {
          payload[k] = v;
        });
        window.parent.postMessage(
          { type: "lovable-login-bridge", payload },
          window.location.origin,
        );
        return;
      } catch {
        // 同源失败则继续在本窗口处理
      }
    }

    const ticket = search.ticket ?? readTicketFromUrl();
    const provider = search.provider ?? (ticket ? "wechat" : undefined);
    let return_path = search.return_path ?? "/";
    // 微信内浏览器场景：业务回跳路径在 openWechat 时存到 sessionStorage
    if ((!search.return_path || search.return_path === "/") && typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("wechat_login_return_path");
        if (saved) {
          return_path = saved;
          sessionStorage.removeItem("wechat_login_return_path");
        }
      } catch {
        // 忽略不可用的 sessionStorage
      }
    }
    return_path = safeBusinessRedirect(return_path);

    // 中转站回跳时如果 return_path 形如 /shop/<mid>?ref=A_xxx_M_<mid>，
    // 把推广码 + 店铺 id 提前写入 localStorage，确保后续 SIGNED_IN 事件
    // 触发的 auth-context 重放能调用 bind_shop_referrer 完成"客户-代理"绑定。
    // 否则即便 return_path 在后续 resolveLoginDestination 里被替换为别的路径，
    // 推广码也已经落盘，不会丢。
    try {
      if (typeof window !== "undefined" && return_path && return_path.startsWith("/shop/")) {
        const u = new URL(return_path, window.location.origin);
        const refInPath = u.searchParams.get("ref");
        const midMatch = u.pathname.match(/^\/shop\/([0-9a-fA-F-]{36})$/);
        if (refInPath && midMatch) {
          localStorage.setItem("pending_referrer", refInPath);
          localStorage.setItem("pending_merchant_id", midMatch[1]);
        }
      }
    } catch {
      // 忽略 URL 解析失败
    }

    if (provider === "phone") setHint("正在完成短信登录，请稍候…");
    else if (provider === "wechat") setHint("微信授权成功，正在创建会话…");

    console.log("[login-done] mount", {
      hasTicket: !!ticket,
      provider,
      ticketTail: ticket?.slice(-8),
      return_path,
    });

    (async () => {
      try {
        if (!ticket) {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            console.log("[login-done] no ticket but session exists, continue routing", {
              return_path,
            });
            navigate({ to: "/auth/login", search: { tab: "customer", redirect: return_path } });
            return;
          }
          console.log("[login-done] no ticket and no session, back to login", { return_path });
          navigate({ to: "/auth/login", search: { tab: "customer", redirect: return_path } });
          return;
        }

        const res = await fetch(EXCHANGE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${SUPABASE_ANON}`,
          },
          body: JSON.stringify({ ticket, return_path, provider }),
        });

        const text = await res.text();
        let body: ExchangeResponse | null = null;
        try {
          body = text ? (JSON.parse(text) as ExchangeResponse) : null;
        } catch {
          // 非 JSON
        }

        console.log("[login-done] exchange http", {
          status: res.status,
          ok: res.ok,
          provider: body?.provider,
          keys: body && typeof body === "object" ? Object.keys(body) : null,
          rawPreview: !body ? text?.slice(0, 200) : null,
        });

        if (!res.ok || !body?.success) {
          const info: Record<string, unknown> = {
            httpStatus: res.status,
            step: body?.step ?? "exchange",
            message: body?.message ?? text?.slice(0, 200) ?? "exchange_failed",
          };
          if (body?.errcode != null) info.errcode = body.errcode;
          if (body?.errmsg) info.errmsg = body.errmsg;
          if (body?.raw) info.raw = body.raw;
          setDetail(info);
          throw new Error(String(info.message));
        }

        const tokenHash = body.tokenHash as string;
        const redirectTo = (body.redirectTo as string) ?? "/";

        const { error: vErr } = await supabase.auth.verifyOtp({
          type: "email",
          token_hash: tokenHash,
        });
        if (vErr) {
          console.error("[login-done] verifyOtp failed", vErr);
          setDetail({
            step: "verifyOtp",
            status: (vErr as { status?: number }).status ?? null,
            name: vErr.name,
            message: vErr.message,
          });
          throw new Error(`verifyOtp 失败: ${vErr.message}`);
        }

        console.log("[login-done] verifyOtp ok, resolving role…", { redirectTo });

        // 直接按角色路由，省掉 /auth/login 中转
        const tab = provider === "phone" ? "staff" : "customer";
        const dest = await resolveLoginDestination({
          tab,
          redirect: redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/",
        });
        if (dest.hard) {
          window.location.href = dest.path;
        } else {
          navigate({ to: dest.path });
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "登录失败";
        console.error("[login-done] failed", message);
        setError(message);
      }
    })();
  }, [search.ticket, search.provider, search.return_path, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-6 py-10">
        <div className="w-full max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">登录失败</h1>
          <p className="mt-2 break-all text-sm text-muted-foreground">{error}</p>
          {detail ? (
            <pre className="mt-4 max-h-60 overflow-auto rounded-md bg-background p-3 text-left text-xs text-muted-foreground">
              {JSON.stringify(detail, null, 2)}
            </pre>
          ) : null}
          <div className="mt-6 flex flex-col gap-2">
            <Link
              to="/auth/staff-login"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              返回员工登录
            </Link>
            <Link
              to="/auth/login"
              className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm"
            >
              返回微信登录
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-6 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-sm text-muted-foreground">{hint}</p>
      {slow ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">
            网络似乎较慢，可重试或返回登录页重新进入。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              重试
            </button>
            <Link
              to="/auth/login"
              className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs"
            >
              返回登录
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
