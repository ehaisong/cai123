import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { Copy, Share2, Download, Store, Users, ArrowRightLeft } from "lucide-react";
import { RouteGuard } from "@/components/route-guard";
import { buildShareUrl, preloadRelayBase } from "@/lib/share-url";

export const Route = createFileRoute("/agent_/share")({
  component: SharePageGuarded,
});

function SharePageGuarded() {
  return (
    <RouteGuard title="推广分享">
      <SharePage />
    </RouteGuard>
  );
}



interface MerchantBrief {
  id: string;
  shop_name: string;
  shop_avatar_url: string | null;
}

function SharePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [merchant, setMerchant] = useState<MerchantBrief | null>(null);
  const [config, setConfig] = useState<{ l1_rate: number } | null>(null);
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) { setLoading(false); return; }
      preloadRelayBase();
      const [arRes, pRes, cfgRes] = await Promise.all([
        supabase.from("agent_relations").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles").select("id, user_code, nickname").eq("user_id", user.id).maybeSingle(),
        supabase.from("commission_config").select("l1_rate, l2_rate").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (arRes.error) reportRpcError(arRes.error, { op: "agent_relations.select", scope: "SharePage" });
      setInfo(arRes.data);
      setProfile(pRes.data);
      setConfig(cfgRes.data ?? null);

      if (arRes.data?.bound_merchant_id) {
        const { data: m } = await supabase
          .from("merchants")
          .select("id, shop_name, shop_avatar_url")
          .eq("id", arRes.data.bound_merchant_id)
          .maybeSingle();
        setMerchant(m);
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  if (authLoading || loading) {
    return <div className="h5-shell"><PageHeader title="推广分享" /><p className="text-center py-12 text-sm text-muted-foreground">加载中…</p></div>;
  }
  if (!user) {
    return (
      <div className="h5-shell"><PageHeader title="推广分享" />
        <div className="p-6 text-center"><Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button></div>
      </div>
    );
  }
  if (!info?.is_agent) {
    return (
      <div className="h5-shell"><PageHeader title="推广分享" />
        <div className="p-6 text-center text-sm text-muted-foreground">
          您还不是代理，请先在店铺页申请成为代理。
          <div className="mt-4"><Button onClick={() => navigate({ to: "/agent" })}>前往代理中心</Button></div>
        </div>
      </div>
    );
  }

  const code = info.agent_code ?? profile?.user_code ?? "";
  // 二维码统一指向中转站，由中转站 302 到当前生效的生产域名，
  // 这样即使某个生产域名被微信屏蔽，已发出的二维码依然可用。
  // 代理推广码：?ref=<user_code>，登陆后自动绑定为我的下级 + 解析到归属商家
  const agentUrl = buildShareUrl({ ref: code });
  const url = agentUrl;

  const l1Pct = config ? (config.l1_rate * 100).toFixed(0) : "—";
  const l2Pct = config ? (config.l2_rate * 100).toFixed(0) : "—";

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("已复制"); }
    catch { toast.error("复制失败"); }
  };

  const share = async () => {
    const shareData = {
      title: "邀请你加入",
      text: "扫码或点击链接加入，享受专属预测内容",
      url,
    };
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try { await (navigator as any).share(shareData); } catch { /* user cancel */ }
    } else {
      copy(url);
    }
  };

  const downloadQR = () => {
    const svg = document.querySelector("#agent-share-qr svg") as SVGSVGElement | null;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const urlObj = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 600;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const a = document.createElement("a");
      a.download = `推广二维码_${code}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      URL.revokeObjectURL(urlObj);
    };
    img.src = urlObj;
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader
        title="推广分享"
        right={
          <Link to="/agent/invitees" className="text-xs text-primary inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> 下级
          </Link>
        }
      />

      {/* 当前归属商家 */}
      <div className="bg-card mx-3 mt-3 p-3 rounded-2xl flex items-center gap-3">
        {merchant?.shop_avatar_url ? (
          <img src={merchant.shop_avatar_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
            <Store className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-muted-foreground">推广归属商家</div>
          <div className="text-sm font-medium truncate">
            {merchant?.shop_name ?? "未绑定"}
          </div>
        </div>
        {merchant && (
          <button
            onClick={() => navigate({ to: "/shop/$merchantId", params: { merchantId: merchant.id } })}
            className="text-[11px] text-primary inline-flex items-center gap-0.5"
          >
            <ArrowRightLeft className="h-3 w-3" /> 切换
          </button>
        )}
      </div>

      {/* 二维码 */}
      <div className="bg-card mx-3 mt-3 p-5 rounded-2xl flex flex-col items-center">
        <p className="text-xs text-muted-foreground mb-3">
          扫码邀请好友注册（自动绑定为下级，享分成）
        </p>
        <div id="agent-share-qr" className="bg-white p-3 rounded-xl border border-border">
          <QRCodeSVG value={agentUrl} size={220} level="M" />
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          推广码：<span className="font-mono">{code}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 w-full mt-4">
          <Button variant="outline" onClick={() => copy(url)}>
            <Copy className="h-4 w-4 mr-1" /> 复制
          </Button>
          <Button variant="outline" onClick={downloadQR}>
            <Download className="h-4 w-4 mr-1" /> 保存
          </Button>
          <Button onClick={share}>
            <Share2 className="h-4 w-4 mr-1" /> 分享
          </Button>
        </div>
      </div>

      {/* 分成规则 */}
      <div className="bg-card mx-3 mt-3 p-4 rounded-2xl">
        <div className="text-sm font-medium mb-3">分成规则</div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>· 一级代理（直接推广）</span>
            <span className="text-primary font-semibold">{l1Pct}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span>· 二级代理（间接推广）</span>
            <span className="text-primary font-semibold">{l2Pct}%</span>
          </div>
          <p className="pt-2 border-t border-border leading-relaxed">
            好友通过你的二维码注册并购买商品，你将自动获得对应比例分成。分成实时到账钱包，可随时申请提现。
          </p>
        </div>
      </div>

      {/* 分享话术 */}
      <div className="bg-card mx-3 mt-3 mb-6 p-4 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">推荐话术</div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => copy(`【独家预测】发现一个超准的预测平台，注册即可查看专家精选内容，扫我的码立享专属优惠 👉 ${agentUrl}`)}
          >
            <Copy className="h-3 w-3 mr-1" /> 复制
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed bg-muted rounded-lg p-3">
          【独家预测】发现一个超准的预测平台，注册即可查看专家精选内容，扫我的码立享专属优惠 👉 {agentUrl}
        </p>
      </div>
    </div>
  );
}
