import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Store } from "lucide-react";
import { toast } from "sonner";
import { reportRpcError } from "@/lib/error-logger";

export const Route = createFileRoute("/agent/merchants")({
  component: AgentMerchantsGuarded,
});

function AgentMerchantsGuarded() {
  return (
    <RouteGuard title="多商家管理" roles={["agent"]} forbiddenText="此页面仅限代理访问">
      <AgentMerchants />
    </RouteGuard>
  );
}

interface Row {
  merchant_id: string;
  shop_name: string;
  shop_avatar_url: string | null;
  status: string;
  is_active: boolean;
  bound_at: string;
}

function AgentMerchants() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sid, setSid] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  const [confirmSwitch, setConfirmSwitch] = useState<Row | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("agent_my_bound_merchants");
    if (error) reportRpcError(error, { op: "rpc:agent_my_bound_merchants", scope: "AgentMerchants" });
    setRows((data as Row[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { if (user) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    if (!/^1\d{10}$/.test(phone)) { toast.error("请输入正确的商家手机号"); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("sms-send", { body: { phone, sid: sid || undefined } });
    setSending(false);
    if (error || !data?.ok) {
      toast.error((data?.message ?? error?.message) || "发送失败");
      return;
    }
    setSid(data.sid);
    setCooldown(data.cooldown ?? 60);
    toast.success("验证码已发送");
  };

  const submitBind = async () => {
    if (!/^1\d{10}$/.test(phone)) { toast.error("请输入正确的商家手机号"); return; }
    if (!/^\d{4,8}$/.test(code)) { toast.error("请输入验证码"); return; }
    if (!sid) { toast.error("请先获取验证码"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("agent-bind-merchant", {
      body: { phone, code, sid },
    });
    setBusy(false);
    if (error || !data?.ok) {
      toast.error((data?.message ?? error?.message) || "绑定失败");
      return;
    }
    toast.success("绑定成功");
    setAddOpen(false);
    setPhone(""); setCode(""); setSid(""); setCooldown(0);
    load();
  };

  const doSwitch = async (m: Row) => {
    setBusy(true);
    const { error } = await supabase.rpc("agent_switch_active_merchant", { _merchant_id: m.merchant_id });
    setBusy(false); setConfirmSwitch(null);
    if (error) { reportRpcError(error, { op: "rpc:agent_switch_active_merchant" }); toast.error(error.message ?? "切换失败"); return; }
    toast.success(`已切换到 ${m.shop_name}`);
    load();
  };
  const doUnbind = async (m: Row) => {
    setBusy(true);
    const { error } = await supabase.rpc("agent_unbind_merchant", { _merchant_id: m.merchant_id });
    setBusy(false); setConfirmUnbind(null);
    if (error) { reportRpcError(error, { op: "rpc:agent_unbind_merchant" }); toast.error(error.message ?? "解绑失败"); return; }
    toast.success("已解绑");
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader title="多商家管理" />

      <div className="px-3 pt-3 pb-1 text-xs text-muted-foreground">已绑定商家</div>

      <div className="px-3 space-y-2 flex-1">
        {loading && <p className="text-center py-10 text-sm text-muted-foreground">加载中…</p>}
        {!loading && rows.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <Store className="h-10 w-10 mx-auto mb-2 opacity-40" />
            还没有绑定商家，点击右下角 + 添加
          </div>
        )}
        {rows.map((m) => (
          <div key={m.merchant_id} className="bg-card rounded-2xl p-3 flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-muted overflow-hidden shrink-0">
              {m.shop_avatar_url
                ? <img src={m.shop_avatar_url} alt={m.shop_name} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Store className="h-5 w-5" /></div>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{m.shop_name}</div>
              <div className="mt-0.5">
                {m.is_active
                  ? <span className="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded">当前活跃</span>
                  : <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">已绑定</span>}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm"
                variant={m.is_active ? "secondary" : "default"}
                disabled={busy || m.is_active}
                onClick={() => setConfirmSwitch(m)}
              >
                {m.is_active ? "已激活" : "切换"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || m.is_active}
                onClick={() => setConfirmUnbind(m)}
              >
                解绑
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* FAB 添加 */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:opacity-80"
        aria-label="添加商家"
      >
        <Plus className="h-7 w-7" />
      </button>

      {/* 添加对话框 */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setPhone(""); setCode(""); setSid(""); setCooldown(0); } }}>
        <DialogContent className="max-w-[360px]">
          <DialogHeader>
            <DialogTitle>绑定商家账号</DialogTitle>
            <DialogDescription>输入商家注册手机号，验证码将发送到该手机</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs text-muted-foreground">手机号</label>
              <Input
                inputMode="numeric"
                maxLength={11}
                placeholder="请输入商家手机号"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">验证码</label>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="请输入验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                <Button variant="outline" disabled={sending || cooldown > 0} onClick={sendCode} className="shrink-0">
                  {cooldown > 0 ? `${cooldown}s` : sending ? "发送中…" : "获取验证码"}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={busy}>取消</Button>
            <Button onClick={submitBind} disabled={busy}>{busy ? "绑定中…" : "确认绑定"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 切换确认 */}
      <AlertDialog open={!!confirmSwitch} onOpenChange={(o) => !o && setConfirmSwitch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换活跃商家</AlertDialogTitle>
            <AlertDialogDescription>
              切换后，您的推广二维码与分成都将归属到「{confirmSwitch?.shop_name}」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); confirmSwitch && doSwitch(confirmSwitch); }}>
              确认切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 解绑确认 */}
      <AlertDialog open={!!confirmUnbind} onOpenChange={(o) => !o && setConfirmUnbind(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解绑商家</AlertDialogTitle>
            <AlertDialogDescription>
              确认解绑「{confirmUnbind?.shop_name}」？该商家将不再出现在你的列表中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); confirmUnbind && doUnbind(confirmUnbind); }}>
              确认解绑
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
