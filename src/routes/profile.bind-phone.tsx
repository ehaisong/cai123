import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/profile.bind-phone")({
  component: BindPhonePage,
});

function BindPhonePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sid, setSid] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!user) { navigate({ to: "/auth/login" }); return; }
    supabase.from("profiles").select("phone").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCurrentPhone(data?.phone ?? null));
  }, [user?.id]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const phoneValid = /^1\d{10}$/.test(phone);

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
    if (!/^\d{6}$/.test(code)) { toast.error("请输入 6 位验证码"); return; }
    if (!sid) { toast.error("请先获取验证码"); return; }
    if (password && password.length < 6) { toast.error("密码至少 6 位"); return; }
    setSubmitting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{ ok: boolean; message?: string }>("sms-verify", {
        body: { phone, code, sid, mode: "bind", password: password || undefined },
      });
      if (error || !res?.ok) { toast.error(res?.message ?? error?.message ?? "绑定失败"); return; }
      toast.success(password ? "已绑定手机号并设置密码" : "已绑定手机号");
      navigate({ to: "/profile" });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="手机号绑定" />
      <div className="px-4 py-6 space-y-5">
        {currentPhone && (
          <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            当前已绑定手机号：<span className="font-medium text-foreground">{currentPhone}</span>
            <p className="mt-1 text-xs">重新绑定将覆盖原手机号</p>
          </div>
        )}

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

        <div className="space-y-2">
          <Label>设置登录密码（选填，≥6 位）</Label>
          <Input type="password" placeholder="留空则不设置密码"
            value={password}
            onChange={(e) => setPassword(e.target.value.slice(0, 64))} />
          <p className="text-xs text-muted-foreground">设置后可使用「商家登录 - 密码登录」直接登录</p>
        </div>

        <Button className="w-full" size="lg" onClick={handleBind}
          disabled={submitting || !phoneValid || code.length !== 6}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认绑定"}
        </Button>
      </div>
    </div>
  );
}
