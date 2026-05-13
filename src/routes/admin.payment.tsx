import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { CreditCard, Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";

export const Route = createFileRoute("/admin/payment")({
  component: () => (
    <RouteGuard title="支付通道" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
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
    { key: "app_id", label: "AppID", placeholder: "wx... 公众号/小程序 AppID" },
    { key: "mch_id", label: "商户号 MCHID" },
    { key: "api_key", label: "API 密钥 (V2)", type: "password" },
    { key: "api_v3_key", label: "API V3 密钥", type: "password" },
    { key: "cert_serial_no", label: "证书序列号" },
    { key: "notify_url", label: "支付回调 URL", placeholder: "https://your-domain/api/public/wxpay/notify" },
  ],
  alipay: [
    { key: "app_id", label: "AppID" },
    { key: "app_private_key", label: "应用私钥", type: "textarea", placeholder: "-----BEGIN RSA PRIVATE KEY-----" },
    { key: "alipay_public_key", label: "支付宝公钥", type: "textarea", placeholder: "-----BEGIN PUBLIC KEY-----" },
    { key: "notify_url", label: "支付回调 URL", placeholder: "https://your-domain/api/public/alipay/notify" },
  ],
  custom: [],
};

// 支持嵌套 key（如 "wechat.productCode"）的读写
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


function Inner() {
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
    if (error) reportRpcError(error, { op: "payment_channels.select", scope: "admin.payment" });
    setList((data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing({
      id: "",
      code: "",
      name: "",
      provider: "3ypay",
      config: { wechat: { paySubType: "NATIVE" }, alipay: { paySubType: "NATIVE" } },
      is_enabled: true,
      sort_order: list.length,
      remark: "",
    });
    setOpen(true);
  };

  const openEdit = (c: Channel) => {
    setEditing({ ...c, config: c.config ?? {} });
    setOpen(true);
  };

  const toggleEnabled = async (c: Channel) => {
    const { error } = await supabase
      .from("payment_channels")
      .update({ is_enabled: !c.is_enabled })
      .eq("id", c.id);
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
    if (!confirm(`确定删除支付通道「${c.name}」？关联此通道的商家将被自动重置。`)) return;
    const { error } = await supabase.from("payment_channels").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("已删除");
    load();
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="支付通道" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <div className="bg-info/5 rounded-md p-3 text-xs text-muted-foreground flex gap-2">
          <CreditCard className="h-4 w-4 shrink-0 mt-0.5 text-info" />
          <span>录入并启用任意多个支付通道，商家可在「店铺管理」中选择其中一个供买家付款使用。</span>
        </div>

        <Button className="w-full" onClick={openNew}>
          <Plus className="w-4 h-4 mr-1" /> 新增支付通道
        </Button>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">加载中…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">暂无支付通道，点击上方按钮创建</p>
        ) : (
          <div className="space-y-2">
            {list.map((c, i) => (
              <div key={c.id} className="bg-card rounded-md p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent">{PROVIDER_LABEL[c.provider]}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${c.is_enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                        {c.is_enabled ? "已启用" : "已禁用"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">编码：{c.code}</div>
                    {c.remark && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{c.remark}</div>}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => toggleEnabled(c)}>
                    {c.is_enabled ? "禁用" : "启用"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                    <Pencil className="w-3 h-3 mr-1" />编辑
                  </Button>
                  <Button size="sm" variant="outline" disabled={i === 0} onClick={() => move(c, -1)}>
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={i === list.length - 1} onClick={() => move(c, 1)}>
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(c)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <EditDialog open={open} onOpenChange={setOpen} channel={editing} onSaved={() => { setOpen(false); load(); }} />
    </div>
  );
}

function EditDialog({
  open, onOpenChange, channel, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: Channel | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Channel | null>(channel);
  const [saving, setSaving] = useState(false);
  // custom 通道动态字段
  const [customJson, setCustomJson] = useState("{}");

  useEffect(() => {
    setForm(channel);
    if (channel?.provider === "custom") {
      setCustomJson(JSON.stringify(channel.config ?? {}, null, 2));
    }
  }, [channel]);

  if (!form) return null;

  const isNew = !form.id;
  const fields = PROVIDER_FIELDS[form.provider];

  const save = async () => {
    if (!form.name.trim()) { toast.error("请填写通道名称"); return; }
    if (!form.code.trim()) { toast.error("请填写通道编码"); return; }

    let config = form.config;
    if (form.provider === "custom") {
      try { config = JSON.parse(customJson || "{}"); }
      catch { toast.error("自定义参数 JSON 格式错误"); return; }
    }

    setSaving(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      provider: form.provider,
      config,
      is_enabled: form.is_enabled,
      sort_order: form.sort_order,
      remark: form.remark || null,
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
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "新增支付通道" : "编辑支付通道"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs">支付类型</label>
            <div className="flex gap-1 mt-1">
              {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={form.provider === p ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setForm({ ...form, provider: p, config: {} })}
                  disabled={!isNew}
                >
                  {PROVIDER_LABEL[p]}
                </Button>
              ))}
            </div>
            {!isNew && <p className="text-xs text-muted-foreground mt-1">类型不可修改</p>}
          </div>

          <div>
            <label className="text-xs">通道名称</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：主微信商户号" />
          </div>
          <div>
            <label className="text-xs">通道编码（唯一）</label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="如：wx_main" disabled={!isNew} />
          </div>
          <div>
            <label className="text-xs">备注</label>
            <Input value={form.remark ?? ""} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="选填" />
          </div>

          {form.provider !== "custom" && (
            <div className="border-t border-border pt-3 space-y-3">
              <div className="text-xs font-medium">{PROVIDER_LABEL[form.provider]}参数</div>
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="text-xs">{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea
                      className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono min-h-[100px]"
                      value={form.config[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                    />
                  ) : (
                    <Input
                      type={f.type}
                      value={form.config[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {form.provider === "custom" && (
            <div className="border-t border-border pt-3">
              <label className="text-xs">参数 JSON</label>
              <textarea
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono min-h-[160px]"
                value={customJson}
                placeholder='{"key": "value"}'
                onChange={(e) => setCustomJson(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">用于对接第三方聚合支付，自由定义参数键值。</p>
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
