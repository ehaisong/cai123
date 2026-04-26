import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Store, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/shop/me")({
  component: ShopMePage,
});

type State =
  | { kind: "loading" }
  | { kind: "no-auth" }
  | { kind: "no-merchant" }
  | { kind: "pending" }
  | { kind: "rejected"; reason: string | null }
  | { kind: "ready"; merchantId: string };

function ShopMePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setState({ kind: "no-auth" }); return; }

    (async () => {
      const { data: m } = await supabase
        .from("merchants")
        .select("id, status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (m?.id && m.status === "approved") {
        setState({ kind: "ready", merchantId: m.id });
        return;
      }
      if (m?.status === "pending") { setState({ kind: "pending" }); return; }
      if (m?.status === "rejected") {
        setState({ kind: "rejected", reason: null });
        return;
      }

      // 无 merchant 记录，查申请记录
      const { data: app } = await supabase
        .from("merchant_applications")
        .select("status, reject_reason")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!app) { setState({ kind: "no-merchant" }); return; }
      if (app.status === "pending") { setState({ kind: "pending" }); return; }
      if (app.status === "rejected") { setState({ kind: "rejected", reason: app.reject_reason ?? null }); return; }
      setState({ kind: "no-merchant" });
    })();
  }, [authLoading, user?.id]);

  if (state.kind === "ready") {
    return <Navigate to="/shop/$merchantId" params={{ merchantId: state.merchantId }} replace />;
  }

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="我的店铺" />

      {state.kind === "loading" && (
        <div className="p-10 text-center text-sm text-muted-foreground">加载中…</div>
      )}

      {state.kind === "no-auth" && (
        <EmptyCard
          icon={<Store className="w-7 h-7 text-muted-foreground" />}
          title="还未登录"
          desc="登录后查看您的店铺信息"
          actions={<Button onClick={() => navigate({ to: "/auth/login" })}>去登录</Button>}
        />
      )}

      {state.kind === "no-merchant" && (
        <EmptyCard
          icon={<Store className="w-7 h-7 text-info" />}
          title="您还不是商家"
          desc="申请开店审核通过后，即可拥有自己的专属店铺主页"
          actions={
            <>
              <Button onClick={() => navigate({ to: "/merchant/apply" })}>立即申请开店</Button>
              <Button variant="outline" onClick={() => navigate({ to: "/" })}>返回首页</Button>
            </>
          }
        />
      )}

      {state.kind === "pending" && (
        <EmptyCard
          icon={<AlertCircle className="w-7 h-7 text-warning" />}
          title="申请审核中"
          desc="您的商家入驻申请正在审核，通过后即可访问店铺"
          actions={<Button variant="outline" onClick={() => navigate({ to: "/merchant/apply" })}>查看申请</Button>}
        />
      )}

      {state.kind === "rejected" && (
        <EmptyCard
          icon={<AlertCircle className="w-7 h-7 text-destructive" />}
          title="申请未通过"
          desc={state.reason ? `驳回原因：${state.reason}` : "您可以修改资料后重新提交申请"}
          actions={<Button onClick={() => navigate({ to: "/merchant/apply" })}>重新申请</Button>}
        />
      )}
    </div>
  );
}

function EmptyCard({
  icon, title, desc, actions,
}: { icon: React.ReactNode; title: string; desc: string; actions: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-accent/40 flex items-center justify-center mb-4">{icon}</div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-1 mb-6 text-xs text-muted-foreground max-w-[260px]">{desc}</p>
      <div className="flex flex-col gap-2 w-full max-w-[240px]">{actions}</div>
    </div>
  );
}
