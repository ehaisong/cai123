import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/commission")({
  component: () => (
    <RouteGuard title="分成配置" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [cfg, setCfg] = useState<any>(null);
  useEffect(() => {
    supabase.from("commission_config").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error) reportRpcError(error, { op: "commission_config.select", scope: "AdminCommission" });
        setCfg(data);
      });
  }, []);
  const save = async () => {
    const l1 = Number(cfg.l1_rate), plat = Number(cfg.platform_rate), l1Max = Number(cfg.l1_max_rate);
    if (![l1, plat, l1Max].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) { toast.error("比例必须在 0-1 之间"); return; }
    if (l1Max > 0.92) { toast.error("分成上限不能超过 92%"); return; }
    if (l1 > l1Max) { toast.error("默认分成不能超过上限"); return; }
    if (l1Max + plat > 1) { toast.error("上限 + 平台 不能超过 100%"); return; }
    const { error } = await supabase.from("commission_config")
      .update({
        l1_rate: l1, l1_max_rate: l1Max, platform_rate: plat,
        l2_rate: 0, l2_max_rate: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cfg.id);
    if (error) reportRpcError(error, { op: "commission_config.update", scope: "AdminCommission.save" });
    else { reportRpcSuccess("commission_config.update"); toast.success("已保存"); }
  };

  // 批量给所有商家应用默认分成
  const applyToAll = async () => {
    if (!cfg) return;
    if (!confirm(`将所有商家的默认分成统一设置为 ${(Number(cfg.l1_rate) * 100).toFixed(2)}%、上限 ${(Number(cfg.l1_max_rate) * 100).toFixed(2)}%？`)) return;
    const { error } = await supabase.from("merchants").update({
      l1_rate: Number(cfg.l1_rate),
      l1_max_rate: Number(cfg.l1_max_rate),
    }).neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { reportRpcError(error, { op: "merchants.bulk_update_rate", scope: "AdminCommission.applyAll" }); toast.error(error.message); }
    else toast.success("已应用到所有商家");
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="分成配置" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {!cfg ? <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p> : (
          <>
            <div className="bg-card rounded-md p-4 space-y-3">
              <h3 className="text-sm font-medium">代理一级分成（统一）</h3>
              <p className="text-[11px] text-muted-foreground">仅一级分成，最高 92%。商家可在此上限范围内自行调整。</p>
              <div><label className="text-xs">默认分成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l1_rate} onChange={(e) => setCfg({ ...cfg, l1_rate: Number(e.target.value) })} /></div>
              <div><label className="text-xs">分成上限 (0-0.92)</label><Input type="number" step={0.01} max={0.92} value={cfg.l1_max_rate ?? 0} onChange={(e) => setCfg({ ...cfg, l1_max_rate: Number(e.target.value) })} /></div>
              <div><label className="text-xs">平台抽成 (0-1)</label><Input type="number" step={0.01} value={cfg.platform_rate} onChange={(e) => setCfg({ ...cfg, platform_rate: Number(e.target.value) })} /></div>
            </div>
            <Button className="w-full" onClick={save}>保存配置</Button>
            <Button variant="outline" className="w-full" onClick={applyToAll}>统一应用到所有商家</Button>
            <p className="text-[11px] text-muted-foreground text-center">如需为单个商家单独设置，请前往「商家管理」页。</p>
          </>
        )}
      </main>
    </div>
  );
}
