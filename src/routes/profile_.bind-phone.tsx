import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, Lock } from "lucide-react";

export const Route = createFileRoute("/profile_/bind-phone")({
  component: BindPhonePage,
});

/** 任意输入 → 11 位中国本地手机号（去除 +、空格、86 前缀）。失败返回空串 */
function normalizeCN(input: string | null | undefined): string {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  return /^1\d{10}$/.test(local) ? local : local.slice(0, 11);
}

function BindPhonePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [boundPhone, setBoundPhone] = useState<string>(""); // 已绑定的本地 11 位
  const [hasPassword, setHasPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [sid, setSid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) { navigate({ to: "/auth/login" }); return; }
    supabase.from("profiles").select("phone").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        const local = normalizeCN(data?.phone);
        setBoundPhone(local.length === 11 ? local : "");
        setPhone(local);
      });
    setHasPassword(Boolean(user.user_metadata?.has_password));
  }, [user?.id]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 始终用归一化后的值参与校验
  const localPhone = normalizeCN(phone);
  const phoneValid = /^1\d{10}$/.test(localPhone);
  const codeValid = /^\d{6}$/.test(code);
  const pwdValid = password.length >= 6 && password === password2;
  const isLocked = !!boundPhone; // 已绑定 → 手机号只读

  const handleSend = async () => {
    if (!phoneValid) { toast.error("请输入正确的 11 位手机号"); return; }
    setSending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string; sid?: string; cooldown?: number }>(
        "sms-send", { body: { phone: localPhone, sid } });
      if (error || !res?.ok) {
        toast.error(res?.message ?? error?.message ?? "发送失败，请稍后重试");
        return;
      }
      if (res.sid) setSid(res.sid);
      setCodeSent(true);
      toast.success(`验证码已发送至 ${localPhone.slice(0, 3)}****${localPhone.slice(-4)}`);
      setCooldown(res.cooldown ?? 60);
      setTimeout(() => codeInputRef.current?.focus(), 80);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "网络异常");
    } finally { setSending(false); }
  };

  const handleSubmit = async () => {
    if (!phoneValid) { toast.error("请输入正确的手机号"); return; }
    if (!sid) { toast.error("请先点击「获取验证码」"); return; }
    if (!codeValid) { toast.error("请输入 6 位验证码"); codeInputRef.current?.focus(); return; }
    if (password.length < 6) { toast.error("密码至少 6 位"); return; }
    if (password !== password2) { toast.error("两次输入的密码不一致"); return; }

    setSubmitting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("sms-verify", {
        body: { phone: localPhone, code, sid, mode: "bind", password },
      });
      if (error || !res?.ok) {
        const msg = res?.message ?? error?.message ?? "提交失败";
        toast.error(msg);
        if (/会话|过期/.test(msg)) { setSid(null); setCodeSent(false); setCooldown(0); }
        if (/验证码|过期|会话/.test(msg)) { setCode(""); codeInputRef.current?.focus(); }
        return;
      }
      try { await supabase.auth.updateUser({ data: { has_password: true } }); } catch { /* noop */ }
      toast.success(isLocked ? "登录密码已设置" : "已绑定手机号并设置密码");
      navigate({ to: "/profile" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "网络异常");
    } finally { setSubmitting(false); }
  };

  const onCodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !submitting) { e.preventDefault(); void handleSubmit(); }
  };

  const title = isLocked ? (hasPassword ? "重设登录密码" : "设置登录密码") : "绑定手机号";

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title={title} />
      <div className="px-4 py-6 space-y-5">
        {/* 状态卡片 */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">当前手机号</span>
            <span className="font-medium">
              {boundPhone ? `${boundPhone.slice(0, 3)}****${boundPhone.slice(-4)}` : <span className="text-warning">未绑定</span>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">登录密码</span>
            <span className="font-medium">
              {hasPassword
                ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" />已设置</span>
                : <span className="text-warning">未设置</span>}
            </span>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            完成后可在登录页使用「手机号 + 密码」直接登录。
          </p>
        </div>

        {/* 手机号 */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            手机号 {isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
          </Label>
          <Input
            type="tel"
            inputMode="numeric"
            placeholder="请输入手机号"
            value={phone}
            readOnly={isLocked}
            onChange={(e) => {
              // 实时归一化：去非数字、剥 86 前缀、限制 11 位
              const raw = e.target.value;
              const digits = raw.replace(/\D/g, "");
              const local = digits.startsWith("86") ? digits.slice(2) : digits;
              setPhone(local.slice(0, 11));
            }}
            className={isLocked ? "bg-muted" : ""}
          />
          {!phoneValid && phone.length > 0 && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />请输入正确的 11 位手机号
            </p>
          )}
        </div>

        {/* 验证码 */}
        <div className="space-y-2">
          <Label>验证码</Label>
          <div className="flex gap-2">
            <Input
              ref={codeInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 位短信验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={onCodeKeyDown}
              className="tracking-widest"
            />
            <Button
              type="button"
              variant={codeSent && cooldown === 0 ? "default" : "outline"}
              onClick={handleSend}
              disabled={sending || cooldown > 0 || !phoneValid}
              className="shrink-0 min-w-[110px]"
            >
              {sending
                ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />发送中</span>
                : cooldown > 0
                  ? `${cooldown}s 后重发`
                  : codeSent ? "重新发送" : "获取验证码"}
            </Button>
          </div>
          {codeSent && cooldown > 0 && (
            <p className="text-xs text-muted-foreground">短信通常 30 秒内送达。</p>
          )}
        </div>

        {/* 密码 */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-medium">{hasPassword ? "重设登录密码" : "设置登录密码"}</div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">新密码（至少 6 位）</Label>
            <Input type="password" placeholder="请输入新密码" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value.slice(0, 64))} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">确认密码</Label>
            <Input type="password" placeholder="再输入一次" autoComplete="new-password"
              value={password2} onChange={(e) => setPassword2(e.target.value.slice(0, 64))} />
            {password2 && password !== password2 && (
              <p className="text-xs text-destructive">两次输入的密码不一致</p>
            )}
          </div>
        </div>

        {/* 提交按钮：始终可点，错误用 toast 提示 */}
        <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : (isLocked ? "确认设置密码" : "确认绑定并设置密码")}
        </Button>

        {!phoneValid || !codeValid || !pwdValid ? (
          <p className="text-xs text-muted-foreground text-center">
            {!phoneValid ? "请填写正确手机号" : !sid ? "请先获取验证码" : !codeValid ? "请输入 6 位验证码" : "请输入两次一致的密码（≥ 6 位）"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
