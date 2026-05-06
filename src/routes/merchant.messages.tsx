import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RouteGuard } from "@/components/route-guard";
import { MerchantBottomNav } from "@/components/h5/merchant-bottom-nav";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { Send } from "lucide-react";

export const Route = createFileRoute("/merchant/messages")({
  component: () => (
    <RouteGuard title="消息群发" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="消息群发" />
      <main className="flex-1 px-3 py-3">
        <Tabs defaultValue="bcast" className="w-full">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="bcast">群发</TabsTrigger>
            <TabsTrigger value="dm">私信</TabsTrigger>
          </TabsList>
          <TabsContent value="bcast"><BroadcastPanel /></TabsContent>
          <TabsContent value="dm"><DMPanel /></TabsContent>
        </Tabs>
      </main>
      <MerchantBottomNav />
    </div>
  );
}

function BroadcastPanel() {
  const [audience, setAudience] = useState<"all" | "agents" | "customers">("all");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!title.trim()) { toast.error("请填写标题"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("merchant_broadcast", { _title: title.trim(), _content: content.trim() || null, _audience: audience });
    setBusy(false);
    if (error) { reportRpcError(error, { op: "rpc:merchant_broadcast", scope: "MerchantBroadcast" }); toast.error(error.message); return; }
    toast.success(`已发送给 ${data} 个用户`);
    setTitle(""); setContent("");
  };

  return (
    <div className="bg-card rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" /><h3 className="text-sm font-medium">群发本店用户</h3></div>
      <div>
        <label className="text-xs">收件人</label>
        <select className="w-full mt-1 h-9 rounded-md border border-border bg-background px-3 text-sm" value={audience} onChange={(e) => setAudience(e.target.value as any)}>
          <option value="all">本店全部用户（代理 + 客户）</option>
          <option value="agents">本店全部代理</option>
          <option value="customers">本店全部客户</option>
        </select>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
      <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容（可选）" />
      <Button className="w-full" disabled={busy} onClick={send}>{busy ? "发送中…" : "立即发送"}</Button>
      <p className="text-xs text-muted-foreground">仅本店推广码绑定的用户可收到。</p>
    </div>
  );
}

function DMPanel() {
  const { user } = useAuth();
  const [list, setList] = useState<any[]>([]);
  const [picked, setPicked] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "agents" | "customers">("all");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: m } = await supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle();
      if (!m) return;
      const { data: ar } = await supabase.from("agent_relations")
        .select("user_id, is_agent")
        .eq("bound_merchant_id", m.id).limit(500);
      const userIds = (ar ?? []).map((r: any) => r.user_id);
      if (userIds.length === 0) { setList([]); return; }
      const { data: profs } = await supabase.from("profiles")
        .select("user_id, user_code, nickname, phone")
        .in("user_id", userIds);
      const byId: Record<string, any> = {};
      (profs ?? []).forEach((p: any) => { byId[p.user_id] = p; });
      setList((ar ?? []).map((r: any) => ({ ...byId[r.user_id], is_agent: r.is_agent })).filter((r: any) => r.user_id));
    })();
  }, [user?.id]);

  const filtered = list.filter((r) => filter === "all" || (filter === "agents" ? r.is_agent : !r.is_agent));

  const send = async () => {
    if (!picked) { toast.error("请选择收件人"); return; }
    if (!title.trim()) { toast.error("请填写标题"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("merchant_send_message", { _user_id: picked.user_id, _title: title.trim(), _content: content.trim() || null });
    setBusy(false);
    if (error) { reportRpcError(error, { op: "rpc:merchant_send_message", scope: "MerchantDM" }); toast.error(error.message); return; }
    toast.success("已发送");
    setTitle(""); setContent("");
  };

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-md p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">本店用户</h3>
          <select className="text-xs h-7 rounded border border-border bg-background px-2" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="all">全部</option>
            <option value="agents">代理</option>
            <option value="customers">客户</option>
          </select>
        </div>
        <div className="space-y-1 max-h-60 overflow-auto">
          {filtered.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">暂无绑定用户</p>}
          {filtered.map((u) => (
            <button key={u.user_id} onClick={() => setPicked(u)} className={`w-full text-left text-sm p-2 rounded flex justify-between ${picked?.user_id===u.user_id ? "bg-primary/10" : "hover:bg-muted"}`}>
              <span>{u.nickname ?? u.user_code}</span>
              <span className="text-xs text-muted-foreground">{u.is_agent ? "代理" : "客户"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="bg-card rounded-md p-4 space-y-3">
        <div className="text-sm">收件人：{picked ? (picked.nickname ?? picked.user_code) : "未选择"}</div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
        <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容（可选）" />
        <Button className="w-full" disabled={busy || !picked} onClick={send}>{busy ? "发送中…" : "发送"}</Button>
      </div>
    </div>
  );
}
