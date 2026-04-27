import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/commission")({
  component: () => (
    <RouteGuard title="分成设置" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [l1, setL1] = useState<string>("");
  const [l2On, setL2On] = useState<boolean>(false);
  const [l2, setL2] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: m }, { data: c }] = await Promise.all([
        supabase.from("merchants").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("commission_config")
          .select("l1_rate, l2_rate, platform_rate, l1_max_rate, l2_max_rate")
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setMerchant(m);
      setCfg(c);
      if (m) {
        setL1(((Number(m.l1_rate) || 0) * 100).toFixed(2).replace(/\.?0+$/, ""));
        setL2On(!!m.l2_enabled);
        setL2(((Number(m.l2_rate) || 0) * 100).toFixed(2).replace(/\.?0+$/, ""));
      }
    })();
  }, [user?.id]);

  const l1Max = cfg ? Number(cfg.l1_max_rate) * 100 : 10;
  const l2Max = cfg ? Number(cfg.l2_max_rate) * 100 : 5;
  const platformPct = cfg ? Number(cfg.platform_rate) * 100 : 15;

  const l1Num = Number(l1) || 0;
  const l2Num = l2On ? (Number(l2) || 0) : 0;
  const merchantPct = Math.max(0, 100 - l1Num - l2Num - platformPct);

  const save = async () => {
    if (!merchant) return;
    if (l1Num < 0 || l1Num > l1Max) { toast.error(`一级比例需在 0 - ${l1Max}% 之间`); return; }
    if (l2On && (l2Num < 0 || l2Num > l2Max)) { toast.error(`二级比例需在 0 - ${l2Max}% 之间`); return; }
    if (l1Num + l2Num + platformPct > 100) { toast.error("L1 + L2 + 平台抽成 不能超过 100%"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("merchants")
      .update({
        l1_rate: l1Num / 100,
        l2_enabled: l2On,
        l2_rate: l2On ? l2Num / 100 : 0,
      })
      .eq("id", merchant.id);
    setSaving(false);
    if (error) {
      reportRpcError(error, { op: "merchants.update_commission", scope: "MerchantCommission" });
      toast.error(error.message || "保存失败");
    } else {
      reportRpcSuccess("merchants.update_commission");
      toast.success("已保存");
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="分成设置" />
      <main className="flex-1 px-3 py-3 space-y-3">
        {!merchant || !cfg ? (
          <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            <div className="bg-card rounded-2xl p-4">
              <div className="text-sm font-medium mb-1">平台规则</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                平台抽成固定 <span className="text-foreground font-semibold">{platformPct}%</span>；
                你可在范围内自定义代理佣金：
                一级 ≤ <span className="text-foreground font-semibold">{l1Max}%</span>，
                二级 ≤ <span className="text-foreground font-semibold">{l2Max}%</span>。
              </p>
            </div>

            {/* 一级 */}
            <div className="bg-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">一级代理佣金</div>
                  <div className="text-xs text-muted-foreground">直接推广人获得的分成</div>
                </div>
                <div className="text-xs text-muted-foreground">上限 {l1Max}%</div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min={0}
                  max={l1Max}
                  value={l1}
                  onChange={(e) => setL1(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>

            {/* 二级 */}
            <div className="bg-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">二级代理分成</div>
                  <div className="text-xs text-muted-foreground">间接推广人（上线的上线）获得的分成</div>
                </div>
                <Switch checked={l2On} onCheckedChange={setL2On} />
              </div>
              {l2On && (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>二级佣金比例</span>
                    <span>上限 {l2Max}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.5"
                      min={0}
                      max={l2Max}
                      value={l2}
                      onChange={(e) => setL2(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </>
              )}
              {!l2On && (
                <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
                  当前仅启用一级代理。开启后，二级代理将按设定比例自动分成。
                </p>
              )}
            </div>

            {/* 收益预览 */}
            <div className="bg-card rounded-2xl p-4">
              <div className="text-sm font-medium mb-3">每笔订单分配预览</div>
              <ul className="text-xs space-y-2">
                <Row label="一级代理" value={`${l1Num}%`} />
                <Row label="二级代理" value={l2On ? `${l2Num}%` : "未启用"} />
                <Row label="平台抽成" value={`${platformPct}%`} />
                <li className="border-t border-border pt-2 flex justify-between">
                  <span className="text-muted-foreground">商家实得</span>
                  <span className="text-success font-semibold">{merchantPct.toFixed(2)}%</span>
                </li>
              </ul>
            </div>

            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存设置"}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}
