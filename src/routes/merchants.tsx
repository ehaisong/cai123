import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/merchants")({
  component: MerchantsPage,
});

type Redirect =
  | { kind: "loading" }
  | { kind: "admin" }
  | { kind: "go-shop"; merchantId: string }
  | { kind: "no-shop" };

function MerchantsPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const [r, setR] = useState<Redirect>({ kind: "loading" });

  useEffect(() => {
    if (loading) return;
    (async () => {
      // admin → 直接展示完整列表
      if (user && hasRole("admin")) { setR({ kind: "admin" }); return; }

      // 商家 → 自己的店铺
      if (user && hasRole("merchant")) {
        const { data: m } = await supabase
          .from("merchants").select("id").eq("user_id", user.id).maybeSingle();
        if (m?.id) { setR({ kind: "go-shop", merchantId: m.id }); return; }
      }

      // 代理或买家 → 绑定商家 / 默认店铺
      let target: string | null = null;
      if (user) {
        const { data: ar } = await supabase
          .from("agent_relations").select("bound_merchant_id").eq("user_id", user.id).maybeSingle();
        target = ar?.bound_merchant_id ?? null;
      }
      if (!target) {
        const { data: s } = await supabase
          .from("app_settings").select("value").eq("key", "default_shop_id").maybeSingle();
        if (typeof s?.value === "string" && s.value.length > 0) target = s.value;
      }
      if (target) {
        const { data: ok } = await supabase
          .from("merchants").select("id").eq("id", target).eq("status", "approved").maybeSingle();
        if (ok?.id) { setR({ kind: "go-shop", merchantId: ok.id }); return; }
      }
      setR({ kind: "no-shop" });
    })();
  }, [loading, user?.id, hasRole]);

  if (r.kind === "loading") {
    return (
      <div className="h5-shell"><PageHeader title="商家列表" />
        <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }
  if (r.kind === "go-shop") {
    return <Navigate to="/shop/$merchantId" params={{ merchantId: r.merchantId }} replace />;
  }
  if (r.kind === "no-shop") {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="商家列表" />
        <div className="m-3 rounded-2xl bg-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-base font-semibold mb-1">无可访问的店铺</h2>
          <p className="text-xs text-muted-foreground mb-4">
            商家列表仅管理员可访问。请通过商家或代理分享的链接进入店铺。
          </p>
          <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>返回首页</Button>
        </div>
      </div>
    );
  }
  return <AdminMerchantList />;
}

function AdminMerchantList() {
  const [list, setList] = useState<any[]>([]);
  const [kw, setKw] = useState("");

  useEffect(() => {
    supabase.from("merchants")
      .select("id, shop_name, shop_avatar_url, shop_description")
      .eq("status", "approved")
      .then(({ data }) => setList(data ?? []));
  }, []);

  const filtered = kw ? list.filter((m) => m.shop_name.includes(kw)) : list;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家列表（管理员）" />
      <div className="px-3 py-3">
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="🔍 搜索商家名称"
          className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm focus:outline-none"
        />
      </div>
      <main className="flex-1 px-3 space-y-3">
        {filtered.map((m) => (
          <div key={m.id} className="bg-card rounded-xl p-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">🍱</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{m.shop_name}</div>
              </div>
              <Link to="/shop/$merchantId" params={{ merchantId: m.id }} className="text-xs border border-info/30 text-info rounded px-2 py-1">
                ⌂ 进入
              </Link>
            </div>
            <p className="mt-2 text-xs text-muted-foreground line-clamp-3">
              {m.shop_description ?? "—"}
            </p>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center py-10 text-xs text-muted-foreground">暂无商家</p>
        )}
      </main>
    </div>
  );
}
