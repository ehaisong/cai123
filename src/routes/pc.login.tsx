import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/pc/login")({
  component: PcLogin,
  head: () => ({
    meta: [
      { title: "PC 管理后台登录" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function PcLogin() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // 已登录直接跳转
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) navigate({ to: "/pc" });
    });
    return () => { active = false; };
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || !password) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("phone-password-login", {
        body: { phone: phone.trim(), password },
      });
      if (error || !data?.ok) {
        toast.error(data?.message || error?.message || "登录失败");
        return;
      }
      const { error: sErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sErr) { toast.error(sErr.message); return; }
      toast.success("登录成功");
      navigate({ to: "/pc" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/40 via-background to-muted/20 px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-card rounded-2xl border border-border shadow-lg p-8 space-y-5">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">PC 管理后台</h1>
          <p className="text-xs text-muted-foreground">仅限管理员账号登录</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">手机号</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="请输入手机号" autoComplete="username" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">密码</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" autoComplete="current-password" />
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "登录中…" : "登录"}
        </Button>
      </form>
    </div>
  );
}
