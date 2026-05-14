import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PaymentService, type PayType } from "@/lib/payment-service";
import { toast } from "sonner";

export const Route = createFileRoute("/product/$productId")({
  validateSearch: (s: Record<string, unknown>) => ({ from: typeof s.from === "string" ? s.from : undefined }),
  component: ProductDetailPage,
});

interface Product {
  id: string; merchant_id: string; title: string; subtitle: string | null;
  is_recommended: boolean; price: number; disclaimer: string | null;
}
interface Issue {
  id: string; issue_no: string; paid_content: string | null;
  publish_at: string; reveal_at: string | null;
  result: "pending" | "won" | "lost"; result_note: string | null;
}

function ProductDetailPage() {
  const { productId } = useParams({ from: "/product/$productId" });
  const { from } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [current, setCurrent] = useState<Issue | null>(null);
  const [history, setHistory] = useState<Issue[]>([]);
  const [purchased, setPurchased] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [buying, setBuying] = useState(false);
  const [payFailed, setPayFailed] = useState<string | null>(null);
  const [lastPayType, setLastPayType] = useState<PayType | null>(null);

  const load = async () => {
    const { data: p } = await supabase.from("products")
      .select("id, merchant_id, title, subtitle, is_recommended, price, disclaimer")
      .eq("id", productId).maybeSingle();
    setProduct(p as Product | null);

    let owner = false;
    if (user && p) {
      const { data: m } = await supabase.from("merchants")
        .select("id").eq("id", (p as Product).merchant_id).eq("user_id", user.id).maybeSingle();
      owner = !!m;
    }
    setIsOwner(owner);

    const { data: issues } = await supabase.from("product_issues")
      .select("id, issue_no, paid_content, publish_at, reveal_at, result, result_note")
      .eq("product_id", productId)
      .eq("status", "published")
      .lte("publish_at", new Date().toISOString())
      .order("publish_at", { ascending: false })
      .limit(20);
    const list = (issues ?? []) as Issue[];
    setCurrent(list[0] ?? null);
    setHistory(list.slice(1));

    if (user && list[0] && !owner) {
      const { data: ord } = await supabase.from("orders").select("id")
        .eq("buyer_id", user.id).eq("issue_id", list[0].id).eq("status", "paid").maybeSingle();
      setPurchased(!!ord);
    } else {
      setPurchased(false);
    }
  };

  useEffect(() => { load(); }, [productId, user?.id]);

  // 检测访问环境
  const [env, setEnv] = useState<"detecting" | "wechat" | "browser">("detecting");
  useEffect(() => {
    const update = () => setEnv(PaymentService.isWechat() ? "wechat" : "browser");
    update();
    document.addEventListener("WeixinJSBridgeReady", update, false);
    const t = window.setTimeout(update, 300);
    return () => {
      document.removeEventListener("WeixinJSBridgeReady", update, false);
      window.clearTimeout(t);
    };
  }, []);

  // 用户从外部浏览器回到本页时，轮询订单确认支付，自动解锁
  useEffect(() => {
    if (!user || !current || purchased || isOwner) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const { data: ord } = await supabase
        .from("orders")
        .select("id")
        .eq("buyer_id", user.id)
        .eq("issue_id", current.id)
        .eq("status", "paid")
        .maybeSingle();
      if (ord) {
        setPurchased(true);
        return;
      }
      window.setTimeout(tick, 4000);
    };
    const t = window.setTimeout(tick, 4000);
    return () => {
      stopped = true;
      window.clearTimeout(t);
    };
  }, [user, current, purchased, isOwner]);

  const [showPay, setShowPay] = useState(false);

  const startPayment = async (payType: PayType) => {
    if (!user) { navigate({ to: "/auth/login", search: { redirect: `/product/${productId}` } }); return; }
    if (!current) return;
    setShowPay(false);
    setBuying(true);
    try {
      const { data, error } = await supabase.rpc(
        "create_product_payment_order" as never,
        { _product_id: productId, _issue_id: current.id, _pay_type: payType, _shop_merchant_id: from ?? null } as never,
      );
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? (data as Array<{ order_no: string; amount: number; subject: string }>)[0] : (data as { order_no: string; amount: number; subject: string });
      if (!row?.order_no) throw new Error("创建支付订单失败");
      await PaymentService.pay({
        orderNo: row.order_no,
        amountYuan: Number(row.amount),
        payType,
        subject: row.subject || product?.title || "付费内容",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBuying(false);
    }
  };

  const handleBuyClick = () => {
    if (!user) { navigate({ to: "/auth/login", search: { redirect: `/product/${productId}` } }); return; }
    if (!current || buying) return;
    // 微信内：直接拉起微信支付，不弹选择框
    if (env === "wechat") {
      startPayment("wechat");
      return;
    }
    // 外部浏览器：弹出支付方式选择
    setShowPay(true);
  };

  if (!product) {
    return (
      <div className="h5-shell">
        <PageHeader title="我的思考日志" />
        <p className="text-center py-20 text-muted-foreground text-sm">加载中…</p>
      </div>
    );
  }

  const result = current?.result ?? "pending";
  const stamp = result === "won" ? <div className="stamp stamp-won">中奖</div> : result === "lost" ? <div className="stamp stamp-lost">未中</div> : null;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="我的思考日志" />

      {/* 标题卡 */}
      <div className="bg-card mx-3 mt-3 rounded-xl p-4 relative">
        <h2 className="text-lg font-bold pr-16">{product.title}</h2>
        {current && <div className="text-xs text-muted-foreground mt-1">第 {current.issue_no} 期</div>}
        {product.is_recommended && (
          <div className="mt-2">
            <span className="inline-block text-xs text-primary-foreground bg-primary px-3 py-0.5 rounded">★ 强烈推荐 ★</span>
          </div>
        )}
        {current && <div className="mt-3 text-sm text-muted-foreground">发布于 <span className="text-foreground">{fmtDate(current.publish_at)}</span></div>}
        {current?.reveal_at && (
          <div className="mt-1 text-sm text-muted-foreground">公开于 <span className="text-warning">{fmtDate(current.reveal_at)}</span></div>
        )}
        {stamp && <div className="absolute top-3 right-3">{stamp}</div>}
      </div>

      {/* 免责声明 */}
      <div className="bg-card mx-3 mt-3 rounded-xl p-4">
        <div className="mb-2"><span className="text-xs text-warning bg-warning/10 px-2 py-1 rounded">免责声明</span></div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {product.disclaimer ?? "本付费内容为电子虚拟物品，解锁后不支持退款，所有文字、图片仅供参考，不保证连续性及任何承诺，自愿付费谨慎购买下单，购买即接受协议，本声明具有法律效力依据，请悉知！"}
        </p>
      </div>

      {/* 付费内容 */}
      <div className="bg-card mx-3 mt-3 rounded-xl p-4">
        <div className="mb-2"><span className="text-xs text-primary bg-accent px-2 py-1 rounded">付费内容</span></div>
        {!current ? (
          <div className="py-4 text-center text-sm text-muted-foreground">商家暂未发布最新一期</div>
        ) : purchased || isOwner ? (
          <div className="text-base text-foreground whitespace-pre-wrap leading-relaxed">
            {isOwner && <div className="mb-2 text-xs text-success bg-success/10 inline-block px-2 py-0.5 rounded">商家本人预览</div>}
            {current.paid_content ?? "（暂无内容）"}
          </div>
        ) : (
          <div className="py-4">
            <div className="bg-muted rounded-lg py-8 text-center mb-3">
              <p className="text-muted-foreground text-sm">🔒 内容已加密，购买后查看</p>
            </div>
            <Button
              className="w-full bg-primary hover:bg-primary/90"
              size="lg"
              onClick={handleBuyClick}
              disabled={buying || env === "detecting"}
            >
              {buying
                ? "正在拉起支付…"
                : env === "detecting"
                  ? "准备中…"
                  : env === "wechat"
                    ? `微信支付 ¥${Number(product.price).toFixed(2)}`
                    : `立即购买 ¥${Number(product.price).toFixed(2)}`}
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground text-center">
              {env === "wechat" ? "微信内将直接拉起支付，完成后自动解锁内容" : "支持微信 / 支付宝，支付完成后自动解锁内容"}
            </p>
          </div>
        )}
      </div>

      <Sheet open={showPay} onOpenChange={setShowPay}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>选择支付方式</SheetTitle>
          </SheetHeader>
          <div className="py-4 space-y-3">
            <div className="text-center text-2xl font-bold text-primary">¥{Number(product.price).toFixed(2)}</div>
            <div className="text-center text-xs text-muted-foreground">{product.title}</div>
            <Button className="w-full bg-[#07C160] hover:bg-[#07C160]/90 text-white" size="lg" onClick={() => startPayment("wechat")} disabled={buying}>
              微信支付
            </Button>
            <Button className="w-full bg-[#1677FF] hover:bg-[#1677FF]/90 text-white" size="lg" onClick={() => startPayment("alipay")} disabled={buying}>
              支付宝支付
            </Button>
            <p className="text-[11px] text-muted-foreground text-center pt-1">支付完成后将自动解锁内容</p>
          </div>
        </SheetContent>
      </Sheet>

      {/* 往期记录 */}
      <div className="bg-card mx-3 mt-3 mb-6 rounded-xl p-4">
        <div className="mb-3"><span className="text-xs text-info bg-info/10 px-2 py-1 rounded">往期记录</span></div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">暂无往期记录</p>
        ) : (
          <div className="divide-y divide-border">
            {history.map((h) => (
              <div key={h.id} className="py-3 relative">
                <div className="text-sm">第 {h.issue_no} 期</div>
                {h.result !== "pending" && h.paid_content && (
                  <div className="text-warning text-base font-medium mt-1 whitespace-pre-wrap">{h.paid_content}</div>
                )}
                <div className="text-xs text-muted-foreground mt-1">发布于：{fmtDate(h.publish_at)}</div>
                <div className="absolute right-0 top-3">
                  {h.result === "won" ? <div className="stamp stamp-won">中奖</div>
                    : h.result === "lost" ? <div className="stamp stamp-lost">未中</div>
                    : <span className="text-xs text-warning">待判定</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
