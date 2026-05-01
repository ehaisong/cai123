import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { exchangeWechatTicket } from "@/server/wechat-login.functions";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login/wechat-done")({
  component: WechatDonePage,
  head: () => ({ meta: [{ title: "正在登录..." }] }),
});

function WechatDonePage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // StrictMode 防双调
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const ticket = params.get("ticket");
    const return_path = params.get("return_path") ?? "/";

    if (!ticket) {
      setError("缺少 ticket 参数");
      return;
    }

    (async () => {
      try {
        const r = await exchangeWechatTicket({ data: { ticket, return_path } });
        // 用 token_hash 完成 Supabase Auth 登录
        const { error: vErr } = await supabase.auth.verifyOtp({
          type: "magiclink",
          token_hash: r.tokenHash,
        });
        if (vErr) throw new Error(vErr.message);

        if (r.redirectTo.startsWith("/") && !r.redirectTo.startsWith("//")) {
          router.history.push(r.redirectTo);
        } else {
          navigate({ to: "/" });
        }
      } catch (e: any) {
        setError(e?.message ?? "登录失败");
      }
    })();
  }, [navigate, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-foreground">微信登录失败</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
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
