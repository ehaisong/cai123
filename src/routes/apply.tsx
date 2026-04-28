import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, Clock, XCircle, Store } from "lucide-react";

const searchSchema = z.object({ ref: z.string().optional() });

export const Route = createFileRoute("/apply")({
  validateSearch: searchSchema,
  component: ApplyEntry,
});

function ApplyEntry() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h5-shell">
        <PageHeader title="商家开店申请" />
        <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  return user ? <ApplyForm /> : <PhoneLogin />;
}

/* ------------------------------ Phone Login ------------------------------ */
function PhoneLogin() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const normalizePhone = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/\s|-/g, "");
    if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
    if (/^1\d{10}$/.test(trimmed)) return `+86${trimmed}`;
    return null;
  };

  const sendCode = async () => {
    const p = normalizePhone(phone);
    if (!p) { toast.error("请输入有效的手机号"); return; }
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: p });
    setSending(false);
    if (error) {
      toast.error(error.message || "发送失败，请检查短信通道是否已开通");
      return;
    }
    toast.success("验证码已发送");
    setStep("code");
    setCooldown(60);
  };

  const verifyCode = async () => {
    const p = normalizePhone(phone);
    if (!p || !code) { toast.error("请输入验证码"); return; }
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({ phone: p, token: code, type: "sms" });
    setVerifying(false);
    if (error) {
      toast.error(error.message || "验证失败");
      return;
    }
    toast.success("登录成功");
    // Auth context picks up the session and re-renders this route into ApplyForm
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted">
      <PageHeader title="商家开店申请" />
      <div className="px-6 pt-8 pb-4 text-center">
        <div className="inline-flex w-14 h-14 rounded-full bg-info/10 items-center justify-center mb-3">
          <Store className="w-7 h-7 text-info" />
        </div>
        <h1 className="text-xl font-bold">手机号登录</h1>
        <p className="mt-1 text-sm text-muted-foreground">登录后即可提交开店申请</p>
      </div>

      <Card className="mx-4 p-5 space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">手机号</Label>
          <Input
            inputMode="tel"
            placeholder="请输入手机号"
            value={phone}
            disabled={step === "code"}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {step === "code" && (
          <div>
            <Label className="text-xs text-muted-foreground">验证码</Label>
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                placeholder="6 位验证码"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <Button
                variant="outline"
                disabled={cooldown > 0 || sending}
                onClick={sendCode}
                className="whitespace-nowrap"
              >
                {cooldown > 0 ? `${cooldown}s` : "重新发送"}
              </Button>
            </div>
          </div>
        )}

        {step === "phone" ? (
          <Button className="w-full" onClick={sendCode} disabled={sending}>
            {sending ? "发送中…" : "获取验证码"}
          </Button>
        ) : (
          <Button className="w-full" onClick={verifyCode} disabled={verifying}>
            {verifying ? "验证中…" : "登录 / 注册"}
          </Button>
        )}

        {step === "code" && (
          <button
            className="w-full text-xs text-muted-foreground"
            onClick={() => { setStep("phone"); setCode(""); }}
          >
            修改手机号
          </button>
        )}

        <p className="text-[11px] text-muted-foreground text-center">
          未注册的手机号将自动创建账号
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------ Apply Form ------------------------------ */
function ApplyForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState("");
  const [existing, setExisting] = useState<any>(null);
  const [merchant, setMerchant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [appRes, mRes] = await Promise.all([
      supabase
        .from("merchant_applications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("merchants").select("id, shop_name, status").eq("user_id", user.id).maybeSingle(),
    ]);
    setExisting(appRes.data);
    setMerchant(mRes.data);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const submit = async () => {
    if (!user) return;
    const name = shopName.trim();
    if (name.length < 2) { toast.error("请输入店铺名称（至少 2 个字）"); return; }
    setSubmitting(true);
    const { error } = await supabase.from("merchant_applications").insert({
      user_id: user.id,
      shop_name: name,
      phone: user.phone ?? null,
      real_name: name, // 占位，后续完善资料向导补齐
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("申请已提交，请等待审核");
    load();
  };

  if (loading) {
    return (
      <div className="h5-shell">
        <PageHeader title="商家开店申请" />
        <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  // 已经是审核通过的商家
  if (merchant && merchant.status === "approved") {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="商家开店申请" />
        <Card className="m-4 p-6 text-center space-y-4">
          <div className="inline-flex w-14 h-14 rounded-full bg-success/10 items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-bold">店铺已开通</h2>
            <p className="text-sm text-muted-foreground mt-1">「{merchant.shop_name}」</p>
          </div>
          <Button className="w-full" onClick={() => navigate({ to: "/merchant" })}>
            进入商家后台
          </Button>
        </Card>
      </div>
    );
  }

  const status = existing?.status as "pending" | "approved" | "rejected" | undefined;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家开店申请" />

      {status === "pending" && (
        <Card className="m-4 p-5 text-center space-y-2 bg-warning/5 border-warning/30">
          <Clock className="w-10 h-10 text-warning mx-auto" />
          <h2 className="font-bold">审核中</h2>
          <p className="text-sm text-muted-foreground">
            您已提交「{existing.shop_name ?? existing.real_name}」的开店申请，
            <br />正在等待管理员审核，请稍后再来查看。
          </p>
          <p className="text-xs text-muted-foreground">手机号：{user?.phone ?? existing.phone ?? "—"}</p>
        </Card>
      )}

      {status === "approved" && !merchant && (
        <Card className="m-4 p-5 text-center space-y-2 bg-success/5 border-success/30">
          <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
          <h2 className="font-bold">审核已通过</h2>
          <p className="text-sm text-muted-foreground">即将为您开通商家后台…</p>
          <Button className="w-full mt-2" onClick={() => navigate({ to: "/merchant" })}>
            进入商家后台
          </Button>
        </Card>
      )}

      {status === "rejected" && (
        <Card className="m-4 p-5 space-y-2 bg-destructive/5 border-destructive/30">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-destructive" />
            <h2 className="font-bold">申请被驳回</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            驳回理由：{existing.reject_reason ?? "未填写"}
          </p>
          <p className="text-xs text-muted-foreground">您可以修改店铺名称后重新提交。</p>
        </Card>
      )}

      {(!status || status === "rejected") && (
        <Card className="mx-4 mt-4 p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold">填写店铺信息</h2>
            <p className="text-xs text-muted-foreground mt-1">
              提交后管理员将在后台审核您的申请，审核通过后即可登录商家后台。
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">店铺名称</Label>
            <Input
              placeholder="请输入店铺名称"
              value={shopName}
              maxLength={30}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            申请人手机号：<span className="text-foreground">{user?.phone ?? "—"}</span>
          </div>

          <Button className="w-full" onClick={submit} disabled={submitting}>
            {submitting ? "提交中…" : "提交申请"}
          </Button>
        </Card>
      )}

      <div className="mt-auto px-4 py-6 text-center text-[11px] text-muted-foreground">
        提交即代表同意《商家入驻协议》
      </div>
    </div>
  );
}
