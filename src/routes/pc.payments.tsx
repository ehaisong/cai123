import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PcPageHeader } from "@/components/pc/pc-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";

export const Route = createFileRoute("/pc/payments")({
  component: PaymentsPage,
});

type Provider = "3ypay" | "wechat" | "alipay" | "custom";
type Channel = {
  id: string;
  code: string;
  name: string;
  provider: Provider;
  config: Record<string, any>;
  is_enabled: boolean;
  sort_order: number;
  remark: string | null;
};

const PROVIDER_LABEL: Record<Provider, string> = {
  "3ypay": "3ypay 聚合（微信+支付宝）",
  wechat: "微信支付（直连）",
  alipay: "支付宝（直连）",
  custom: "自定义",
};

const PROVIDER_FIELDS: Record<Provider, { key: string; label: string; type?: "password" | "textarea"; placeholder?: string }[]> = {
  "3ypay": [
    { key: "appId", label: "商户应用 AppID", placeholder: "APP_..." },
    { key: "mchNo", label: "商户号 MCHID", placeholder: "M..." },
    { key: "merchantPrivateKey", label: "商户私钥（PKCS#8 PEM）", type: "textarea", placeholder: "-----BEGIN PRIVATE KEY-----\n..." },
    { key: "platformPublicKey", label: "平台公钥（PEM）", type: "textarea", placeholder: "-----BEGIN PUBLIC KEY-----\n..." },
    { key: "wechat.productCode", label: "微信 AUT 编号 productCode", placeholder: "T001930749833" },
    { key: "wechat.paySubType", label: "微信 paySubType", placeholder: "NATIVE（默认）" },
    { key: "alipay.productCode", label: "支付宝 AUT 编号 productCode", placeholder: "A000558443631" },
    { key: "alipay.paySubType", label: "支付宝 paySubType", placeholder: "NATIVE（默认）" },
  ],
  wechat: [
    { key: "app_id", label: "AppID" },
    { key: "mch_id", label: "商户号 MCHID" },
    { key: "api_key", label: "API 密钥 (V2)", type: "password" },
    { key: "api_v3_key", label: "API V3 密钥", type: "password" },
    { key: "cert_serial_no", label: "证书序列号" },
    { key: "notify_url", label: "支付回调 URL" },
  ],
  alipay: [
    { key: "app_id", label: "AppID" },
    { key: "app_private_key", label: "应用私钥", type: "textarea" },
    { key: "alipay_public_key", label: "支付宝公钥", type: "textarea" },
    { key: "notify_url", label: "支付回调 URL" },
  ],
  custom: [],
};

function getNested(obj: Record<string, any>, path: string): any {
  return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
function setNested(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const next = { ...obj };
  const keys = path.split(".");
  let cur: any = next;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...(cur[keys[i]] ?? {}) };
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return next;
}

function PaymentsPage() {
  const [list, setList] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_channels")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) reportRpcError(error, { op: "payment_channels.select", scope: "pc.payments" });
    setList((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing({
      id: "", code: "", name: "", provider: "3ypay",
      config: { wechat: { paySubType: "NATIVE" }, alipay: { paySubType: "NATIVE" } },
      is_enabled: true, sort_order: list.length, remark: "",
    });
    setOpen(true);
  };

  const toggleEnabled = async (c: Channel) => {
    const { error } = await supabase.from("payment_channels").update({ is_enabled: !c.is_enabled }).eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(c.is_enabled ? "已禁用" : "已启用");
    load();
  };

  const move = async (c: Channel, dir: -1 | 1) => {
    const idx = list.findIndex((x) => x.id === c.id);
    const swap = list[idx + dir];
    if (!swap) return;
    await Promise.all([
      supabase.from("payment_channels").update({ sort_order: swap.sort_order }).eq("id", c.id),
      supabase.from("payment_channels").update({ sort_order: c.sort_order }).eq("id", swap.id),
    ]);
    load();
  };

  const remove = async (c: Channel) => {
    if (!confirm(`确定删除支付通道「${c.name}」？`)) return;
    const { error } = await supabase.from("payment_channels").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("已删除");
    load();
  };

  return (
    <div>
      <PcPageHeader
        title="支付通道"
        description="管理用于商家收款的聚合支付通道（3ypay 等）"
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />新增通道</Button>}
      />
      <div className="bg-card rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>编码</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>备注</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">加载中…</TableCell></TableRow>
            ) : list.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">暂无支付通道</TableCell></TableRow>
            ) : list.map((c, i) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><span className="text-xs px-2 py-0.5 rounded bg-accent">{PROVIDER_LABEL[c.provider]}</span></TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.code}</TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded ${c.is_enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                    {c.is_enabled ? "已启用" : "已禁用"}
                  </span>
                </TableCell>
                <TableCell>{c.sort_order}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{c.remark}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => toggleEnabled(c)}>{c.is_enabled ? "禁用" : "启用"}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditing({ ...c, config: c.config ?? {} }); setOpen(true); }}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={i === 0} onClick={() => move(c, -1)}><ArrowUp className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" disabled={i === list.length - 1} onClick={() => move(c, 1)}><ArrowDown className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(c)}><Trash2 className="w-3 h-3" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <EditDialog open={open} onOpenChange={setOpen} channel={editing} onSaved={() => { setOpen(false); load(); }} />
    </div>
  );
}

function EditDialog({ open, onOpenChange, channel, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; channel: Channel | null; onSaved: () => void;
}) {
  const [form, setForm] = useState<Channel | null>(channel);
  const [saving, setSaving] = useState(false);
  const [customJson, setCustomJson] = useState("{}");

  useEffect(() => {
    setForm(channel);
    if (channel?.provider === "custom") setCustomJson(JSON.stringify(channel.config ?? {}, null, 2));
  }, [channel]);

  if (!form) return null;
  const isNew = !form.id;
  const fields = PROVIDER_FIELDS[form.provider];

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error("请填写通道名称和编码"); return; }
    let config = form.config;
    if (form.provider === "custom") {
      try { config = JSON.parse(customJson || "{}"); } catch { toast.error("JSON 格式错误"); return; }
    }
    setSaving(true);
    const payload = {
      code: form.code.trim(), name: form.name.trim(), provider: form.provider,
      config, is_enabled: form.is_enabled, sort_order: form.sort_order, remark: form.remark || null,
    };
    const { error } = isNew
      ? await supabase.from("payment_channels").insert(payload)
      : await supabase.from("payment_channels").update(payload).eq("id", form.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isNew ? "已创建" : "已保存");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? "新增支付通道" : "编辑支付通道"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs">支付类型</label>
            <div className="flex gap-1 mt-1">
              {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                <Button key={p} size="sm" variant={form.provider === p ? "default" : "outline"} className="flex-1"
                  onClick={() => setForm({ ...form, provider: p, config: {} })} disabled={!isNew}>
                  {PROVIDER_LABEL[p]}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs">通道名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs">通道编码（唯一）</label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!isNew} />
            </div>
          </div>
          <div>
            <label className="text-xs">备注</label>
            <Input value={form.remark ?? ""} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </div>

          {form.provider !== "custom" && (
            <div className="border-t border-border pt-3 space-y-3">
              <div className="text-xs font-medium">{PROVIDER_LABEL[form.provider]}参数</div>
              {fields.map((f) => {
                const value = f.key.includes(".") ? getNested(form.config, f.key) : form.config[f.key];
                const onChange = (val: string) =>
                  setForm({ ...form, config: f.key.includes(".") ? setNested(form.config, f.key, val) : { ...form.config, [f.key]: val } });
                return (
                  <div key={f.key}>
                    <label className="text-xs">{f.label}</label>
                    {f.type === "textarea" ? (
                      <textarea
                        className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono min-h-[100px]"
                        value={value ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)}
                      />
                    ) : (
                      <Input type={f.type} value={value ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {form.provider === "custom" && (
            <div className="border-t border-border pt-3">
              <label className="text-xs">参数 JSON</label>
              <textarea
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono min-h-[160px]"
                value={customJson} onChange={(e) => setCustomJson(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm">默认启用</span>
            <Button size="sm" variant={form.is_enabled ? "default" : "outline"} onClick={() => setForm({ ...form, is_enabled: !form.is_enabled })}>
              {form.is_enabled ? "已启用" : "未启用"}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
