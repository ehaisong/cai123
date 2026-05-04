import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

/**
 * Iframe 桥接页：
 * 中转站（wx.lovclaw.com）登录完成后会 302 回到本页，URL 上带 ticket / provider。
 * 本页运行在 iframe 内，把这些参数 postMessage 给父页，由父页关闭 iframe 后到 /login/done 完成 ticket 交换。
 */
export const Route = createFileRoute("/login/iframe-bridge")({
  ssr: false,
  component: BridgePage,
  head: () => ({
    meta: [
      { title: "登录处理中…" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function BridgePage() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const payload: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { payload[k] = v; });

    const send = () => {
      try {
        window.parent?.postMessage(
          { type: "lovable-login-bridge", payload },
          window.location.origin,
        );
      } catch {
        // ignore
      }
    };

    // 立即发一次；保险起见再延迟一次
    send();
    const t = setTimeout(send, 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="mt-3 text-xs text-muted-foreground">登录处理中…</p>
    </div>
  );
}
