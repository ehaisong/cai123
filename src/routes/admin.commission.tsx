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
    <RouteGuard title="平台抽成配置" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
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
    const plat = Number(cfg.platform_rate);
    if (!Number.isFinite(plat) || plat < 0 || plat > 1) { toast.error("平台抽成需在 0-1 之间"); return; }
    const { error } = await supabase.from("commission_config")
      .update({ platform_rate: plat, updated_at: new Date().toISOString() })
      .eq("id", cfg.id);
    if (error) reportRpcError(error, { op: "commission_config.update", scope: "AdminCommission.save" });
    else { reportRpcSuccess("commission_config.update"); toast.success("已保存"); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="平台抽成配置" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {!cfg ? <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p> : (
          <>
            <div className="bg-card rounded-md p-4 space-y-3">
              <h3 className="text-sm font-medium">平台抽成</h3>
              <p className="text-[11px] text-muted-foreground">平台从每笔订单抽取的比例。代理分成由商户在「代理管理」中自行设置。</p>
              <div>
                <label className="text-xs">平台抽成 (0-1)</label>
                <Input type="number" step={0.01} value={cfg.platform_rate} onChange={(e) => setCfg({ ...cfg, platform_rate: Number(e.target.value) })} />
              </div>
            </div>
            <Button className="w-full" onClick={save}>保存配置</Button>
          </>
        )}
      </main>
    </div>
  );
}
