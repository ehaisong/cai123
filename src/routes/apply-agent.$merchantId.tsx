import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { reportRpcError } from "@/lib/error-logger";

export const Route = createFileRoute("/apply-agent/$merchantId")({
  component: ApplyAgentPage,
});

function ApplyAgentPage() {
  const { merchantId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [merchant, setMerchant] = useState<any>(null);
  const [existing, setExisting] = useState<any>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return; // 等 auth 初始化完再拉数据
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: m, error: mErr } = await supabase
          .from("merchants")
          .select("id, shop_name, shop_avatar_url, status, user_id")
          .eq("id", merchantId)
          .maybeSingle();
        if (mErr) console.warn("[apply-agent] load merchant error", mErr);
        if (cancelled) return;
        setMerchant(m ?? null);
        if (user) {
          const { data: a, error: aErr } = await supabase
            .from("agent_applications")
            .select("*")
            .eq("user_id", user.id)
            .eq("merchant_id", merchantId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (aErr) console.warn("[apply-agent] load application error", aErr);
          if (cancelled) return;
          setExisting(a ?? null);
        } else {
          setExisting(null);
        }
      } catch (e) {
        console.warn("[apply-agent] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [merchantId, user?.id, authLoading]);

  const submit = async () => {
    if (!user) {
      try { sessionStorage.setItem("pending_apply_agent", merchantId); } catch {}
      navigate({ to: "/auth/login", search: { redirect: `/apply-agent/${merchantId}` } as any });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("apply_agent_for_merchant" as any, {
      _merchant_id: merchantId,
      _note: note || null,
    });
    setBusy(false);
    if (error) {
      reportRpcError(error, { op: "rpc:apply_agent_for_merchant", scope: "ApplyAgent" });
      toast.error(error.message ?? "提交失败");
      return;
    }
    toast.success("申请已提交，请等待商家审核");
    setExisting({ status: "pending", note });
  };

  // 登录前点过"登录并申请"会写入 pending_apply_agent；登录回流后自动提交一次。
  useEffect(() => {
    if (authLoading || loading) return;
    if (!user || !merchant || merchant.status !== "approved") return;
    if (merchant.user_id === user.id) return;
    if (existing?.status === "pending" || existing?.status === "approved") return;
    let pending: string | null = null;
    try { pending = sessionStorage.getItem("pending_apply_agent"); } catch {}
    if (pending !== merchantId) return;
    try { sessionStorage.removeItem("pending_apply_agent"); } catch {}
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, loading, user?.id, merchant?.id, merchant?.status, existing?.status]);

  if (authLoading || loading) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="申请成为代理" />
        <div className="flex-1 p-6 text-center text-sm text-muted-foreground">加载中…</div>
      </div>
    );
  }

  if (!merchant || merchant.status !== "approved") {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="申请成为代理" />
        <div className="flex-1 p-6 text-center text-sm text-muted-foreground">商家不存在或未通过审核</div>
      </div>
    );
  }

  const isOwner = user && merchant.user_id === user.id;

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="申请成为代理" />

      <div className="bg-card mx-3 mt-3 rounded-2xl p-4 flex items-center gap-3">
        {merchant.shop_avatar_url ? (
          <img src={merchant.shop_avatar_url} className="w-12 h-12 rounded-full object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-accent" />
        )}
        <div>
          <div className="text-sm font-semibold">{merchant.shop_name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">申请成为本店代理，分享赚佣金</div>
        </div>
      </div>

      {isOwner && (
        <div className="mx-3 mt-3 p-3 rounded bg-warning/10 text-warning text-sm">商家本人无法申请代理</div>
      )}

      {existing?.status === "pending" && (
        <div className="mx-3 mt-3 p-3 rounded bg-warning/10 text-warning text-sm">您已提交申请，正在等待商家审核…</div>
      )}
      {existing?.status === "approved" && (
        <div className="mx-3 mt-3 p-3 rounded bg-success/10 text-success text-sm">申请已通过，您已是本店代理</div>
      )}
      {existing?.status === "rejected" && (
        <div className="mx-3 mt-3 p-3 rounded bg-destructive/10 text-destructive text-sm">
          上次申请被驳回{existing.reject_reason ? `：${existing.reject_reason}` : ""}，您可重新提交
        </div>
      )}

      {!isOwner && existing?.status !== "pending" && existing?.status !== "approved" && (
        <>
          <div className="px-3 pt-4 pb-2 text-sm text-muted-foreground">申请说明（选填）</div>
          <div className="bg-card mx-3 rounded-xl p-3">
            <Textarea
              rows={4}
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="简单介绍一下自己，便于商家审核…"
              className="border-0 shadow-none focus-visible:ring-0 resize-none px-0"
            />
            <div className="text-right text-xs text-muted-foreground">{note.length}/200</div>
          </div>

          <div className="px-3 pt-6">
            <Button className="w-full" size="lg" onClick={submit} disabled={busy}>
              {busy ? "提交中…" : user ? "提 交 申 请" : "登 录 并 申 请"}
            </Button>
          </div>
        </>
      )}

      <div className="mx-3 mt-6 mb-6 p-4 rounded-xl bg-muted/50 text-xs text-muted-foreground space-y-1">
        <p>· 申请提交后由商家审核，通过后您将成为该店代理</p>
        <p>· 成为代理后可在「代理中心」查看推广二维码与佣金</p>
        <p>· 若您已是其他商家的代理，审核通过后将新增本店绑定，但不会自动切换活跃归属</p>
      </div>
    </div>
  );
}
