import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { buildShareUrl, preloadRelayBase } from "@/lib/share-url";

export const Route = createFileRoute("/admin/merchant-recruit")({
  component: () => (
    <RouteGuard title="商家招募二维码" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

function Inner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    preloadRelayBase().finally(() => setReady(true));
  }, []);

  const url = buildShareUrl({ ref: "admin", to: "/apply" });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已复制链接");
    } catch {
      toast.error("复制失败，请长按选择");
    }
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="商家招募二维码" />

      <div className="bg-card m-3 rounded-2xl p-6 flex flex-col items-center">
        <h2 className="text-lg font-bold mb-1">商家入驻申请</h2>
        <p className="text-xs text-muted-foreground mb-4 text-center">
          分享给意向商家，扫码即可登录并提交开店申请
        </p>
        {origin && (
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
        <p>· 意向商家扫码后将进入「商家开店申请」页面</p>
        <p>· 未登录用户先用手机号登录（自动注册），再填写店铺名称</p>
        <p>· 申请提交后将出现在「商家审核」列表中</p>
        <p>· 审核通过后，商家下次登录将直接看到商家后台入口</p>
      </div>
    </div>
  );
}
