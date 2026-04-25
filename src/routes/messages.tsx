import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BottomNav } from "@/components/h5/bottom-nav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import {
  Bell,
  CheckCircle2,
  Megaphone,
  Wallet as WalletIcon,
  Store,
  ClipboardList,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/messages")({
  component: MessagesPage,
});

type NotificationRow = {
  id: string;
  user_id: string;
  category: string;
  title: string;
  content: string | null;
  reference_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

type TabKey = "all" | "unread" | "merchant_review" | "withdraw" | "announcement";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "merchant_review", label: "审核" },
  { key: "withdraw", label: "提现" },
  { key: "announcement", label: "公告" },
];

const CATEGORY_META: Record<string, { label: string; icon: typeof Bell; tone: string }> = {
  merchant_review: { label: "商家审核", icon: Store, tone: "text-primary bg-primary/10" },
  withdraw: { label: "提现进度", icon: WalletIcon, tone: "text-success bg-success/10" },
  announcement: { label: "系统公告", icon: Megaphone, tone: "text-warning bg-warning/10" },
  order: { label: "订单消息", icon: ClipboardList, tone: "text-primary bg-primary/10" },
  system: { label: "系统消息", icon: Bell, tone: "text-muted-foreground bg-muted" },
};

function MessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("all");
  const [list, setList] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setList([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) {
      reportRpcError(error, { op: "notifications.select", scope: "MessagesPage" });
      return;
    }
    setList((data ?? []) as NotificationRow[]);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (tab === "all") return list;
    if (tab === "unread") return list.filter((n) => !n.is_read);
    return list.filter((n) => n.category === tab);
  }, [list, tab]);

  const unreadCount = useMemo(() => list.filter((n) => !n.is_read).length, [list]);

  const markRead = async (ids?: string[]) => {
    const { data, error } = await supabase.rpc("mark_notifications_read", {
      _ids: ids && ids.length > 0 ? ids : undefined,
    });
    if (error) {
      reportRpcError(error, { op: "rpc:mark_notifications_read", scope: "MessagesPage", payload: { ids } });
      return;
    }
    if ((data ?? 0) > 0) toast.success(`已标记 ${data} 条为已读`);
    load();
  };

  const removeOne = async (id: string) => {
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    if (error) {
      reportRpcError(error, { op: "notifications.delete", scope: "MessagesPage", payload: { id } });
      return;
    }
    setList((prev) => prev.filter((n) => n.id !== id));
  };

  const handleClick = async (n: NotificationRow) => {
    if (!n.is_read) await markRead([n.id]);
    // 跳转到对应业务页
    if (n.category === "withdraw") navigate({ to: "/wallet/transactions" });
    else if (n.category === "merchant_review") navigate({ to: "/merchant" });
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 h-12 bg-card border-b border-border flex items-center justify-between px-4">
        <h1 className="font-medium">
          消息
          {unreadCount > 0 && (
            <span className="ml-2 text-xs text-destructive font-normal">({unreadCount})</span>
          )}
        </h1>
        {unreadCount > 0 && (
          <button
            className="text-xs text-primary flex items-center gap-1"
            onClick={() => markRead()}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            全部已读
          </button>
        )}
      </header>

      <div className="bg-card border-b border-border flex overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const active = tab === t.key;
          const cnt = t.key === "unread" ? unreadCount : t.key === "all" ? list.length : list.filter((n) => n.category === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex-1 min-w-[60px] py-2.5 text-xs whitespace-nowrap ${
                active ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground"
              }`}
            >
              {t.label}
              {cnt > 0 && <span className="ml-1 text-[10px] opacity-70">{cnt}</span>}
            </button>
          );
        })}
      </div>

      <main className="flex-1 px-3 py-3">
        {authLoading || loading ? (
          <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
        ) : !user ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-muted-foreground">登录后查看消息</p>
            <Button onClick={() => navigate({ to: "/auth/login" })}>去登录</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bell className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">暂无消息</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((n) => {
              const meta = CATEGORY_META[n.category] ?? CATEGORY_META.system;
              const Icon = meta.icon;
              return (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`relative bg-card rounded-md p-3 flex gap-3 cursor-pointer transition-colors ${
                    n.is_read ? "opacity-80" : "ring-1 ring-primary/20"
                  }`}
                >
                  <div className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center ${meta.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{n.title}</span>
                      {!n.is_read && <span className="shrink-0 h-2 w-2 rounded-full bg-destructive" />}
                    </div>
                    {n.content && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.content}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-muted-foreground">{meta.label} · {fmtDate(n.created_at)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeOne(n.id); }}
                        className="text-muted-foreground hover:text-destructive p-1"
                        aria-label="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
