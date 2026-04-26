import { createFileRoute, Navigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Store } from "lucide-react";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ ref: z.string().optional() }),
  component: HomeRouter,
});

type State =
  | { kind: "loading" }
  | { kind: "shop"; merchantId: string }
  | { kind: "no-default" };

function HomeRouter() {
  const { user, loading: authLoading } = useAuth();
  const search = useSearch({ from: "/" });
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (authLoading) return;

    (async () => {
      // 1) 若带 ref：先尝试绑定，再解析目标商家
      let target: string | null = null;

      if (search.ref) {
        // 已登录用户：调用 RPC 写入归属商家/上线
        if (user) {
          await supabase.rpc("bind_referrer", { _agent_code: search.ref });
        }
        // 解析 ref → 商家 ID
        if (search.ref.startsWith("M_")) {
          target = search.ref.substring(2);
        } else {
          // 代理码：查上线代理所属商家
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

  if (state.kind === "shop") {
    return <Navigate to="/shop/$merchantId" params={{ merchantId: state.merchantId }} replace />;
  }

  // 无默认店铺
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
        {!user && (
          <Button className="w-full max-w-[240px]" onClick={() => navigate({ to: "/auth/login" })}>
            登录
          </Button>
        )}
      </div>
    </div>
  );
}
