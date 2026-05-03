import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { Loader2 } from "lucide-react";

// 旧路径兼容：把 /login/wechat-done 重定向到统一回调 /login/done
// 默认 provider=wechat，保持老链接行为不变。
const searchSchema = z.object({
  ticket: z.string().optional(),
  provider: z.enum(["wechat", "phone"]).optional(),
  return_path: z.string().optional(),
});

export const Route = createFileRoute("/login/wechat-done")({
  validateSearch: searchSchema,
  ssr: false,
  component: LegacyWechatDonePage,
  head: () => ({ meta: [{ title: "正在登录..." }, { name: "robots", content: "noindex,nofollow" }] }),
});

function LegacyWechatDonePage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  useEffect(() => {
    navigate({
      to: "/login/done",
      search: {
        ticket: search.ticket,
        provider: search.provider ?? "wechat",
        return_path: search.return_path,
      },
      replace: true,
    });
  }, [navigate, search.ticket, search.provider, search.return_path]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-sm text-muted-foreground">正在跳转…</p>
    </div>
  );
}
