import { createFileRoute, Link, Navigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Store } from "lucide-react";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ ref: z.string().optional() }),
  component: HomeRouter,
});

type State =
  | { kind: "loading" }
  | { kind: "shop"; merchantId: string }
  | { kind: "redirect-login" }
  | { kind: "redirect-admin" }
  | { kind: "redirect-merchant" }
  | { kind: "invalid-ref"; defaultShopId: string | null }
  | { kind: "no-default" };

function HomeRouter() {
  const { user, loading: authLoading, rolesLoaded, hasRole } = useAuth();
  const search = useSearch({ from: "/" });
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (authLoading) return;
    // 已登录但 roles 还没加载完时不能下结论，否则会先把商家/管理员当成普通用户
    // 走默认店铺分支，闪现「正在为您准备店铺…」。
    if (user && !rolesLoaded) return;

    (async () => {
      // 读取"上次访问店铺"（扫码 / 直链都会写入 localStorage），用于跨 session 记忆。
      const lastShopId = (() => {
        if (typeof window === "undefined") return null;
        try { return localStorage.getItem("last_shop_id"); } catch { return null; }
      })();

      // A) 未带 ref 且未登录：
      //    - 若有上次访问店铺记录 → 直接进入该店铺
      //    - 否则 → 跳转登录页
      if (!search.ref && !user) {
        if (lastShopId) {
          const { data: m } = await supabase
            .from("merchants").select("id").eq("id", lastShopId).eq("status", "approved").maybeSingle();
          if (m?.id) { setState({ kind: "shop", merchantId: m.id }); return; }
        }
        setState({ kind: "redirect-login" });
        return;
      }

      // B) 已登录的管理员/商家：进入对应管理后台，而不是寻找店铺首页
      //    （仅当未携带 ref 时生效；带 ref 通常意味着主动通过推广/二维码进入店铺）
      if (!search.ref && user) {
        if (hasRole("admin")) {
          setState({ kind: "redirect-admin" });
          return;
        }
        if (hasRole("merchant")) {
          setState({ kind: "redirect-merchant" });
          return;
        }
        // 兜底：roles 表可能尚未写入 merchant 角色，但 merchants 表已存在已审核记录
        const { data: ownMerchant } = await supabase
          .from("merchants")
          .select("id, status")
          .eq("user_id", user.id)
          .eq("status", "approved")
          .maybeSingle();
        if (ownMerchant?.id) {
          setState({ kind: "redirect-merchant" });
          return;
        }
      }

      // 1) 若带 ref：先尝试绑定（仅登录用户），再解析目标商家
      let target: string | null = null;
      let refResolved = true; // 没有 ref 时视为"无需解析"，不算失败

      if (search.ref) {
        refResolved = false;
        if (user) {
          await supabase.rpc("bind_referrer", { _agent_code: search.ref });
        }
        // 通过 SECURITY DEFINER 函数解析推广码，避免 RLS 限制（未登录或非本人时无法读取 agent_relations）
        const { data: resolved } = await supabase.rpc("resolve_ref_to_merchant", { _ref: search.ref });
        target = (resolved as string | null) ?? null;

        if (target) {
          setState({ kind: "shop", merchantId: target });
          return;
        }

        // ref 无法解析为有效商家 → 显示兜底页（带默认店铺入口）
        const { data: s } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "default_shop_id")
          .maybeSingle();
        const v = s?.value;
        const defaultShopId = typeof v === "string" && v.length > 0 ? v : null;
        setState({ kind: "invalid-ref", defaultShopId });
        return;
      }

      // 2) 已登录买家若有绑定商家，优先使用
      if (!target && user) {
        const { data: ar } = await supabase
          .from("agent_relations")
          .select("bound_merchant_id")
          .eq("user_id", user.id)
          .maybeSingle();
        target = ar?.bound_merchant_id ?? null;
      }

      // 3) 回退到管理员配置的默认店铺
      if (!target) {
        const { data: s } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "default_shop_id")
          .maybeSingle();
        const v = s?.value;
        if (typeof v === "string" && v.length > 0) target = v;
      }

      // 4) 校验商家存在且已通过审核
      if (target) {
        const { data: m } = await supabase
          .from("merchants")
          .select("id")
          .eq("id", target)
          .eq("status", "approved")
          .maybeSingle();
        if (m?.id) {
          setState({ kind: "shop", merchantId: m.id });
          return;
        }
      }

      setState({ kind: "no-default" });
      void refResolved;
    })();
    // 注意：依赖 roles 数组而不是 hasRole 函数，避免每次 render 重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, rolesLoaded, user?.id, search.ref]);

  if (state.kind === "loading") {
    return (
      <div className="h5-shell">
        <PageHeader title="加载中" />
        <p className="text-center py-12 text-sm text-muted-foreground">正在为您准备店铺…</p>
      </div>
    );
  }

  if (state.kind === "redirect-login") {
    return <Navigate to="/auth/login" replace />;
  }

  if (state.kind === "redirect-admin") {
    return <Navigate to="/admin" replace />;
  }

  if (state.kind === "redirect-merchant") {
    return <Navigate to="/merchant" replace />;
  }

  if (state.kind === "shop") {
    return <Navigate to="/shop/$merchantId" params={{ merchantId: state.merchantId }} replace />;
  }

  // 二维码 ref 解析失败或对应店铺不可用
  if (state.kind === "invalid-ref") {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="无效链接" />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-warning" />
          </div>
          <p className="text-base font-semibold">该二维码无效或店铺不可用</p>
          <p className="mt-1 mb-6 text-xs text-muted-foreground max-w-[280px]">
            请确认二维码或推广链接来源是否正确。您也可以前往默认店铺继续浏览。
          </p>
          {state.defaultShopId ? (
            <Button asChild size="sm" className="min-w-[180px]">
              <Link to="/shop/$merchantId" params={{ merchantId: state.defaultShopId }} replace>
                返回默认店铺
              </Link>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">管理员尚未配置默认店铺</p>
          )}
        </div>
      </div>
    );
  }

  // 已登录但无默认店铺
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="欢迎" />
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/40 flex items-center justify-center mb-4">
          <Store className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-base font-semibold">暂无可用店铺</p>
        <p className="mt-1 mb-6 text-xs text-muted-foreground max-w-[260px]">
          管理员尚未配置默认店铺，请通过商家或代理分享的链接进入店铺。
        </p>
      </div>
    </div>
  );
}
