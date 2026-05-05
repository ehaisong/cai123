import { createFileRoute, Navigate } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  ticket: z.string().optional(),
  provider: z.enum(["wechat", "phone"]).optional(),
  return_path: z.string().optional(),
});

/**
 * 兼容旧中转站回调地址 /login/wechat-done。
 * 中转站（wx.lovclaw.com）会回跳到该路径，统一转发到 /login/done 完成 ticket 交换。
 */
export const Route = createFileRoute("/login/wechat-done")({
  validateSearch: searchSchema,
  ssr: false,
  component: LegacyWechatDone,
  head: () => ({
    meta: [
      { title: "正在登录..." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function LegacyWechatDone() {
  const search = Route.useSearch();
  return <Navigate to="/login/done" search={search} replace />;
}
