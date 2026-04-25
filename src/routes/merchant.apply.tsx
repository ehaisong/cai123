import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/apply")({
  component: ApplyPage,
});

function ApplyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    real_name: "", phone: "", wechat_id: "", fans_count: 0, public_account: "", description: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [existing, setExisting] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("merchant_applications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => setExisting(data));
  }, [user?.id]);

  if (!user) {
    return <div className="h5-shell"><PageHeader title="申请商家" /><div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div></div>;
  }

  const submit = async () => {
    if (!form.real_name || !form.phone) { toast.error("请填写姓名和手机号"); return; }
    if (!agreed) { toast.error("请阅读并同意《商家入驻协议》"); return; }
    setLoading(true);
    const { error } = await supabase.from("merchant_applications").insert({ ...form, user_id: user.id });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("申请已提交，请等待审核");
    setExisting({ ...form, status: "pending" });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="申请商家" />

      {existing && existing.status === "pending" && (
        <div className="mx-3 mt-3 p-3 rounded bg-warning/10 text-warning text-sm">您已提交申请，正在审核中…</div>
      )}
      {existing && existing.status === "approved" && (
        <div className="mx-3 mt-3 p-3 rounded bg-success/10 text-success text-sm">申请已通过，可在「我的」进入商家后台</div>
      )}
      {existing && existing.status === "rejected" && (
        <div className="mx-3 mt-3 p-3 rounded bg-destructive/10 text-destructive text-sm">申请被驳回：{existing.reject_reason ?? "未填写理由"}</div>
      )}

      <div className="px-3 py-3 text-sm text-muted-foreground">基本资料</div>
      <div className="bg-card mx-3 rounded-xl divide-y divide-border">
        <Row label="姓 名"><Input value={form.real_name} onChange={(e) => setForm({ ...form, real_name: e.target.value })} placeholder="请输入商家姓名" className="border-0 shadow-none focus-visible:ring-0 px-0" /></Row>
        <Row label="手机号"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="请输入手机号" className="border-0 shadow-none focus-visible:ring-0 px-0" /></Row>
        <Row label="微信号"><Input value={form.wechat_id} onChange={(e) => setForm({ ...form, wechat_id: e.target.value })} placeholder="请输入微信号" className="border-0 shadow-none focus-visible:ring-0 px-0" /></Row>
        <Row label="粉丝数"><Input type="number" value={form.fans_count} onChange={(e) => setForm({ ...form, fans_count: Number(e.target.value) })} placeholder="请输入粉丝数" className="border-0 shadow-none focus-visible:ring-0 px-0" /></Row>
        <Row label="公众号"><Input value={form.public_account} onChange={(e) => setForm({ ...form, public_account: e.target.value })} placeholder="选填公众号" className="border-0 shadow-none focus-visible:ring-0 px-0" /></Row>
      </div>

      <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">申请说明</div>
      <div className="bg-card mx-3 rounded-xl p-3">
        <Textarea
          rows={4}
          maxLength={200}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="请填写申请入驻说明…"
          className="border-0 shadow-none focus-visible:ring-0 resize-none px-0"
        />
        <div className="text-right text-xs text-muted-foreground">{form.description.length}/200</div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground px-4 py-4">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        请阅读并同意 <span className="text-info">《商家入驻协议》</span>
      </label>

      <div className="px-3 pb-6">
        <Button className="w-full bg-info hover:bg-info/90 text-info-foreground" size="lg" onClick={submit} disabled={loading}>
          {loading ? "提交中…" : "提 交 申 请"}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center px-4 py-3">
      <div className="w-20 text-sm font-medium">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
