import { createFileRoute, Navigate } from "@tanstack/react-router";

// 旧的员工登录入口已合并进 /auth/login 的「商家登录」Tab。
// 这里保留路由，自动重定向。
export const Route = createFileRoute("/auth/staff-login")({
  component: StaffLoginRedirect,
  head: () => ({
    meta: [
      { title: "员工登录 · 预马当先" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function StaffLoginRedirect() {
  return <Navigate to="/auth/login" search={{ tab: "staff" }} replace />;
}
