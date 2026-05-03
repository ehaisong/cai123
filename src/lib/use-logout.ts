import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

const STAFF_ROLES = new Set(["admin", "merchant", "agent"]);
const STAFF_PATH_PREFIXES = ["/admin", "/merchant", "/agent", "/auth/staff-login"];

/**
 * 全局统一登出 Hook。
 *
 * 跳转规则（避免再次出现路由跳错）：
 * 1. 显式传入 `redirectTo` → 优先使用
 * 2. 当前路径属于员工区域（/admin、/merchant、/agent）或用户拥有员工角色
 *    （admin / merchant / agent）→ 跳 `/auth/staff-login`
 * 3. 其他情况（普通用户、推荐人入口）→ 跳 `/auth/login`（微信扫码）
 */
export function useLogout() {
  const { signOut, roles } = useAuth();
  const navigate = useNavigate();

  return async function logout(opts?: { redirectTo?: string; silent?: boolean }) {
    try {
      await signOut();
      if (!opts?.silent) toast.success("已退出登录");

      let target = opts?.redirectTo;
      if (!target) {
        const path = typeof window !== "undefined" ? window.location.pathname : "/";
        const inStaffArea = STAFF_PATH_PREFIXES.some((p) => path.startsWith(p));
        const isStaff = (roles ?? []).some((r) => STAFF_ROLES.has(r));
        target = inStaffArea || isStaff ? "/auth/staff-login" : "/auth/login";
      }

      navigate({ to: target });
    } catch {
      if (!opts?.silent) toast.error("退出失败，请重试");
    }
  };
}
