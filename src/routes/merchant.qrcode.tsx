import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { RouteGuard } from "@/components/route-guard";
import { buildShareUrl, preloadRelayBase } from "@/lib/share-url";

export const Route = createFileRoute("/merchant/qrcode")({
  component: MerchantQR,
});

function MerchantQR() {
  return (
    <RouteGuard title="推广二维码" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <MerchantQRInner />
    </RouteGuard>
  );
}

function MerchantQRInner() {
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<any>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
    if (!user) return;
    supabase.from("merchants").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => setMerchant(data));
  }, [user?.id]);

  if (!merchant) return <div className="h5-shell"><PageHeader title="推广二维码" /><p className="text-center py-12 text-sm text-muted-foreground">加载中…</p></div>;

  const url = `${origin}/shop/${merchant.id}?ref=M_${merchant.id}`;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="店铺推广二维码" />
      <div className="bg-card m-3 rounded-2xl p-6 flex flex-col items-center">
        <h2 className="text-lg font-bold mb-1">{merchant.shop_name}</h2>
        <p className="text-xs text-muted-foreground mb-4">扫码进入店铺并绑定为推荐</p>
        <div className="bg-white p-4 rounded-xl border border-border">
          <QRCodeSVG value={url} size={220} level="M" />
        </div>
      </div>
    </div>
  );
}
