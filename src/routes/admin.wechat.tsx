import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RouteGuard } from "@/components/route-guard";
import { useSettingObject } from "@/lib/use-setting-object";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/admin/wechat")({
  component: () => (
    <RouteGuard title="微信登录" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

type WxLogin = {
  enabled: boolean;
  open_app_id: string;       // 微信开放平台 AppID（网页扫码登录）
  open_app_secret: string;   // 微信开放平台 AppSecret
  mp_app_id: string;         // 公众号 AppID（公众号内 H5 静默登录可选）
  mp_app_secret: string;     // 公众号 AppSecret
  redirect_uri: string;      // 授权回调地址
};

const DEFAULT: WxLogin = {
  enabled: false,
  open_app_id: "",
  open_app_secret: "",
  mp_app_id: "",
  mp_app_secret: "",
  redirect_uri: "",
};

function Inner() {
  const s = useSettingObject<WxLogin>("auth_wechat", DEFAULT);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="微信登录" />
      <main className="flex-1 px-3 py-3">
        <div className="bg-info/5 rounded-md p-3 text-xs text-muted-foreground mb-3 flex gap-2">
          <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-info" />
          <span>填写微信开放平台「网站应用」的 AppID/AppSecret，用于网页扫码登录；或填写公众号配置用于微信内授权。本页仅做参数登记，登录流程后续接入。</span>
        </div>

        <div className="bg-card rounded-md p-4 space-y-3">
          {s.loading ? <p className="text-sm text-muted-foreground">加载中…</p> : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm">启用微信登录</span>
                <Button size="sm" variant={s.value.enabled ? "default" : "outline"} onClick={() => s.setValue({ ...s.value, enabled: !s.value.enabled })}>
                  {s.value.enabled ? "已启用" : "未启用"}
                </Button>
              </div>

              <div className="pt-2 border-t border-border">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">微信开放平台（PC 扫码登录）</h3>
                <div className="space-y-3">
                  <Field label="开放平台 AppID" value={s.value.open_app_id} onChange={(v) => s.setValue({ ...s.value, open_app_id: v })} placeholder="wx..." />
                  <Field label="开放平台 AppSecret" value={s.value.open_app_secret} onChange={(v) => s.setValue({ ...s.value, open_app_secret: v })} type="password" />
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">公众号（微信内 H5 授权）</h3>
                <div className="space-y-3">
                  <Field label="公众号 AppID" value={s.value.mp_app_id} onChange={(v) => s.setValue({ ...s.value, mp_app_id: v })} placeholder="wx..." />
                  <Field label="公众号 AppSecret" value={s.value.mp_app_secret} onChange={(v) => s.setValue({ ...s.value, mp_app_secret: v })} type="password" />
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <Field label="授权回调 URL" value={s.value.redirect_uri} onChange={(v) => s.setValue({ ...s.value, redirect_uri: v })} placeholder="https://your-domain/api/public/wechat/callback" />
              </div>

              <Button className="w-full" disabled={s.saving} onClick={() => s.save()}>
                {s.saving ? "保存中…" : "保存微信登录配置"}
              </Button>
            </>
          )}
        </div>
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
