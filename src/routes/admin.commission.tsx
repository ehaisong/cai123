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
    const l1 = Number(cfg.l1_rate), l2 = Number(cfg.l2_rate), plat = Number(cfg.platform_rate);
    const l1Max = Number(cfg.l1_max_rate), l2Max = Number(cfg.l2_max_rate);
    if (![l1, l2, plat, l1Max, l2Max].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) { toast.error("分成比例必须在 0-1 之间"); return; }
    if (l1 > l1Max || l2 > l2Max) { toast.error("默认比例不能超过对应上限"); return; }
    if (l1Max + l2Max + plat > 1) { toast.error("L1上限 + L2上限 + 平台 不能超过 1"); return; }
    const { error } = await supabase.from("commission_config")
      .update({
        l1_rate: l1, l2_rate: l2, platform_rate: plat,
        l1_max_rate: l1Max, l2_max_rate: l2Max,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cfg.id);
    if (error) reportRpcError(error, { op: "commission_config.update", scope: "AdminCommission.save" });
    else { reportRpcSuccess("commission_config.update"); toast.success("已保存"); }
  };
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="分成配置" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {!cfg ? <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p> : (
          <>
            <div className="bg-card rounded-md p-4 space-y-3">
              <h3 className="text-sm font-medium">默认分成比例</h3>
              <p className="text-[11px] text-muted-foreground">新商家默认采用以下比例（仅一级代理生效，二级需商家自行开启）。</p>
              <div><label className="text-xs">默认一级代理比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l1_rate} onChange={(e) => setCfg({ ...cfg, l1_rate: Number(e.target.value) })} /></div>
              <div><label className="text-xs">默认二级代理比例 (0-1)</label><Input type="number" step={0.01} value={cfg.l2_rate} onChange={(e) => setCfg({ ...cfg, l2_rate: Number(e.target.value) })} /></div>
              <div><label className="text-xs">平台抽成比例 (0-1)</label><Input type="number" step={0.01} value={cfg.platform_rate} onChange={(e) => setCfg({ ...cfg, platform_rate: Number(e.target.value) })} /></div>
            </div>

            <div className="bg-card rounded-md p-4 space-y-3">
              <h3 className="text-sm font-medium">商家可调上限</h3>
              <p className="text-[11px] text-muted-foreground">商家在分成设置中可在以下上限范围内自行调整佣金比例。</p>
              <div><label className="text-xs">一级代理上限 (0-1)</label><Input type="number" step={0.01} value={cfg.l1_max_rate ?? 0} onChange={(e) => setCfg({ ...cfg, l1_max_rate: Number(e.target.value) })} /></div>
              <div><label className="text-xs">二级代理上限 (0-1)</label><Input type="number" step={0.01} value={cfg.l2_max_rate ?? 0} onChange={(e) => setCfg({ ...cfg, l2_max_rate: Number(e.target.value) })} /></div>
              <p className="text-xs text-muted-foreground">商家实得 = 1 - 商家L1 - 商家L2 - 平台</p>
            </div>

            <Button className="w-full" onClick={save}>保存配置</Button>
          </>
        )}
      </main>
    </div>
  );
}
