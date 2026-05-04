import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const searchSchema = z.object({
  ticket: z.string().optional(),
  provider: z.enum(["wechat", "phone"]).optional(),
  return_path: z.string().optional(),
});

export const Route = createFileRoute("/login/done")({
  validateSearch: searchSchema,
  ssr: false,
  component: LoginDonePage,
  head: () => ({ meta: [{ title: "正在登录..." }, { name: "robots", content: "noindex,nofollow" }] }),
});

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ??
  "https://aonequdtprbhviskbvrw.supabase.co";
const SUPABASE_ANON =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const EXCHANGE_URL = `${SUPABASE_URL}/functions/v1/wechat-exchange`;

function LoginDonePage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const ranRef = useRef(false);
  const [hint, setHint] = useState("正在完成登录，请稍候…");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // 若意外被加载在 iframe 内（例如直接命中本页），把参数转给父页处理，避免重复交换
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      try {
        const payload: Record<string, string> = {};
        new URL(window.location.href).searchParams.forEach((v, k) => { payload[k] = v; });
        window.parent.postMessage({ type: "lovable-login-bridge", payload }, window.location.origin);
        return;
      } catch {
        // 同源失败则继续在本窗口处理
      }
    }

    const ticket = search.ticket;
    const provider = search.provider;
    const return_path = search.return_path ?? "/";

    if (provider === "phone") setHint("正在完成短信登录，请稍候…");
    else if (provider === "wechat") setHint("正在完成微信登录，请稍候…");

    console.log("[login-done] mount", {
      hasTicket: !!ticket,
      provider,
      ticketTail: ticket?.slice(-8),
      return_path,
    });

    if (!ticket) {
      setError("缺少 ticket 参数");
      return;
    }

    (async () => {
      try {
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
        let body: any = null;
        try {
          body = text ? JSON.parse(text) : null;
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
            status: (vErr as any).status ?? null,
            name: vErr.name,
            message: vErr.message,
          });
          throw new Error(`verifyOtp 失败: ${vErr.message}`);
        }

        console.log("[login-done] verifyOtp ok, redirect", { redirectTo });

        const target =
          redirectTo.startsWith("/") && !redirectTo.startsWith("//")
            ? redirectTo
            : "/";
        if (target !== "/") {
          router.history.push(target);
        } else {
          navigate({ to: "/" });
        }
      } catch (e: any) {
        console.error("[login-done] failed", e?.message);
        setError(e?.message ?? "登录失败");
      }
    })();
  }, [search.ticket, search.provider, search.return_path, navigate, router]);

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
