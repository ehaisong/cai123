import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/agent-applications")({
  component: () => (
    <RouteGuard title="代理申请审核" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { user } = useAuth();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
    if (!m) { setList([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from("agent_applications")
      .select("*")
      .eq("merchant_id", m.id)
      .order("created_at", { ascending: false });
    if (error) { reportRpcError(error, { op: "agent_applications.select", scope: "MerchantAgentApps" }); }
    const apps = (data ?? []) as any[];
    // 拉取申请人资料
    const uids = Array.from(new Set(apps.map((a) => a.user_id)));
    let profileMap: Record<string, any> = {};
    if (uids.length > 0) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("user_id, nickname, phone, avatar_url, user_code")
        .in("user_id", uids);
      profileMap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    setList(apps.map((a) => ({ ...a, profile: profileMap[a.user_id] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const review = async (app: any, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = prompt("驳回理由（选填）") ?? "";
    }
    const { error } = await supabase.rpc("review_agent_application" as any, {
      _id: app.id, _approve: approve, _reason: reason,
    });
    if (error) {
      reportRpcError(error, { op: "rpc:review_agent_application", scope: "MerchantAgentApps" });
      toast.error(error.message ?? "操作失败");
      return;
    }
    reportRpcSuccess("rpc:review_agent_application", { id: app.id, approve });
    toast.success(approve ? "已通过" : "已驳回");
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理申请审核" />
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-8 text-sm text-muted-foreground">加载中…</p>}
        {!loading && list.length === 0 && (
          <p className="text-center py-8 text-sm text-muted-foreground">暂无申请</p>
        )}
        {list.map((a) => (
          <div key={a.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {a.profile?.avatar_url ? (
                  <img src={a.profile.avatar_url} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-accent" />
                )}
                <div>
                  <div className="text-sm font-medium">{a.profile?.nickname || a.profile?.phone || "用户"}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.profile?.user_code ? `编号 ${a.profile.user_code}` : null}
                    {a.profile?.phone ? ` · ${a.profile.phone}` : ""}
                  </div>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${
                a.status === "approved" ? "bg-success/10 text-success"
                : a.status === "rejected" ? "bg-destructive/10 text-destructive"
                : "bg-warning/10 text-warning"
              }`}>
                {({ pending: "待审核", approved: "已通过", rejected: "已驳回" } as any)[a.status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">提交时间：{fmtDate(a.created_at)}</div>
            {a.note && <p className="text-xs mt-1 text-foreground/80">说明：{a.note}</p>}
            {a.status === "rejected" && a.reject_reason && (
              <p className="text-xs mt-1 text-destructive">驳回理由：{a.reject_reason}</p>
            )}
            {a.status === "pending" && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-success-foreground"
                  onClick={() => review(a, true)}>通过</Button>
                <Button size="sm" variant="outline" className="flex-1"
                  onClick={() => review(a, false)}>驳回</Button>
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
