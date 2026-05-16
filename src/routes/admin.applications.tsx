import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/applications")({
  component: () => (
    <RouteGuard title="商家审核" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [list, setList] = useState<any[]>([]);
  const load = async () => {
    const { data, error } = await supabase
      .from("merchant_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      reportRpcError(error, { op: "merchant_applications.select", scope: "AdminApplications" });
      return;
    }
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const review = async (app: any, approve: boolean, reason?: string) => {
    const { error } = await supabase.rpc("admin_review_merchant_application", {
      _id: app.id,
      _approve: approve,
      _reason: reason ?? null,
    });
    if (error) {
      reportRpcError(error, { op: "admin_review_merchant_application", scope: "AdminApplications.review" });
      toast.error(error.message);
      return;
    }
    reportRpcSuccess("admin_review_merchant_application", { id: app.id, approve });
    toast.success(approve ? "已通过" : "已驳回");
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家审核" />
      <main className="flex-1 px-3 py-3 space-y-2">
        {list.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无申请</p>}
        {list.map((a) => (
          <div key={a.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{a.shop_name ?? a.real_name ?? "未填写店铺名"}</div>
              <span className={`text-xs px-2 py-0.5 rounded ${a.status === "approved" ? "bg-success/10 text-success" : a.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                {({ pending: "待审核", approved: "已通过", rejected: "已驳回" } as any)[a.status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              手机号 {a.phone ?? "—"}
              {a.real_name && a.shop_name && ` · 联系人 ${a.real_name}`}
              {a.wechat_id && ` · 微信 ${a.wechat_id}`}
              {a.fans_count ? ` · 粉丝 ${a.fans_count}` : ""}
            </div>
            {a.description && <p className="text-xs mt-1 text-muted-foreground line-clamp-2">{a.description}</p>}
            {a.status === "pending" && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-success-foreground" onClick={() => review(a, true)}>通过</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { const r = prompt("驳回理由"); if (r) review(a, false, r); }}>驳回</Button>
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
