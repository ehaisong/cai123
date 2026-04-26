import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError, reportRpcSuccess } from "@/lib/error-logger";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/recharge")({
  component: () => (
    <RouteGuard title="手动充值" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const submit = async () => {
    if (!code.trim()) { toast.error("请输入用户编号"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("金额必须大于 0"); return; }
    const { data: p, error: pe } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("user_code", code.trim())
      .maybeSingle();
    if (pe) { reportRpcError(pe, { op: "profiles.lookup", scope: "AdminRecharge" }); return; }
    if (!p) { toast.error("用户不存在"); return; }
    const { data, error } = await supabase.rpc("admin_recharge_user", {
      _user_id: p.user_id, _amount: amount, _note: note || undefined,
    });
    if (error) { reportRpcError(error, { op: "rpc:admin_recharge_user", scope: "AdminRecharge" }); return; }
    reportRpcSuccess("rpc:admin_recharge_user", { tx_id: data });
    toast.success("充值成功");
    setCode(""); setAmount(100); setNote("");
  };
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="手动充值" />
      <main className="flex-1 px-3 py-3">
        <div className="bg-card rounded-md p-4 space-y-3">
          <div><label className="text-xs">用户编号 (uXXXXXX)</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 u12345678" /></div>
          <div><label className="text-xs">金额 (¥)</label><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div><label className="text-xs">备注（可选）</label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button className="w-full" onClick={submit}>立即充值</Button>
        </div>
      </main>
    </div>
  );
}
