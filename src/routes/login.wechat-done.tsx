import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { exchangeWechatTicket } from "@/server/wechat-login.functions";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const searchSchema = z.object({
  ticket: z.string().optional(),
  return_path: z.string().optional(),
});

export const Route = createFileRoute("/login/wechat-done")({
  validateSearch: searchSchema,
  ssr: false, // 完全交给客户端处理，避免 SSR Invariant
  component: WechatDonePage,
  head: () => ({ meta: [{ title: "正在登录..." }] }),
});

function WechatDonePage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const ticket = search.ticket;
    const return_path = search.return_path ?? "/";

    console.log("[wechat-done] mount", {
      hasTicket: !!ticket,
      ticketTail: ticket?.slice(-8),
      return_path,
    });

    if (!ticket) {
      setError("缺少 ticket 参数");
      return;
    }

    (async () => {
      try {
        const r = await exchangeWechatTicket({ data: { ticket, return_path } });
        console.log("[wechat-done] exchange ok", {
          email: r.email,
          redirectTo: r.redirectTo,
          hasTokenHash: !!r.tokenHash,
        });

        const { error: vErr } = await supabase.auth.verifyOtp({
          type: "email",
          token_hash: r.tokenHash,
        });
        if (vErr) {
          console.error("[wechat-done] verifyOtp failed", {
            message: vErr.message,
            status: (vErr as any).status,
            name: vErr.name,
          });
          setDetail({
            step: "verifyOtp",
            status: (vErr as any).status ?? null,
            name: vErr.name,
            message: vErr.message,
          });
          throw new Error(`verifyOtp 失败: ${vErr.message}`);
        }

        console.log("[wechat-done] verifyOtp ok, redirect", { redirectTo: r.redirectTo });

        const target =
          r.redirectTo.startsWith("/") && !r.redirectTo.startsWith("//")
            ? r.redirectTo
            : "/";
        if (target !== "/") {
          router.history.push(target);
        } else {
          navigate({ to: "/" });
        }
      } catch (e: any) {
        // 服务端 WechatLoginError 透出的字段（通过 message 透传 + 可能挂在对象上）
        const info: Record<string, unknown> = {
          message: e?.message ?? "登录失败",
        };
        if (e?.step) info.step = e.step;
        if (e?.errcode != null) info.errcode = e.errcode;
        if (e?.errmsg) info.errmsg = e.errmsg;
        if (e?.raw) info.raw = e.raw;
        console.error("[wechat-done] failed", info);
        setDetail((prev) => prev ?? info);
        setError(e?.message ?? "登录失败");
      }
    })();
  }, [search.ticket, search.return_path, navigate, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-6 py-10">
        <div className="w-full max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">微信登录失败</h1>
          <p className="mt-2 break-all text-sm text-muted-foreground">{error}</p>
          {detail ? (
            <pre className="mt-4 max-h-60 overflow-auto rounded-md bg-background p-3 text-left text-xs text-muted-foreground">
              {JSON.stringify(detail, null, 2)}
            </pre>
          ) : null}
          <Link
            to="/auth/login"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            返回登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-sm text-muted-foreground">正在完成微信登录，请稍候…</p>
    </div>
  );
}
