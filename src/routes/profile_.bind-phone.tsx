import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/profile_/bind-phone")({
  component: BindPhonePage,
});

function BindPhonePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [setPwd, setSetPwd] = useState(true);
  const [sid, setSid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) { navigate({ to: "/auth/login" }); return; }
    supabase.from("profiles").select("phone").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        const p = data?.phone ?? null;
        setCurrentPhone(p);
        if (p) setPhone(p);
      });
    setHasPassword(Boolean(user.user_metadata?.has_password));
  }, [user?.id]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const phoneValid = /^1\d{10}$/.test(phone);
  const codeValid = /^\d{6}$/.test(code);
  const pwdValid = !setPwd || (password.length >= 6 && password === password2);

  const handleSend = async () => {
    setPhoneError(null);
    if (!phoneValid) { setPhoneError("请输入正确的 11 位手机号"); return; }
    setSending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string; sid?: string; cooldown?: number }>("sms-send", { body: { phone, sid } });
      if (error || !res?.ok) {
        const msg = res?.message ?? error?.message ?? "发送失败，请稍后重试";
        setPhoneError(msg);
        toast.error(msg);
        return;
      }
      if (res.sid) setSid(res.sid);
      setCodeSent(true);
      setCodeError(null);
      toast.success(`验证码已发送至 ${phone.slice(0, 3)}****${phone.slice(-4)}`);
      setCooldown(res.cooldown ?? 60);
      setTimeout(() => codeInputRef.current?.focus(), 80);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络异常";
      setPhoneError(msg);
      toast.error(msg);
    } finally { setSending(false); }
  };

  const handleBind = async () => {
    setCodeError(null);
    if (!phoneValid) { setPhoneError("请输入正确的手机号"); return; }
    if (!sid) { setCodeError("请先获取验证码"); return; }
    if (!codeValid) { setCodeError("请输入 6 位数字验证码"); codeInputRef.current?.focus(); return; }
    if (setPwd) {
      if (password.length < 6) { toast.error("密码至少 6 位"); return; }
      if (password !== password2) { toast.error("两次输入的密码不一致"); return; }
    }
    setSubmitting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("sms-verify", {
        body: { phone, code, sid, mode: "bind", password: setPwd ? password : undefined },
      });
      if (error || !res?.ok) {
        const msg = res?.message ?? error?.message ?? "绑定失败";
        setCodeError(msg);
        // 验证码错误时清空并聚焦
        if (/验证码|过期|会话/.test(msg)) {
          setCode("");
          codeInputRef.current?.focus();
        }
        // 会话过期则要求重新获取
        if (/会话|过期/.test(msg)) {
          setSid(null);
          setCodeSent(false);
          setCooldown(0);
        }
        toast.error(msg);
        return;
      }
      if (setPwd) {
        try { await supabase.auth.updateUser({ data: { has_password: true } }); } catch { /* noop */ }
      }
      toast.success(setPwd ? "已绑定手机号并设置密码" : "已绑定手机号");
      navigate({ to: "/profile" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络异常";
      setCodeError(msg);
      toast.error(msg);
    } finally { setSubmitting(false); }
  };

  const onCodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && codeValid && pwdValid && !submitting) {
      e.preventDefault();
      void handleBind();
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="手机绑定" />
      <div className="px-4 py-6 space-y-5">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">当前手机号</span>
            <span className="font-medium">{currentPhone ?? <span className="text-warning">未绑定</span>}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">登录密码</span>
            <span className="font-medium">
              {hasPassword
                ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" />已设置</span>
                : <span className="text-warning">未设置</span>}
            </span>
          </div>
          {!hasPassword && (
            <p className="text-xs text-muted-foreground pt-1">提示：设置密码后，可在登录页使用「手机号 + 密码」直接登录。</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>手机号</Label>
          <Input
            type="tel"
            inputMode="numeric"
            placeholder="请输入手机号"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 11));
              setPhoneError(null);
            }}
            aria-invalid={!!phoneError}
            className={phoneError ? "border-destructive focus-visible:ring-destructive" : ""}
          />
          {phoneError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{phoneError}
            </p>
          )}
        </div>

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
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setCodeError(null); }}
              onKeyDown={onCodeKeyDown}
              aria-invalid={!!codeError}
              className={codeError ? "border-destructive focus-visible:ring-destructive tracking-widest" : "tracking-widest"}
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
          {codeError ? (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{codeError}
            </p>
          ) : codeSent && cooldown > 0 ? (
            <p className="text-xs text-muted-foreground">短信通常会在 30 秒内送达，请留意手机短信。</p>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium">{hasPassword ? "重设登录密码" : "同时设置登录密码"}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={setPwd}
              onChange={(e) => setSetPwd(e.target.checked)}
            />
          </label>
          {setPwd && (
            <>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">新密码（至少 6 位）</Label>
                <Input type="password" placeholder="请输入新密码" autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.slice(0, 64))} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">确认密码</Label>
                <Input type="password" placeholder="再输入一次" autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value.slice(0, 64))} />
                {password2 && password !== password2 && (
                  <p className="text-xs text-destructive">两次输入的密码不一致</p>
                )}
              </div>
            </>
          )}
        </div>

        <Button className="w-full" size="lg" onClick={handleBind}
          disabled={submitting || !phoneValid || !codeValid || !pwdValid}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (setPwd ? "确认绑定并设置密码" : "确认绑定")}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          绑定即表示同意将此手机号作为本账号的登录凭证
        </p>
      </div>
    </div>
  )
}
