import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { signInAsDemo } from "@/lib/demo-login";
import { Sparkles } from "lucide-react";

const searchSchema = z.object({ ref: z.string().optional(), redirect: z.string().optional() });

export const Route = createFileRoute("/auth/login")({
  validateSearch: searchSchema,
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth/login" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) {
      toast.error("请填写邮箱与密码");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { nickname }, emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        // 绑定推荐
        if (search.ref && data.user) {
          // wait a bit for trigger
          await new Promise((r) => setTimeout(r, 300));
          await supabase.rpc("bind_referrer", { _agent_code: search.ref });
        }
        toast.success("注册成功，已自动登录");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("登录成功");
      }
      navigate({ to: search.redirect ?? "/" });
    } catch (e: any) {
      toast.error(e.message ?? "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted">
      <div className="px-6 pt-16 pb-8">
        <h1 className="text-2xl font-bold text-foreground">数据科学入门指南</h1>
        <p className="mt-1 text-sm text-muted-foreground">专业内容分析平台</p>
      </div>
      <Card className="mx-4 p-5">
        <div className="mb-4 flex gap-4 border-b border-border">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`pb-2 text-sm ${mode === m ? "border-b-2 border-primary text-primary font-medium" : "text-muted-foreground"}`}
            >
              {m === "signin" ? "登录" : "注册"}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">邮箱</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {mode === "signup" && (
            <div>
              <Label className="text-xs text-muted-foreground">昵称</Label>
              <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="请输入昵称" />
            </div>
          )}
          <div>
            <Label className="text-xs text-muted-foreground">密码</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" />
          </div>
          {search.ref && (
            <p className="text-xs text-info">推荐人/店铺码：{search.ref}</p>
          )}
          <Button className="w-full" onClick={submit} disabled={loading}>
            {loading ? "处理中…" : mode === "signin" ? "立即登录" : "注册并登录"}
          </Button>

          <div className="relative my-1 text-center">
            <span className="px-2 text-[11px] text-muted-foreground bg-card relative z-10">或</span>
            <div className="absolute inset-x-0 top-1/2 h-px bg-border -z-0" />
          </div>

          <Button
            variant="outline"
            className="w-full"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await signInAsDemo();
                toast.success("已登录 Demo 账号");
                navigate({ to: search.redirect ?? "/" });
              } catch (e: any) {
                toast.error(e?.message ?? "Demo 登录失败");
              } finally {
                setLoading(false);
              }
            }}
          >
            <Sparkles className="w-4 h-4 mr-2 text-warning" />
            使用 Demo 账号一键登录
          </Button>

          <p className="text-center text-[11px] text-muted-foreground">
            微信扫码登录即将上线
          </p>

          <p className="text-center text-xs text-muted-foreground">
            <Link to="/" className="text-info">返回首页</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
