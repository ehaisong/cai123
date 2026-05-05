import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";

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

  useEffect(() => {
    if (!user) { navigate({ to: "/auth/login" }); return; }
    supabase.from("profiles").select("phone").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        const p = data?.phone ?? null;
        setCurrentPhone(p);
        if (p) setPhone(p);
      });
    // 账号是否已设置密码（user_metadata 标记）
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
    if (!phoneValid) { toast.error("请输入正确的手机号"); return; }
    setSending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string; sid?: string }>("sms-send", { body: { phone, sid } });
      if (error || !res?.ok) { toast.error(res?.message ?? error?.message ?? "发送失败"); return; }
      if (res.sid) setSid(res.sid);
      toast.success("验证码已发送");
      setCooldown(60);
    } finally { setSending(false); }
  };

  const handleBind = async () => {
    if (!phoneValid) { toast.error("请输入正确的手机号"); return; }
    if (!codeValid) { toast.error("请输入 6 位验证码"); return; }
    if (!sid) { toast.error("请先获取验证码"); return; }
    if (setPwd) {
      if (password.length < 6) { toast.error("密码至少 6 位"); return; }
      if (password !== password2) { toast.error("两次输入的密码不一致"); return; }
    }
    setSubmitting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("sms-verify", {
        body: { phone, code, sid, mode: "bind", password: setPwd ? password : undefined },
      });
      if (error || !res?.ok) { toast.error(res?.message ?? error?.message ?? "绑定失败"); return; }
      // 同步刷新本地 user 元数据
      if (setPwd) {
        try { await supabase.auth.updateUser({ data: { has_password: true } }); } catch { /* noop */ }
      }
      toast.success(setPwd ? "已绑定手机号并设置密码，可使用手机号+密码登录" : "已绑定手机号");
      navigate({ to: "/profile" });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="手机绑定" />
      <div className="px-4 py-6 space-y-5">
        {/* 当前状态卡 */}
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
          <Input type="tel" inputMode="numeric" placeholder="请输入手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} />
        </div>

        <div className="space-y-2">
          <Label>验证码</Label>
          <div className="flex gap-2">
            <Input type="text" inputMode="numeric" placeholder="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            <Button type="button" variant="outline" onClick={handleSend}
              disabled={sending || cooldown > 0 || !phoneValid}
              className="shrink-0">
              {sending ? "发送中…" : cooldown > 0 ? `${cooldown}s` : "获取验证码"}
            </Button>
          </div>
        </div>

        {/* 密码区 */}
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
