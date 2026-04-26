import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, XCircle, Store, Plus, Package, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/merchant/shop")({
  component: MerchantShopPage,
});

function MerchantShopPage() {
  return (
    <RouteGuard title="店铺管理" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <MerchantShopPageInner />
    </RouteGuard>
  );
}

function MerchantShopPageInner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchant, setMerchant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ shop_name: "", shop_description: "", shop_avatar_url: "", payment_channel_id: "" as string | "" });
  const [channels, setChannels] = useState<{ id: string; name: string; provider: string }[]>([]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const [{ data: m }, { data: ch }] = await Promise.all([
        supabase.from("merchants").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("payment_channels").select("id,name,provider").eq("is_enabled", true).order("sort_order"),
      ]);
      setMerchant(m);
      setChannels((ch ?? []) as any);
      if (m) {
        setForm({
          shop_name: m.shop_name ?? "",
          shop_description: m.shop_description ?? "",
          shop_avatar_url: m.shop_avatar_url ?? "",
          payment_channel_id: (m as any).payment_channel_id ?? "",
        });
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const save = async () => {
    if (!merchant) return;
    if (!form.shop_name.trim()) { toast.error("请填写店铺名称"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("merchants")
      .update({
        shop_name: form.shop_name,
        shop_description: form.shop_description,
        shop_avatar_url: form.shop_avatar_url,
        payment_channel_id: form.payment_channel_id || null,
      })
      .eq("id", merchant.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("店铺信息已更新");
    setMerchant({ ...merchant, ...form });
  };

  if (!user) {
    return (
      <div className="h5-shell">
        <PageHeader title="店铺信息" />
        <div className="p-6 text-center">
          <Button onClick={() => navigate({ to: "/auth/login" })}>请先登录</Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="h5-shell"><PageHeader title="店铺信息" /><div className="p-6 text-center text-sm text-muted-foreground">加载中…</div></div>;
  }

  if (!merchant) {
    return (
      <div className="h5-shell">
        <PageHeader title="店铺信息" />
        <div className="p-6 text-center text-sm text-muted-foreground">
          您还未申请商家入驻。
          <div className="mt-3">
            <Button onClick={() => navigate({ to: "/merchant/apply" })}>去申请入驻</Button>
          </div>
        </div>
      </div>
    );
  }

  const status = merchant.status as "pending" | "approved" | "rejected" | string;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="店铺信息" />

      {/* 审核状态卡 */}
      <div className="mx-3 mt-3 rounded-2xl bg-card p-4">
        {status === "approved" && (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-success" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-success">店铺审核已通过</div>
              <div className="mt-0.5 text-xs text-muted-foreground">您可以发布商品并开始经营</div>
            </div>
          </div>
        )}
        {status === "pending" && (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
              <Clock className="w-6 h-6 text-warning" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-warning">审核中</div>
              <div className="mt-0.5 text-xs text-muted-foreground">资料已提交，请耐心等待</div>
            </div>
          </div>
        )}
        {status === "rejected" && (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-destructive">审核未通过</div>
              <div className="mt-0.5 text-xs text-muted-foreground">请重新提交申请</div>
            </div>
          </div>
        )}
      </div>

      {/* 店铺概览 */}
      <div className="mx-3 mt-3 rounded-2xl bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-accent flex items-center justify-center overflow-hidden">
            {merchant.shop_avatar_url
              ? <img src={merchant.shop_avatar_url} className="w-full h-full object-cover" alt="店铺头像" />
              : <Store className="w-7 h-7 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{merchant.shop_name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">累计销售：¥{Number(merchant.total_sales ?? 0).toFixed(2)}</div>
          </div>
          <Link
            to="/shop/$merchantId"
            params={{ merchantId: merchant.id }}
            className="inline-flex items-center gap-1 text-xs text-info"
          >
            <ExternalLink className="w-3.5 h-3.5" /> 查看店铺
          </Link>
        </div>
      </div>

      {/* 编辑店铺资料 */}
      {status === "approved" && (
        <>
          <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">店铺资料</div>
          <div className="bg-card mx-3 rounded-xl divide-y divide-border">
            <Row label="店铺名称">
              <Input
                value={form.shop_name}
                onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
                placeholder="请输入店铺名称"
                className="border-0 shadow-none focus-visible:ring-0 px-0"
              />
            </Row>
            <Row label="店铺头像">
              <Input
                value={form.shop_avatar_url}
                onChange={(e) => setForm({ ...form, shop_avatar_url: e.target.value })}
                placeholder="头像图片 URL（选填）"
                className="border-0 shadow-none focus-visible:ring-0 px-0"
              />
            </Row>
            <Row label="收款通道">
              <select
                value={form.payment_channel_id}
                onChange={(e) => {
                  setForm({ ...form, payment_channel_id: e.target.value });
                  toast("通道已切换，请点击下方「保存店铺信息」生效", { duration: 3500 });
                }}
                className="w-full bg-transparent text-sm py-1 outline-none"
              >
                <option value="">未选择</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.provider === "wechat" ? "微信" : c.provider === "alipay" ? "支付宝" : "自定义"}）
                  </option>
                ))}
              </select>
            </Row>
          </div>

          {/* 当前通道状态说明 */}
          <div className="mx-3 mt-2">
            {(() => {
              const saved = (merchant as any).payment_channel_id as string | null;
              const cur = saved ? channels.find((c) => c.id === saved) : null;
              const dirty = (form.payment_channel_id || "") !== (saved || "");
              if (cur) {
                return (
                  <div className="rounded-md bg-success/5 border border-success/20 p-2.5 text-xs text-success">
                    当前生效通道：<span className="font-medium">{cur.name}</span>
                    （{cur.provider === "wechat" ? "微信支付" : cur.provider === "alipay" ? "支付宝" : "自定义"}）
                    {dirty && <span className="ml-2 text-warning">· 已修改未保存</span>}
                  </div>
                );
              }
              if (saved && !cur) {
                return (
                  <div className="rounded-md bg-warning/5 border border-warning/20 p-2.5 text-xs text-warning">
                    原通道已被管理员禁用或删除，当前买家无法在线付款，请重新选择并保存。
                  </div>
                );
              }
              return (
                <div className="rounded-md bg-muted/40 border border-border p-2.5 text-xs text-muted-foreground">
                  暂未选择收款通道，买家暂不支持在线付款（订单将无法完成支付）。请在上方下拉中选择并保存。
                  {dirty && <span className="ml-2 text-warning">· 已修改未保存</span>}
                </div>
              );
            })()}
          </div>

          <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">店铺简介</div>
          <div className="bg-card mx-3 rounded-xl p-3">
            <Textarea
              rows={4}
              maxLength={200}
              value={form.shop_description}
              onChange={(e) => setForm({ ...form, shop_description: e.target.value })}
              placeholder="向买家介绍您的店铺…"
              className="border-0 shadow-none focus-visible:ring-0 resize-none px-0"
            />
            <div className="text-right text-xs text-muted-foreground">{form.shop_description.length}/200</div>
          </div>

          <div className="px-3 pt-4">
            <Button className="w-full" size="lg" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存店铺信息"}
            </Button>
          </div>

          {/* 快速入口 */}
          <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">快速操作</div>
          <div className="bg-card mx-3 mb-6 rounded-2xl p-4 grid grid-cols-2 gap-3">
            <Link
              to="/merchant/products/new"
              className="flex items-center gap-2 rounded-xl border border-border p-3 hover:bg-accent/40"
            >
              <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center">
                <Plus className="w-5 h-5 text-success" />
              </div>
              <span className="text-sm font-medium">发布商品</span>
            </Link>
            <Link
              to="/merchant/products"
              className="flex items-center gap-2 rounded-xl border border-border p-3 hover:bg-accent/40"
            >
              <div className="w-9 h-9 rounded-full bg-info/10 flex items-center justify-center">
                <Package className="w-5 h-5 text-info" />
              </div>
              <span className="text-sm font-medium">商品管理</span>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center px-4 py-3">
      <div className="w-20 text-sm font-medium">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
