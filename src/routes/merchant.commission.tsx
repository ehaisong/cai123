import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/commission")({
  component: () => (
    <RouteGuard title="代理分成设置" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [l1, setL1] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: m }, { data: c }] = await Promise.all([
        supabase.from("merchants").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("commission_config").select("platform_rate").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setMerchant(m);
      setCfg(c);
      if (m) setL1(((Number(m.l1_rate) || 0) * 100).toFixed(2).replace(/\.?0+$/, ""));
    })();
  }, [user?.id]);

  const l1Max = merchant ? Number(merchant.l1_max_rate) * 100 : 92;
  const platformPct = cfg ? Number(cfg.platform_rate) * 100 : 0;
  const l1Num = Number(l1) || 0;
  const merchantPct = Math.max(0, 100 - l1Num - platformPct);

  const save = async () => {
    if (!merchant) return;
    if (l1Num < 0 || l1Num > l1Max) { toast.error(`分成需在 0 - ${l1Max}% 之间`); return; }
    setSaving(true);
    const { error } = await supabase.from("merchants")
      .update({ l1_rate: l1Num / 100, l2_enabled: false, l2_rate: 0 })
      .eq("id", merchant.id);
    setSaving(false);
    if (error) { reportRpcError(error, { op: "merchants.update_commission", scope: "MerchantCommission" }); toast.error(error.message || "保存失败"); }
    else { reportRpcSuccess("merchants.update_commission"); toast.success("已保存"); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="代理分成设置" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {!merchant || !cfg ? (
          <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            <div className="bg-card rounded-2xl p-4">
              <div className="text-sm font-medium mb-1">规则说明</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                本店统一为代理设置一级分成，上限 <span className="text-foreground font-semibold">{l1Max}%</span>（由商城管理员设置）。
                可在「代理列表」单独为某个代理修改分成。
              </p>
            </div>

            <div className="bg-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">默认代理分成</div>
                <div className="text-xs text-muted-foreground">上限 {l1Max}%</div>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" step="0.5" min={0} max={l1Max} value={l1} onChange={(e) => setL1(e.target.value)} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            <div className="bg-card rounded-2xl p-4">
              <div className="text-sm font-medium mb-3">每笔订单分配预览</div>
              <ul className="text-xs space-y-2">
                <li className="flex justify-between"><span className="text-muted-foreground">代理</span><span className="font-medium">{l1Num}%</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">平台抽成</span><span className="font-medium">{platformPct}%</span></li>
                <li className="border-t border-border pt-2 flex justify-between">
                  <span className="text-muted-foreground">商家实得</span>
                  <span className="text-success font-semibold">{merchantPct.toFixed(2)}%</span>
                </li>
              </ul>
            </div>

            <Button className="w-full" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存设置"}</Button>
          </>
        )}
      </main>
    </div>
  );
}
