import { createFileRoute, Link, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { BottomNav } from "@/components/h5/bottom-nav";
import { MerchantBottomNav } from "@/components/h5/merchant-bottom-nav";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { fmtDate, fmtMoney } from "@/lib/format";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Share2, Copy } from "lucide-react";
import { buildShareUrl, preloadRelayBase } from "@/lib/share-url";

export const Route = createFileRoute("/shop/$merchantId")({
  validateSearch: z.object({ ref: z.string().optional() }),
  component: ShopPage,
});

interface Product {
  id: string;
  title: string;
  is_recommended: boolean;
  price: number;
  publish_at: string;
  category_id: string;
  merchant_id: string;
  is_public: boolean;
  result: "pending" | "won" | "lost" | string;
  is_affiliated?: boolean;
}

interface Category { id: string; name: string; code: string; }
interface Merchant {
  id: string; shop_name: string; shop_avatar_url: string | null; shop_description: string | null;
}
interface InboxMsg { id: string; title: string; content: string | null; created_at: string; category: string; }

function ShopPage() {
  const { merchantId } = useParams({ from: "/shop/$merchantId" });
  const { ref: refParam } = useSearch({ from: "/shop/$merchantId" });
  const router = useRouter();
  const { user, loading: authLoading, refreshRoles, hasRole } = useAuth();

  // 未登录访客进入店铺：先把 ref+merchantId 暂存到 localStorage（用于登录后回放
  // bind_shop_referrer 完成「客户-代理」绑定），然后立刻跳到登录页。
  // 登录成功后 redirect 回带 ?ref= 的店铺 URL，保留代理绑定链路。
  useEffect(() => {
    if (authLoading || user) return;
    if (typeof window === "undefined") return;
    try {
      const effRef = refParam && refParam.length > 0 ? refParam : `M_${merchantId}`;
      localStorage.setItem("pending_referrer", effRef);
      localStorage.setItem("pending_merchant_id", merchantId);
    } catch {}
    const backPath = refParam
      ? `/shop/${merchantId}?ref=${encodeURIComponent(refParam)}`
      : `/shop/${merchantId}`;
    router.navigate({
      to: "/auth/login",
      search: { redirect: backPath, ref: refParam ?? `M_${merchantId}` } as any,
      replace: true,
    });
  }, [authLoading, user, merchantId, refParam, router]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [ann, setAnn] = useState<InboxMsg | null>(null);
  const [agentInfo, setAgentInfo] = useState<{ is_agent: boolean; bound_merchant_id: string | null } | null>(null);
  const [isShopOwner, setIsShopOwner] = useState(false);
  const [busy, setBusy] = useState(false);

  const [boundMerchantName, setBoundMerchantName] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [agentCode, setAgentCode] = useState<string>("");

  const shareUrl = agentCode
    ? buildShareUrl({ ref: `A_${agentCode}_M_${merchantId}`, to: `/shop/${merchantId}` })
    : "";
  const loadAgent = async () => {
    if (!user) {
      setAgentInfo(null); setIsShopOwner(false); setBoundMerchantName(null); setAgentCode("");
      return;
    }
    const { data: sm } = await supabase
      .from("shop_memberships")
      .select("is_agent, merchant_id, agent_code")
      .eq("user_id", user.id)
      .eq("is_agent", true)
      .limit(1)
      .maybeSingle();
    const ar = sm
      ? { is_agent: true, bound_merchant_id: sm.merchant_id, agent_code: sm.agent_code }
      : { is_agent: false, bound_merchant_id: null, agent_code: null };
    setAgentInfo(ar);

    if (ar.is_agent && ar.bound_merchant_id && ar.bound_merchant_id !== merchantId) {
      const { data: bm } = await supabase
        .from("merchants").select("shop_name").eq("id", ar.bound_merchant_id).maybeSingle();
      setBoundMerchantName(bm?.shop_name ?? "未知商家");
    } else {
      setBoundMerchantName(null);
    }

    let code = ar.agent_code ?? "";
    if (!code) {
      const { data: p } = await supabase.from("profiles").select("user_code").eq("user_id", user.id).maybeSingle();
      code = p?.user_code ?? "";
    }
    setAgentCode(code);

    const { data: m } = await supabase
      .from("merchants").select("id").eq("user_id", user.id).eq("id", merchantId).maybeSingle();
    setIsShopOwner(!!m);

    // 登记入店：登录的非店主、非本店代理用户进入任意店铺即写入 shop_memberships。
    // 一旦写入就锁定终身归属（首次入店决定 upline / 分佣对象）。
    // 关键：必须把 URL 上的 ?ref= 带上，否则代理推广码进来会丢失上线。
    // 优先级：URL refParam > localStorage 暂存的 pending_referrer（仅当配套
    // pending_merchant_id 匹配当前店铺时）> 店铺自带招客户码 M_<mid>。
    // 中转站经 WeChat OAuth 回跳到 /shop/<mid> 时往往丢失 ?ref=，
    // 此时必须从 localStorage 兜底，否则代理上线会丢。
    if (!m && (!ar?.is_agent || ar?.bound_merchant_id !== merchantId)) {
      let pendingRef: string | null = null;
      let pendingMid: string | null = null;
      try {
        pendingRef = localStorage.getItem("pending_referrer");
        pendingMid = localStorage.getItem("pending_merchant_id");
      } catch {}
      const stashedRef = pendingRef && pendingMid === merchantId ? pendingRef : null;
      const effectiveRef = refParam && refParam.length > 0
        ? refParam
        : (stashedRef ?? `M_${merchantId}`);
      const { error: bindErr } = await supabase.rpc("bind_shop_referrer", { _merchant_id: merchantId, _ref: effectiveRef });
      if (!bindErr && stashedRef) {
        // 已经使用过，清掉避免日后访问其他店铺时被错误复用
        try {
          localStorage.removeItem("pending_referrer");
          localStorage.removeItem("pending_merchant_id");
        } catch {}
      }
    }
  };

  useEffect(() => {
    preloadRelayBase();
    // 记住"上次访问的店铺"：无论登录与否，扫码或直链进入后写入 localStorage，
    // 让下次访问 / 时直接进入该店铺；扫描其他店铺二维码会自动覆盖。
    if (typeof window !== "undefined") {
      try { localStorage.setItem("last_shop_id", merchantId); } catch {}
      // 未登录情况下扫了代理/商家二维码到达店铺页：必须把 ref + merchantId 暂存，
      // 登录后由 auth-context 重放调用 bind_shop_referrer 完成「客户-代理」绑定。
      // 之前只有 /?ref=... 路径会暂存，导致中转站直达 /shop/<mid>?ref=... 时丢失绑定。
      if (refParam && !user) {
        try {
          localStorage.setItem("pending_referrer", refParam);
          localStorage.setItem("pending_merchant_id", merchantId);
        } catch {}
      }
    }
    supabase.from("merchants").select("id, shop_name, shop_avatar_url, shop_description").eq("id", merchantId).maybeSingle().then(({ data }) => setMerchant(data));
    supabase.from("lottery_categories").select("id, name, code").order("sort_order").then(({ data }) => setCategories(data ?? []));
    (async () => {
      const { data: srcIds } = await supabase.rpc("shop_source_merchant_ids", { _merchant_id: merchantId });
      const ids = ((srcIds as unknown as string[]) ?? [merchantId]);
      const { data } = await supabase.from("products")
        .select("id, title, is_recommended, price, publish_at, category_id, merchant_id, is_public, result")
        .in("merchant_id", ids).eq("status", "published")
        .order("is_recommended", { ascending: false })
        .order("publish_at", { ascending: false });
      setProducts((data ?? []).map(p => ({ ...p, is_affiliated: p.merchant_id !== merchantId })));
    })();
    if (user) {
      supabase.from("notifications")
        .select("id, title, content, created_at, category")
        .eq("user_id", user.id).eq("is_read", false)
        .order("created_at", { ascending: false }).limit(1)
        .then(({ data }) => setAnn((data?.[0] as InboxMsg | undefined) ?? null));
    } else {
      setAnn(null);
    }
    loadAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, user?.id, refParam]);

  const becomeAgentHere = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("become_agent_for_merchant", { _merchant_id: merchantId });
    setBusy(false);
    if (error) {
      reportRpcError(error, { op: "rpc:become_agent_for_merchant", scope: "ShopPage", payload: { merchantId } });
      toast.error(error.message ?? "申请失败");
      return;
    }
    toast.success("已成为本店代理");
    await refreshRoles();
    loadAgent();
  };

  const performSwitch = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("switch_agent_merchant", { _merchant_id: merchantId });
    setBusy(false);
    setSwitchOpen(false);
    if (error) {
      reportRpcError(error, { op: "rpc:switch_agent_merchant", scope: "ShopPage", payload: { merchantId } });
      toast.error(error.message ?? "切换失败");
      return;
    }
    toast.success("已切换为本店代理");
    await refreshRoles();
    // 重新走归属店铺路由：回到首页，由 index 解析最新 bound_merchant_id
    router.history.push("/");
  };


  const filtered = products
    .filter((p) => activeCat === "all" || p.category_id === activeCat)
    .filter((p) => !keyword || p.title.includes(keyword));

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title={merchant?.shop_name ?? "店铺"} />


      {/* 代理身份 CTA */}
      {user && !isShopOwner && !hasRole("admin") && agentInfo && (
        <AgentCTA
          isAgent={agentInfo.is_agent}
          isBoundHere={agentInfo.bound_merchant_id === merchantId}
          busy={busy}
          onBecome={becomeAgentHere}
          onSwitch={() => setSwitchOpen(true)}
        />
      )}

      {/* 切换归属确认弹窗 */}
      <AlertDialog open={switchOpen} onOpenChange={setSwitchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换代理归属</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>您即将把代理归属切换到 <span className="font-medium text-foreground">{merchant?.shop_name ?? "本店"}</span>。</p>
                <div className="rounded-md bg-muted px-3 py-2 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">当前归属</span>
                    <span className="font-medium text-foreground">{boundMerchantName ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">切换为</span>
                    <span className="font-medium text-primary">{merchant?.shop_name ?? "—"}</span>
                  </div>
                </div>
                <p className="text-xs text-warning">
                  切换后您将立即失去原商家的代理身份，原有上线关系也会被清除，已结算的历史佣金不受影响。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); performSwitch(); }}>
              {busy ? "切换中…" : "确认切换"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* 最新未读消息置顶条 */}
      {ann && (
        <Link
          to="/messages"
          className="mx-3 mt-3 flex items-center gap-3 rounded-xl bg-primary/10 p-3"
        >
          <span className="shrink-0 text-[10px] bg-primary text-primary-foreground rounded px-1.5 py-0.5">
            {ann.category === "announcement" ? "公告" : ann.category === "admin_message" ? "平台" : ann.category === "merchant_message" ? "商家" : "消息"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{ann.title}</div>
            {ann.content && <div className="text-xs text-muted-foreground truncate">{ann.content}</div>}
          </div>
          <span className="text-primary text-lg leading-none">›</span>
        </Link>
      )}

      {/* 搜索 + 栏目筛选 */}
      <div className="px-3 mt-3 flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入关键词搜索"
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
        <select
          className="rounded-md border border-border bg-card px-2 py-2 text-sm focus:outline-none"
          value={activeCat}
          onChange={(e) => setActiveCat(e.target.value)}
        >
          <option value="all">全部栏目</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* 分享 */}
      {agentInfo?.is_agent && agentInfo.bound_merchant_id === merchantId && (
        <div className="mx-3 mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium"
          >
            <Share2 className="h-3.5 w-3.5" /> 分享
          </button>
        </div>
      )}

      {/* 平台公告项 - 仅当有未读公告/消息时显示 */}
      {ann && (
        <div className="bg-card mx-3 mt-3 rounded-md p-3 border-l-2 border-primary">
          <div className="flex items-center justify-between text-xs">
            <span className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded">平台公告</span>
            <span className="text-muted-foreground">{fmtDate(ann.created_at)}</span>
          </div>
        </div>
      )}

      {/* 商品列表 */}
      <main className="flex-1 px-3 py-3 space-y-2">
        {filtered.length === 0 && (
          <p className="text-center py-10 text-sm text-muted-foreground">暂无商品</p>
        )}
        {filtered.map((p) => (
          <Link
            key={p.id}
            to="/product/$productId"
            params={{ productId: p.id }}
            search={{ from: merchantId } as any}
            className="block bg-card rounded-md p-3 border-l-2 border-primary"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex-1 pr-2 line-clamp-2">{p.title}</h3>
              <span className="text-primary font-semibold text-sm">{fmtMoney(p.price)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {p.is_recommended && (
                <span className="inline-block text-[10px] text-primary-foreground bg-primary px-2 py-0.5 rounded">★ 强烈推荐 ★</span>
              )}
              {p.is_affiliated && (
                <span className="inline-block text-[10px] text-info bg-info/10 px-2 py-0.5 rounded">挂靠</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>发布时间</span>
              <span>{fmtDate(p.publish_at)}</span>
            </div>
          </Link>
        ))}
      </main>

      {/* 推广二维码 Dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-[340px]">
          <DialogHeader>
            <DialogTitle>推广二维码</DialogTitle>
            <DialogDescription>
              扫码或复制链接分享给好友，注册并购买后您将获得分成
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="bg-white p-3 rounded-xl border border-border">
              <QRCodeSVG value={shareUrl} size={220} level="M" />
            </div>
            <div className="text-xs text-muted-foreground">
              推广码：<span className="font-mono">{agentCode || "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button
                variant="outline"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(shareUrl); toast.success("已复制链接"); }
                  catch { toast.error("复制失败"); }
                }}
              >
                <Copy className="h-4 w-4 mr-1" /> 复制链接
              </Button>
              <Button onClick={() => router.navigate({ to: "/agent/share" })}>
                更多分享方式
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isShopOwner ? <MerchantBottomNav /> : <BottomNav />}
    </div>
  );
}

function AgentCTA({
  isAgent, isBoundHere, busy, onBecome, onSwitch,
}: {
  isAgent: boolean;
  isBoundHere: boolean;
  busy: boolean;
  onBecome: () => void;
  onSwitch: () => void;
}) {
  if (isAgent && isBoundHere) {
    return (
      <div className="mx-3 mt-3 rounded-xl bg-success/10 text-success px-3 py-2 text-xs flex items-center justify-between">
        <span>✓ 您已是本店代理，可前往代理中心查看推广二维码</span>
      </div>
    );
  }
  if (isAgent && !isBoundHere) {
    return (
      <div className="mx-3 mt-3 rounded-xl bg-warning/10 px-3 py-3 text-xs">
        <p className="text-warning mb-2">您当前是其他商家的代理</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onSwitch} className="w-full">
          切换为本店代理
        </Button>
      </div>
    );
  }
  // 普通用户：不再展示「申请成为本店代理」入口；
  // 代理只能由商家的「代理招募二维码」走审核流程产生。
  return null;
}
