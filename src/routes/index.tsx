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
  | { kind: "invalid-ref"; defaultShopId: string | null }
  | { kind: "no-default" };

function HomeRouter() {
  const { user, loading: authLoading } = useAuth();
  const search = useSearch({ from: "/" });
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (authLoading) return;

    (async () => {
      // A) 未带 ref 且未登录 → 跳转登录页（登录后回首页继续解析默认店铺）
      if (!search.ref && !user) {
        setState({ kind: "redirect-login" });
        return;
      }

      // 1) 若带 ref：先尝试绑定（仅登录用户），再解析目标商家
      let target: string | null = null;
      let refResolved = true; // 没有 ref 时视为"无需解析"，不算失败

      if (search.ref) {
        refResolved = false;
        if (user) {
          await supabase.rpc("bind_referrer", { _agent_code: search.ref });
        }
        if (search.ref.startsWith("M_")) {
          target = search.ref.substring(2);
        } else {
          const { data: p } = await supabase
            .from("profiles")
            .select("user_id")
            .eq("user_code", search.ref)
            .maybeSingle();
          if (p?.user_id) {
            const { data: ar } = await supabase
              .from("agent_relations")
              .select("bound_merchant_id")
              .eq("user_id", p.user_id)
              .maybeSingle();
            target = ar?.bound_merchant_id ?? null;
          }
        }

        // 校验 ref 解析出的商家有效（存在且已审核）
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
  }, [authLoading, user?.id, search.ref]);

  if (state.kind === "loading") {
    return (
      <div className="h5-shell">
        <PageHeader title="加载中" />
        <p className="text-center py-12 text-sm text-muted-foreground">正在为您准备店铺…</p>
      </div>
    );
  }

  if (state.kind === "redirect-login") {
    return <Navigate to="/auth/login" search={{ redirect: "/" }} replace />;
  }

  if (state.kind === "shop") {
    return <Navigate to="/shop/$merchantId" params={{ merchantId: state.merchantId }} replace />;
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
