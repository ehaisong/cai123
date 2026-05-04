import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

/**
 * 全站统一登出 Hook：登出后统一回到 `/auth/login`。
 * （员工登录入口已合并到 /auth/login 的「商家登录」Tab。）
 */
export function useLogout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return async function logout(opts?: { redirectTo?: string; silent?: boolean }) {
    try {
      await signOut();
      if (!opts?.silent) toast.success("已退出登录");
      navigate({ to: opts?.redirectTo ?? "/auth/login" });
    } catch {
      if (!opts?.silent) toast.error("退出失败，请重试");
    }
  };
}
