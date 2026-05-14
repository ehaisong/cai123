import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "buyer" | "agent" | "merchant" | "admin";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  /** roles 是否已经从数据库加载完成（区分"未登录/无角色"与"加载中"） */
  rolesLoaded: boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  hasRole: (r: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  // 记录最近一次正在加载 roles 的 uid，避免并发请求把 rolesLoaded 反复 toggle，
  // 也避免老请求覆盖新结果。
  const loadingUidRef = (typeof window !== "undefined" ? (window as any) : {}) as { __loadRolesUid?: string };
  const loadRoles = async (uid: string | undefined) => {
    if (!uid) { setRoles([]); setRolesLoaded(true); return; }
    // 如果同一个 uid 正在加载，跳过重复请求
    if (loadingUidRef.__loadRolesUid === uid) return;
    loadingUidRef.__loadRolesUid = uid;
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    // 只有当本次请求仍是最新的才提交结果
    if (loadingUidRef.__loadRolesUid !== uid) return;
    setRoles((data ?? []).map((r) => r.role as AppRole));
    setRolesLoaded(true);
  };

  useEffect(() => {
    let initialized = false;
    // listener first：onAuthStateChange 在订阅后会立刻触发 INITIAL_SESSION，
    // 因此不必再额外调用 getSession() 重复加载一次 roles。
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      const uid = sess?.user?.id;
      // uid 变更时才重置 rolesLoaded，避免 INITIAL_SESSION 与后续重复事件
      // 把 rolesLoaded 频繁来回切换，导致首页 effect 反复 bail-out。
      if (loadingUidRef.__loadRolesUid !== uid) {
        loadingUidRef.__loadRolesUid = undefined;
        setRolesLoaded(false);
      }
      setTimeout(() => {
        loadRoles(uid).finally(() => {
          if (!initialized) { initialized = true; setLoading(false); }
        });
      }, 0);
      if (event === "SIGNED_IN" && sess?.user) {
        setTimeout(async () => {
          try {
            const code = typeof window !== "undefined" ? localStorage.getItem("pending_referrer") : null;
            if (!code) return;
            await supabase.rpc("bind_referrer", { _agent_code: code });
            try { localStorage.removeItem("pending_referrer"); } catch {}
          } catch {}
        }, 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    session,
    user,
    roles,
    loading,
    rolesLoaded,
    signOut: async () => { await supabase.auth.signOut(); },
    // 直接从 supabase 取当前 uid，避免依赖可能尚未更新的 React state
    // （刚 setSession 完成后，组件可能还未重渲染，闭包里的 user 仍是 null）
    refreshRoles: async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      // 强制刷新：清掉去重锁，确保拉取最新角色
      loadingUidRef.__loadRolesUid = undefined;
      await loadRoles(uid);
    },
    hasRole: (r) => roles.includes(r),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
