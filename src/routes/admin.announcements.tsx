import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Megaphone, Trash2, Send } from "lucide-react";

export const Route = createFileRoute("/admin/announcements")({
  component: () => (
    <RouteGuard title="消息管理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="消息管理" />
      <main className="flex-1 px-3 py-3">
        <Tabs defaultValue="ann" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="ann">公告</TabsTrigger>
            <TabsTrigger value="bcast">群发</TabsTrigger>
            <TabsTrigger value="dm">私信</TabsTrigger>
          </TabsList>
          <TabsContent value="ann"><AnnPanel /></TabsContent>
          <TabsContent value="bcast"><BroadcastPanel /></TabsContent>
          <TabsContent value="dm"><DMPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function AnnPanel() {
  const [list, setList] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("announcements").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) { reportRpcError(error, { op: "announcements.select", scope: "AdminAnnouncements" }); return; }
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!title.trim()) { toast.error("请填写标题"); return; }
    setSaving(true);
    const { error } = await supabase.from("announcements").insert({ title: title.trim(), content: content.trim() || null, is_active: true });
    setSaving(false);
    if (error) { reportRpcError(error, { op: "announcements.insert", scope: "AdminAnnouncements" }); return; }
    toast.success("已发布，所有用户将收到通知");
    setTitle(""); setContent("");
    load();
  };

  const toggleActive = async (a: any) => {
    const { error } = await supabase.from("announcements").update({ is_active: !a.is_active }).eq("id", a.id);
    if (error) { reportRpcError(error, { op: "announcements.update", scope: "AdminAnnouncements" }); return; }
    load();
  };
  const remove = async (a: any) => {
    if (!confirm("确认删除该公告？")) return;
    const { error } = await supabase.from("announcements").delete().eq("id", a.id);
    if (error) { reportRpcError(error, { op: "announcements.delete", scope: "AdminAnnouncements" }); return; }
    load();
  };

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-md p-4 space-y-3">
        <div className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" /><h3 className="text-sm font-medium">发布新公告（推送给全部用户）</h3></div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
        <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder="详情说明（可选）" />
        <Button className="w-full" disabled={saving} onClick={submit}>{saving ? "发布中…" : "立即发布"}</Button>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs text-muted-foreground px-1">历史公告</h3>
        {list.length === 0 && <p className="text-center py-6 text-sm text-muted-foreground">暂无公告</p>}
        {list.map((a) => (
          <div key={a.id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">{a.title}</div>
              <span className={`text-xs px-2 py-0.5 rounded ${a.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{a.is_active ? "上架中" : "已下架"}</span>
            </div>
            {a.content && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{a.content}</p>}
            <div className="text-xs text-muted-foreground mt-1">{fmtDate(a.created_at)}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => toggleActive(a)}>{a.is_active ? "下架" : "上架"}</Button>
              <Button size="sm" variant="outline" onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BroadcastPanel() {
  const [audience, setAudience] = useState<"all" | "merchants" | "agents">("all");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!title.trim()) { toast.error("请填写标题"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_broadcast", { _title: title.trim(), _content: content.trim() || null, _audience: audience });
    setBusy(false);
    if (error) { reportRpcError(error, { op: "rpc:admin_broadcast", scope: "AdminBroadcast" }); toast.error(error.message); return; }
    toast.success(`已发送给 ${data} 个用户`);
    setTitle(""); setContent("");
  };

  return (
    <div className="bg-card rounded-md p-4 space-y-3">
      <div className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" /><h3 className="text-sm font-medium">群发消息</h3></div>
      <div>
        <label className="text-xs">收件人</label>
        <select className="w-full mt-1 h-9 rounded-md border border-border bg-background px-3 text-sm" value={audience} onChange={(e) => setAudience(e.target.value as any)}>
          <option value="all">全部用户</option>
          <option value="merchants">全部商家</option>
          <option value="agents">全部代理</option>
        </select>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
      <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容（可选）" />
      <Button className="w-full" disabled={busy} onClick={send}>{busy ? "发送中…" : "立即发送"}</Button>
    </div>
  );
}

function DMPanel() {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [picked, setPicked] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const doSearch = async () => {
    if (!search.trim()) { setUsers([]); return; }
    const kw = search.trim();
    const { data } = await supabase.from("profiles")
      .select("user_id, user_code, nickname, phone")
      .or(`user_code.ilike.%${kw}%,nickname.ilike.%${kw}%,phone.ilike.%${kw}%`)
      .limit(20);
    setUsers(data ?? []);
  };

  const send = async () => {
    if (!picked) { toast.error("请选择收件人"); return; }
    if (!title.trim()) { toast.error("请填写标题"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("admin_send_message", { _user_id: picked.user_id, _title: title.trim(), _content: content.trim() || null });
    setBusy(false);
    if (error) { reportRpcError(error, { op: "rpc:admin_send_message", scope: "AdminDM" }); toast.error(error.message); return; }
    toast.success("已发送");
    setTitle(""); setContent("");
  };

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-md p-4 space-y-2">
        <h3 className="text-sm font-medium">查找用户</h3>
        <div className="flex gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="编号 / 昵称 / 手机" />
          <Button onClick={doSearch}>搜索</Button>
        </div>
        <div className="space-y-1">
          {users.map((u) => (
            <button key={u.user_id} onClick={() => setPicked(u)} className={`w-full text-left text-sm p-2 rounded ${picked?.user_id===u.user_id ? "bg-primary/10" : "hover:bg-muted"}`}>
              {u.nickname ?? u.user_code} <span className="text-xs text-muted-foreground">{u.phone ?? ""}</span>
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
