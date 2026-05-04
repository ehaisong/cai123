import { supabase } from "@/integrations/supabase/client";

export type RoleRouteResult = {
  /** SPA 路径，可直接传给 navigate({ to }) */
  path: string;
  /** 是否需要整页跳转（携带 query 等） */
  hard?: boolean;
};

type Options = {
  /** "customer" | "staff"，影响普通用户的回落路径 */
  tab?: "customer" | "staff";
  /** 客户回落首页时使用 */
  ref?: string;
  /** 客户登录成功后的业务回跳路径 */
  redirect?: string;
};

const safeRedirect = (raw?: string): string | null => {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
};

/**
 * 根据用户角色解析登录后落地页。并行查询 roles + merchant 以减少串行 RTT。
 * bootstrap_admin_role 在后台异步触发，不阻塞导航。
 */
export async function resolveLoginDestination(opts: Options = {}): Promise<RoleRouteResult> {
  const { tab = "customer", ref, redirect } = opts;

  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { path: "/auth/login" };

  // 后台尝试初始化 admin 角色，失败也不阻塞
  void (async () => { try { await supabase.rpc("bootstrap_admin_role"); } catch {} })();

  // 并行：roles + merchant 状态
  const [rolesRes, merchantRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", uid),
    supabase.from("merchants").select("id, status").eq("user_id", uid).maybeSingle(),
  ]);
  const roles = (rolesRes.data ?? []).map((r) => r.role as string);
  const merchant = merchantRes.data;

  if (roles.includes("admin")) return { path: "/admin" };
  if (roles.includes("agent")) return { path: "/agent" };

  if (merchant?.status === "approved") {
    if (!roles.includes("merchant")) {
      // 异步补角色，不阻塞跳转
      void supabase.from("user_roles").insert({ user_id: uid, role: "merchant" });
    }
    return { path: "/merchant" };
  }
  if (roles.includes("merchant")) return { path: "/merchant" };

  if (tab === "staff") {
    const { data: app } = await supabase
      .from("merchant_applications")
      .select("status")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (app?.status === "approved") return { path: "/merchant" };
    return { path: "/apply" };
  }

  // 普通客户：业务回跳路径优先
  const back = safeRedirect(redirect) ?? (ref ? `/?ref=${encodeURIComponent(ref)}` : "/");
  return { path: back, hard: !!ref };
}
