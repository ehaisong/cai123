import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/withdrawals")({
  component: () => (
    <RouteGuard title="提现审批" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [list, setList] = useState<any[]>([]);
  const load = async () => {
    const { data, error } = await supabase
      .from("withdrawals")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      reportRpcError(error, { op: "withdrawals.select", scope: "AdminWithdrawals" });
      return;
    }
    const userIds = Array.from(new Set((data ?? []).map((w: any) => w.user_id).filter(Boolean)));
    let map: Record<string, { nickname: string | null; user_code: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, nickname, user_code")
        .in("user_id", userIds);
      map = Object.fromEntries((profiles ?? []).map((p: any) => [p.user_id, p]));
    }
    setList((data ?? []).map((w: any) => ({ ...w, profile: map[w.user_id] })));
  };
  useEffect(() => { load(); }, []);

  const review = async (w: any, status: "approved" | "rejected" | "paid", reason?: string) => {
    const { error } = await supabase
      .from("withdrawals")
      .update({ status, reject_reason: reason ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", w.id);
    if (error) {
      reportRpcError(error, { op: "withdrawals.update", scope: "AdminWithdrawals.review" });
    } else {
      reportRpcSuccess("withdrawals.update", { id: w.id, status });
      toast.success("已更新");
      load();
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="提现审批" />
      <main className="flex-1 px-3 py-3 space-y-2">
        {list.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无提现</p>}
        {list.map((w) => (
          <div key={w.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{fmtMoney(w.amount)} · {w.channel}</div>
              <span className="text-xs text-muted-foreground">{fmtDate(w.created_at)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              用户：{w.profile?.nickname ?? "-"}（{w.profile?.user_code ?? "-"}）
            </div>
            <div className="text-xs text-muted-foreground mt-1">{w.account_info}</div>
            {w.status === "pending" && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => review(w, "paid")}>标记已打款</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { const r = prompt("驳回理由"); if (r) review(w, "rejected", r); }}>驳回</Button>
              </div>
            )}
            {w.status !== "pending" && <div className="mt-1 text-xs text-success">{w.status}</div>}
          </div>
        ))}
      </main>
    </div>
  );
}
