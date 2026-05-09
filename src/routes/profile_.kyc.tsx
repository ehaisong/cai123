import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { ShieldCheck, Lock } from "lucide-react";

export const Route = createFileRoute("/profile/kyc")({
  component: () => (
    <RouteGuard title="实名绑定">
      <Inner />
    </RouteGuard>
  ),
});

type Kyc = {
  id: string;
  real_name: string;
  id_card_no: string;
  bank_name: string;
  bank_account: string;
  bank_branch: string | null;
  phone: string | null;
  remark: string | null;
  created_at: string;
};

function maskId(s: string) {
  if (!s) return "";
  if (s.length <= 6) return s;
  return s.slice(0, 4) + "********" + s.slice(-4);
}
function maskCard(s: string) {
  if (!s) return "";
  if (s.length <= 6) return s;
  return s.slice(0, 4) + " **** **** " + s.slice(-4);
}

function Inner() {
  const { user } = useAuth();
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    real_name: "",
    id_card_no: "",
    bank_name: "",
    bank_account: "",
    bank_branch: "",
    phone: "",
  });

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("user_kyc")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) reportRpcError(error, { op: "user_kyc.select", scope: "ProfileKyc" });
    setKyc((data as Kyc) ?? null);
    setLoading(false);
  };
  useEffect(() => { load(); }, [user?.id]);

  const submit = async () => {
    if (!user) return;
    if (!form.real_name.trim()) return toast.error("请填写真实姓名");
    if (!/^\d{15}$|^\d{17}[\dxX]$/.test(form.id_card_no.trim())) return toast.error("身份证号格式不正确");
    if (!form.bank_name.trim()) return toast.error("请填写开户银行");
    if (!/^\d{10,25}$/.test(form.bank_account.replace(/\s/g, ""))) return toast.error("银行卡号格式不正确");
    setSubmitting(true);
    const { error } = await supabase.from("user_kyc").insert({
      user_id: user.id,
      real_name: form.real_name.trim(),
      id_card_no: form.id_card_no.trim().toUpperCase(),
      bank_name: form.bank_name.trim(),
      bank_account: form.bank_account.replace(/\s/g, ""),
      bank_branch: form.bank_branch.trim() || null,
      phone: form.phone.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      reportRpcError(error, { op: "user_kyc.insert", scope: "ProfileKyc" });
      toast.error(error.message || "提交失败");
      return;
    }
    toast.success("实名绑定成功");
    load();
  };

  if (loading) {
    return (
      <div className="h5-shell"><PageHeader title="实名绑定" />
        <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (kyc) {
    return (
      <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
        <PageHeader title="实名信息" />
        <div className="m-3 rounded-2xl p-5 text-white" style={{ background: "var(--gradient-orange)" }}>
          <div className="flex items-center gap-2 text-sm opacity-90">
            <ShieldCheck className="h-4 w-4" /> 已实名绑定
          </div>
          <div className="mt-2 text-xl font-bold">{kyc.real_name}</div>
          <div className="text-xs opacity-80 mt-1">绑定后不可自行修改，如需变更请联系管理员</div>
        </div>
        <div className="bg-card mx-3 rounded-2xl p-4 space-y-3 text-sm">
          <Row label="身份证号" value={maskId(kyc.id_card_no)} />
          <Row label="开户银行" value={kyc.bank_name} />
          <Row label="银行卡号" value={maskCard(kyc.bank_account)} />
          {kyc.bank_branch && <Row label="开户支行" value={kyc.bank_branch} />}
          {kyc.phone && <Row label="预留手机号" value={kyc.phone} />}
        </div>
        <div className="mx-3 mt-4 flex items-center justify-center text-xs text-muted-foreground gap-1">
          <Lock className="h-3.5 w-3.5" /> 信息已锁定
        </div>
      </div>
    );
  }

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="实名绑定" />
      <div className="m-3 rounded-2xl bg-warning/10 border border-warning/30 p-3 text-xs text-warning-foreground">
        提示：实名信息用于提现转账，<b>提交后不可自行修改</b>，如需变更请联系平台管理员。请仔细核对后再提交。
      </div>
      <div className="bg-card mx-3 rounded-2xl p-4 space-y-3">
        <Field label="真实姓名" value={form.real_name} onChange={(v) => setForm({ ...form, real_name: v })} placeholder="与身份证一致" />
        <Field label="身份证号" value={form.id_card_no} onChange={(v) => setForm({ ...form, id_card_no: v })} placeholder="18 位身份证号码" />
        <Field label="开户银行" value={form.bank_name} onChange={(v) => setForm({ ...form, bank_name: v })} placeholder="例如：中国工商银行" />
        <Field label="银行卡号" value={form.bank_account} onChange={(v) => setForm({ ...form, bank_account: v })} placeholder="持卡人本人储蓄卡号" />
        <Field label="开户支行" value={form.bank_branch} onChange={(v) => setForm({ ...form, bank_branch: v })} placeholder="选填，例如：上海浦东支行" />
        <Field label="预留手机号" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="选填" />
      </div>
      <div className="mx-3 mt-4">
        <Button className="w-full" disabled={submitting} onClick={submit}>
          {submitting ? "提交中…" : "确认绑定（不可修改）"}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
