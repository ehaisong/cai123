import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { useSettingObject } from "@/lib/use-setting-object";
import { CreditCard } from "lucide-react";

export const Route = createFileRoute("/admin/payment")({
  component: () => (
    <RouteGuard title="支付参数" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

type WxPay = {
  enabled: boolean;
  app_id: string;
  mch_id: string;
  api_key: string;
  api_v3_key: string;
  cert_serial_no: string;
  notify_url: string;
};

type AliPay = {
  enabled: boolean;
  app_id: string;
  app_private_key: string;
  alipay_public_key: string;
  notify_url: string;
};

const WX_DEFAULT: WxPay = { enabled: false, app_id: "", mch_id: "", api_key: "", api_v3_key: "", cert_serial_no: "", notify_url: "" };
const ALI_DEFAULT: AliPay = { enabled: false, app_id: "", app_private_key: "", alipay_public_key: "", notify_url: "" };

function Inner() {
  const wx = useSettingObject<WxPay>("payment_wechat", WX_DEFAULT);
  const ali = useSettingObject<AliPay>("payment_alipay", ALI_DEFAULT);
  const [tab, setTab] = useState<"wx" | "ali">("wx");

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="支付参数" />
      <div className="bg-card border-b border-border flex">
        {[{ k: "wx", l: "微信支付" }, { k: "ali", l: "支付宝" }].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k as any)} className={`flex-1 py-3 text-xs ${tab === t.k ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
            {t.l}
          </button>
        ))}
      </div>
      <main className="flex-1 px-3 py-3">
        <div className="bg-info/5 rounded-md p-3 text-xs text-muted-foreground mb-3 flex gap-2">
          <CreditCard className="h-4 w-4 shrink-0 mt-0.5 text-info" />
          <span>仅作参数登记。如需对接真实支付，请在保存后联系开发完成回调与下单接入。</span>
        </div>

        {tab === "wx" && (
          <div className="bg-card rounded-md p-4 space-y-3">
            {wx.loading ? <p className="text-sm text-muted-foreground">加载中…</p> : (
              <>
                <ToggleRow label="启用微信支付" value={wx.value.enabled} onChange={(v) => wx.setValue({ ...wx.value, enabled: v })} />
                <Field label="AppID" value={wx.value.app_id} onChange={(v) => wx.setValue({ ...wx.value, app_id: v })} placeholder="wx... 公众号或小程序 AppID" />
                <Field label="商户号 MCHID" value={wx.value.mch_id} onChange={(v) => wx.setValue({ ...wx.value, mch_id: v })} />
                <Field label="API 密钥 (V2)" value={wx.value.api_key} onChange={(v) => wx.setValue({ ...wx.value, api_key: v })} type="password" />
                <Field label="API V3 密钥" value={wx.value.api_v3_key} onChange={(v) => wx.setValue({ ...wx.value, api_v3_key: v })} type="password" />
                <Field label="证书序列号" value={wx.value.cert_serial_no} onChange={(v) => wx.setValue({ ...wx.value, cert_serial_no: v })} />
                <Field label="支付回调 URL" value={wx.value.notify_url} onChange={(v) => wx.setValue({ ...wx.value, notify_url: v })} placeholder="https://your-domain/api/public/wxpay/notify" />
                <Button className="w-full" disabled={wx.saving} onClick={() => wx.save()}>{wx.saving ? "保存中…" : "保存微信支付配置"}</Button>
              </>
            )}
          </div>
        )}

        {tab === "ali" && (
          <div className="bg-card rounded-md p-4 space-y-3">
            {ali.loading ? <p className="text-sm text-muted-foreground">加载中…</p> : (
              <>
                <ToggleRow label="启用支付宝" value={ali.value.enabled} onChange={(v) => ali.setValue({ ...ali.value, enabled: v })} />
                <Field label="AppID" value={ali.value.app_id} onChange={(v) => ali.setValue({ ...ali.value, app_id: v })} />
                <FieldArea label="应用私钥" value={ali.value.app_private_key} onChange={(v) => ali.setValue({ ...ali.value, app_private_key: v })} placeholder="-----BEGIN RSA PRIVATE KEY-----" />
                <FieldArea label="支付宝公钥" value={ali.value.alipay_public_key} onChange={(v) => ali.setValue({ ...ali.value, alipay_public_key: v })} placeholder="-----BEGIN PUBLIC KEY-----" />
                <Field label="支付回调 URL" value={ali.value.notify_url} onChange={(v) => ali.setValue({ ...ali.value, notify_url: v })} placeholder="https://your-domain/api/public/alipay/notify" />
                <Button className="w-full" disabled={ali.saving} onClick={() => ali.save()}>{ali.saving ? "保存中…" : "保存支付宝配置"}</Button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="text-xs">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} />
    </div>
  );
}
function FieldArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs">{label}</label>
      <textarea
        className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono min-h-[100px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm">{label}</span>
      <Button size="sm" variant={value ? "default" : "outline"} onClick={() => onChange(!value)}>
        {value ? "已启用" : "未启用"}
      </Button>
    </div>
  );
}
