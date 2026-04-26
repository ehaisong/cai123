import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  component: () => (
    <RouteGuard title="通用设置" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="通用设置" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <WalletPurchaseToggle />
        <DefaultShopSelector />
      </main>
    </div>
  );
}

function DefaultShopSelector() {
  const [shops, setShops] = useState<Array<{ id: string; shop_name: string }>>([]);
  const [current, setCurrent] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("merchants").select("id, shop_name").eq("status", "approved").order("shop_name")
      .then(({ data }) => setShops(data ?? []));
    supabase.from("app_settings").select("value").eq("key", "default_shop_id").maybeSingle()
      .then(({ data }) => {
        const v = data?.value;
        setCurrent(typeof v === "string" ? v : "");
      });
  }, []);

  const save = async (next: string) => {
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      { key: "default_shop_id", value: (next || null) as any, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) { reportRpcError(error, { op: "app_settings.upsert(default_shop_id)", scope: "AdminSettings" }); return; }
    setCurrent(next);
    toast.success(next ? "已设置默认店铺" : "已清除默认店铺");
  };

  return (
    <div className="bg-card rounded-md p-4 space-y-2">
      <h3 className="text-sm font-medium">默认店铺</h3>
      <p className="text-xs text-muted-foreground">未通过推广链接进入网站的用户，将自动跳转到该默认店铺。</p>
      <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={current} disabled={saving} onChange={(e) => save(e.target.value)}>
        <option value="">— 未设置 —</option>
        {shops.map((s) => <option key={s.id} value={s.id}>{s.shop_name}</option>)}
      </select>
    </div>
  );
}

function WalletPurchaseToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "wallet_purchase_enabled").maybeSingle()
      .then(({ data }) => setEnabled(data?.value === true));
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      { key: "wallet_purchase_enabled", value: next as any, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) { reportRpcError(error, { op: "app_settings.upsert", scope: "AdminSettings" }); return; }
    setEnabled(next);
    toast.success(next ? "已开启钱包余额购买" : "已关闭钱包余额购买");
  };

  if (enabled === null) return <div className="bg-card rounded-md p-4 text-xs text-muted-foreground">加载中…</div>;

  return (
    <div className="bg-card rounded-md p-4 space-y-2">
      <h3 className="text-sm font-medium">钱包余额购买</h3>
      <p className="text-xs text-muted-foreground">
        开启后，普通用户购买商品需先充值至钱包；关闭后，购买不扣余额（仅作演示/对接外部支付）。商家与代理的佣金入账始终生效。
      </p>
      <div className="flex items-center justify-between pt-1">
        <span className={`text-sm ${enabled ? "text-success" : "text-muted-foreground"}`}>当前：{enabled ? "已开启" : "已关闭"}</span>
        <Button size="sm" variant={enabled ? "outline" : "default"} disabled={saving} onClick={() => toggle(!enabled)}>
          {enabled ? "关闭" : "开启"}
        </Button>
      </div>
    </div>
  );
}
