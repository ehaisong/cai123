import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { buildShareUrl, preloadRelayBase } from "@/lib/share-url";

export const Route = createFileRoute("/merchant/agent-recruit")({
  component: () => (
    <RouteGuard title="代理招募二维码" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    preloadRelayBase().finally(() => setReady(true));
    if (!user) return;
    supabase.from("merchants").select("id, shop_name").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setMerchant(data));
  }, [user?.id]);

  if (!merchant) {
    return (
      <div className="h5-shell"><PageHeader title="代理招募二维码" />
        <p className="text-center py-12 text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  const url = buildShareUrl({ ref: `M_${merchant.id}`, to: `/apply-agent/${merchant.id}` });

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success("已复制链接"); }
    catch { toast.error("复制失败"); }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="代理招募二维码" />

      <div className="bg-card m-3 rounded-2xl p-6 flex flex-col items-center">
        <h2 className="text-lg font-bold mb-1">{merchant.shop_name}</h2>
        <p className="text-xs text-muted-foreground mb-4 text-center">
          分享给意向代理，扫码即可提交申请，由您审核后生效
        </p>
        {ready && (
          <div className="bg-white p-4 rounded-xl border border-border">
            <QRCodeSVG value={url} size={240} level="M" />
          </div>
        )}
        <div className="mt-4 text-xs text-muted-foreground break-all text-center px-4">{url}</div>
        <Button variant="outline" className="mt-4" onClick={copy}>
          <Copy className="w-4 h-4 mr-1" /> 复制链接
        </Button>
      </div>

      <div className="mx-3 mb-6 p-4 rounded-xl bg-muted/50 text-xs text-muted-foreground space-y-1">
        <p>· 用户扫码后将进入「申请成为代理」页面</p>
        <p>· 未登录用户先登录（自动注册），再填写申请说明</p>
        <p>· 申请将出现在「代理申请审核」中，请及时处理</p>
      </div>
    </div>
  );
}
