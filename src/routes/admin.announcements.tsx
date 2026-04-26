import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Megaphone, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/announcements")({
  component: () => (
    <RouteGuard title="公告管理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
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
    toast.success("已更新");
    load();
  };
  const remove = async (a: any) => {
    if (!confirm("确认删除该公告？")) return;
    const { error } = await supabase.from("announcements").delete().eq("id", a.id);
    if (error) { reportRpcError(error, { op: "announcements.delete", scope: "AdminAnnouncements" }); return; }
    toast.success("已删除");
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="公告管理" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <div className="bg-card rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">发布新公告</h3>
          </div>
          <div><label className="text-xs">标题</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：节日维护通知" /></div>
          <div>
            <label className="text-xs">内容</label>
            <textarea className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[100px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder="详情说明（可选）" />
          </div>
          <Button className="w-full" disabled={saving} onClick={submit}>{saving ? "发布中…" : "立即发布"}</Button>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground px-1">历史公告</h3>
          {list.length === 0 && <p className="text-center py-6 text-sm text-muted-foreground">暂无公告</p>}
          {list.map((a) => (
            <div key={a.id} className="bg-card rounded-md p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium truncate">{a.title}</div>
                <span className={`text-xs px-2 py-0.5 rounded ${a.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {a.is_active ? "上架中" : "已下架"}
                </span>
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
      </main>
    </div>
  );
}
