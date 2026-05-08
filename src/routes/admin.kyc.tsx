import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { Search, Pencil, ShieldCheck, X } from "lucide-react";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/admin/kyc")({
  component: () => (
    <RouteGuard title="实名管理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

type Row = {
  id: string;
  user_id: string;
  real_name: string;
  id_card_no: string;
  bank_name: string;
  bank_account: string;
  bank_branch: string | null;
  phone: string | null;
  remark: string | null;
  updated_at: string;
};

type ProfileLite = {
  user_id: string;
  user_code: string;
  nickname: string | null;
  phone: string | null;
};

function Inner() {
  const [list, setList] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [merchantIds, setMerchantIds] = useState<Set<string>>(new Set());
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<"all" | "merchant" | "agent">("all");
  const [editing, setEditing] = useState<Partial<Row> & { user_id: string } | null>(null);
  const [findKeyword, setFindKeyword] = useState("");
  const [foundUsers, setFoundUsers] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("user_kyc").select("*").order("updated_at", { ascending: false }).limit(500);
    if (error) { reportRpcError(error, { op: "user_kyc.select", scope: "AdminKyc" }); setLoading(false); return; }
    const rows = (data ?? []) as Row[];
    setList(rows);
    const ids = rows.map((r) => r.user_id);
    if (ids.length) {
      const [{ data: profs }, { data: merchs }, { data: agents }] = await Promise.all([
        supabase.from("profiles").select("user_id, user_code, nickname, phone").in("user_id", ids),
        supabase.from("merchants").select("user_id").in("user_id", ids),
        supabase.from("agent_relations").select("user_id, is_agent").in("user_id", ids).eq("is_agent", true),
      ]);
      const m: Record<string, ProfileLite> = {};
      (profs ?? []).forEach((p: any) => { m[p.user_id] = p; });
      setProfiles(m);
      setMerchantIds(new Set((merchs ?? []).map((x: any) => x.user_id)));
      setAgentIds(new Set((agents ?? []).map((x: any) => x.user_id)));
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => list.filter((r) => {
    if (filter === "merchant" && !merchantIds.has(r.user_id)) return false;
    if (filter === "agent" && !agentIds.has(r.user_id)) return false;
    if (!keyword.trim()) return true;
    const k = keyword.toLowerCase();
    const p = profiles[r.user_id];
    return (
      r.real_name?.toLowerCase().includes(k) ||
      r.id_card_no?.includes(keyword) ||
      r.bank_account?.includes(keyword) ||
      p?.nickname?.toLowerCase().includes(k) ||
      p?.user_code?.toLowerCase().includes(k) ||
      p?.phone?.includes(keyword)
    );
  }), [list, profiles, merchantIds, agentIds, keyword, filter]);

  const findUsers = async () => {
    const k = findKeyword.trim();
    if (!k) return;
    const { data } = await supabase
      .from("profiles")
      .select("user_id, user_code, nickname, phone")
      .or(`user_code.ilike.%${k}%,nickname.ilike.%${k}%,phone.ilike.%${k}%`)
      .limit(20);
    setFoundUsers((data ?? []) as ProfileLite[]);
  };

  const startEdit = async (userId: string) => {
    const existing = list.find((r) => r.user_id === userId);
    if (existing) { setEditing(existing); return; }
    setEditing({
      user_id: userId, real_name: "", id_card_no: "", bank_name: "",
      bank_account: "", bank_branch: "", phone: "", remark: "",
    } as any);
  };

  const save = async () => {
    if (!editing) return;
    const { error } = await supabase.rpc("admin_update_user_kyc", {
      _user_id: editing.user_id,
      _real_name: editing.real_name ?? "",
      _id_card_no: editing.id_card_no ?? "",
      _bank_name: editing.bank_name ?? "",
      _bank_account: editing.bank_account ?? "",
      _bank_branch: editing.bank_branch ?? undefined,
      _phone: editing.phone ?? undefined,
      _remark: editing.remark ?? undefined,
    });
    if (error) {
      reportRpcError(error, { op: "admin_update_user_kyc", scope: "AdminKyc" });
      toast.error(error.message || "保存失败");
      return;
    }
    toast.success("已保存");
    setEditing(null);
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-muted/20">
      <PageHeader title="实名信息管理" />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="姓名/身份证/银行卡/昵称/手机/编号" />
        </div>
        <div className="flex gap-1 text-xs">
          {(["all", "merchant", "agent"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-2 py-1 rounded ${filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {k === "all" ? "全部" : k === "merchant" ? "商家" : "代理"}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => setEditing({ user_id: "", real_name: "", id_card_no: "", bank_name: "", bank_account: "", bank_branch: "", phone: "", remark: "" } as any)}
            className="px-2 py-1 rounded bg-success/10 text-success">+ 为用户新增/修改</button>
        </div>
      </div>

      <div className="px-3 pb-6 space-y-2">
        {loading && <p className="text-center py-6 text-sm text-muted-foreground">加载中…</p>}
        {!loading && filtered.length === 0 && <p className="text-center py-12 text-sm text-muted-foreground">暂无实名记录</p>}
        {filtered.map((r) => {
          const p = profiles[r.user_id];
          return (
            <div key={r.id} className="bg-card rounded-xl p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  {r.real_name}
                  {merchantIds.has(r.user_id) && <span className="px-1.5 py-0.5 bg-orange-500/10 text-orange-600 rounded text-[10px]">商家</span>}
                  {agentIds.has(r.user_id) && <span className="px-1.5 py-0.5 bg-green-500/10 text-green-600 rounded text-[10px]">代理</span>}
                </div>
                <button onClick={() => startEdit(r.user_id)} className="text-info text-xs flex items-center gap-1"><Pencil className="h-3 w-3" />修改</button>
              </div>
              <div className="text-xs text-muted-foreground">
                {p?.nickname ?? "—"} · {p?.user_code} · {p?.phone ?? "无手机"}
              </div>
              <div className="text-xs">身份证：<span className="font-mono">{r.id_card_no}</span></div>
              <div className="text-xs">银行：{r.bank_name} · <span className="font-mono">{r.bank_account}</span>{r.bank_branch ? ` · ${r.bank_branch}` : ""}</div>
              {r.phone && <div className="text-xs">预留手机：{r.phone}</div>}
              {r.remark && <div className="text-xs text-muted-foreground">备注：{r.remark}</div>}
              <div className="text-[10px] text-muted-foreground">更新于 {fmtDate(r.updated_at)}</div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setEditing(null)}>
          <div className="bg-card w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">{editing.user_id ? "修改实名信息" : "为用户绑定实名"}</div>
              <button onClick={() => setEditing(null)}><X className="h-5 w-5" /></button>
            </div>

            {!editing.user_id && (
              <div className="space-y-2 border-b pb-3">
                <Label className="text-xs">查找用户（昵称/编号/手机）</Label>
                <div className="flex gap-2">
                  <Input value={findKeyword} onChange={(e) => setFindKeyword(e.target.value)} placeholder="输入关键词" />
                  <Button type="button" variant="outline" onClick={findUsers}>搜索</Button>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {foundUsers.map((u) => (
                    <button key={u.user_id} onClick={() => setEditing({ ...editing, user_id: u.user_id })}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-xs">
                      {u.nickname ?? "—"} · {u.user_code} · {u.phone ?? "无手机"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {editing.user_id && (
              <>
                <div className="text-xs text-muted-foreground">用户ID：<span className="font-mono break-all">{editing.user_id}</span></div>
                <div className="space-y-2">
                  <EditField label="真实姓名" value={editing.real_name ?? ""} onChange={(v) => setEditing({ ...editing!, real_name: v })} />
                  <EditField label="身份证号" value={editing.id_card_no ?? ""} onChange={(v) => setEditing({ ...editing!, id_card_no: v })} />
                  <EditField label="开户银行" value={editing.bank_name ?? ""} onChange={(v) => setEditing({ ...editing!, bank_name: v })} />
                  <EditField label="银行卡号" value={editing.bank_account ?? ""} onChange={(v) => setEditing({ ...editing!, bank_account: v })} />
                  <EditField label="开户支行" value={editing.bank_branch ?? ""} onChange={(v) => setEditing({ ...editing!, bank_branch: v })} />
                  <EditField label="预留手机号" value={editing.phone ?? ""} onChange={(v) => setEditing({ ...editing!, phone: v })} />
                  <EditField label="备注" value={editing.remark ?? ""} onChange={(v) => setEditing({ ...editing!, remark: v })} />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>取消</Button>
                  <Button className="flex-1" onClick={save}>保存</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
