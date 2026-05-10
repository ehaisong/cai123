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

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) { setRoles([]); setRolesLoaded(true); return; }
    setRolesLoaded(false);
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles((data ?? []).map((r) => r.role as AppRole));
    setRolesLoaded(true);
  };

  useEffect(() => {
    // listener first
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      // defer to avoid deadlock
      setTimeout(() => loadRoles(sess?.user?.id), 0);
      // 登录/注册成功时，消费匿名期间暂存的代理推广码（pending_referrer），
      // 把"客户 → 代理"绑定关系写入数据库。任何登录路径（短信、密码、微信、
      // 邮箱）都会触发，确保不会因登录跳转目标不是首页而漏绑。
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
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      loadRoles(sess?.user?.id).finally(() => setLoading(false));
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
    refreshRoles: () => loadRoles(user?.id),
    hasRole: (r) => roles.includes(r),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
