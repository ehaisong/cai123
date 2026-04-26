import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtDate } from "@/lib/format";

type Stats = {
  totalOrders: number;
  totalAmount: number;
  totalRecharge: number;
  totalCommission: number;
  balance: number;
  withdrawCount: number;
  withdrawAmount: number;
};

type ReviewItem = {
  id: string;
  kind: "merchant_app" | "withdraw";
  status: string;
  amount?: number;
  reject_reason?: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

export function AdminUserDetailExtras({
  userId,
  asAgent,
  asMerchantUser,
  ordersLink,
  extraHeader,
}: {
  userId: string;
  asAgent?: boolean;
  asMerchantUser?: boolean;
  ordersLink: ReactNode;
  extraHeader?: ReactNode;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 钱包统计
      const { data: w } = await supabase.from("wallets")
        .select("balance, total_recharge, total_commission").eq("user_id", userId).maybeSingle();

      // 买家订单数 + 累计金额
      const { data: buyerOrders } = await supabase.from("orders")
        .select("amount, status").eq("buyer_id", userId).limit(1000);
      const totalOrders = (buyerOrders ?? []).length;
      const totalAmount = (buyerOrders ?? []).reduce((s: number, o: any) => s + Number(o.amount || 0), 0);

      // 提现统计
      const { data: wd } = await supabase.from("withdrawals")
        .select("amount, status").eq("user_id", userId).limit(500);
      const withdrawCount = (wd ?? []).length;
      const withdrawAmount = (wd ?? []).reduce((s: number, x: any) => s + Number(x.amount || 0), 0);

      // 审核记录：商家申请 + 提现
      const [{ data: apps }, { data: wdAll }] = await Promise.all([
        supabase.from("merchant_applications")
          .select("id, status, reject_reason, created_at, reviewed_at")
          .eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
        supabase.from("withdrawals")
          .select("id, amount, status, reject_reason, created_at, reviewed_at")
          .eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      ]);
      const items: ReviewItem[] = [
        ...((apps ?? []).map((a: any) => ({ id: a.id, kind: "merchant_app" as const, status: a.status, reject_reason: a.reject_reason, created_at: a.created_at, reviewed_at: a.reviewed_at }))),
        ...((wdAll ?? []).map((x: any) => ({ id: x.id, kind: "withdraw" as const, status: x.status, amount: Number(x.amount), reject_reason: x.reject_reason, created_at: x.created_at, reviewed_at: x.reviewed_at }))),
      ].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 15);

      if (cancelled) return;
      setStats({
        totalOrders,
        totalAmount,
        totalRecharge: Number(w?.total_recharge ?? 0),
        totalCommission: Number(w?.total_commission ?? 0),
        balance: Number(w?.balance ?? 0),
        withdrawCount,
        withdrawAmount,
      });
      setReviews(items);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div className="space-y-3">
      {extraHeader}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">统计</div>
        {loading || !stats ? (
          <div className="text-xs text-muted-foreground">加载中…</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="钱包余额" value={fmtMoney(stats.balance)} />
            <Stat label="累计充值" value={fmtMoney(stats.totalRecharge)} />
            {(asAgent || asMerchantUser) && <Stat label="累计佣金/分成" value={fmtMoney(stats.totalCommission)} />}
            <Stat label="买家订单数" value={String(stats.totalOrders)} />
            <Stat label="买家累计金额" value={fmtMoney(stats.totalAmount)} />
            <Stat label="提现次数/金额" value={`${stats.withdrawCount} / ${fmtMoney(stats.withdrawAmount)}`} />
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">审核记录（最近）</div>
        {reviews.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无审核记录</div>
        ) : (
          <div className="space-y-1 max-h-44 overflow-auto">
            {reviews.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="text-xs flex items-start justify-between gap-2 border-b border-border/50 pb-1">
                <div className="flex-1 min-w-0">
                  <div>
                    <span className="font-medium">{r.kind === "merchant_app" ? "商家申请" : "提现"}</span>
                    {r.amount !== undefined && <span className="text-muted-foreground"> · {fmtMoney(r.amount)}</span>}
                    <span className={`ml-2 px-1.5 py-0.5 rounded ${statusClass(r.status)}`}>{labelStatus(r.status)}</span>
                  </div>
                  {r.reject_reason && <div className="text-muted-foreground truncate">原因：{r.reject_reason}</div>}
                </div>
                <div className="text-muted-foreground shrink-0">{fmtDate(r.created_at, "MM-dd HH:mm")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>{ordersLink}</div>
    </div>
  );
}

export function DisableHistory({ isDisabled, reason, at }: { isDisabled: boolean; reason: string | null; at: string | null }) {
  if (!isDisabled && !at) return null;
  return (
    <div className="rounded-md bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs space-y-0.5">
      <div className="font-medium text-destructive">禁用记录</div>
      <div>状态：{isDisabled ? "当前已禁用" : "已恢复"}</div>
      {at && <div>禁用时间：{fmtDate(at)}</div>}
      {reason && <div>原因：{reason}</div>}
    </div>
  );
}

export function OrdersLink({ to, search, label }: { to: string; search: Record<string, string>; label: string }) {
  return (
    <Link to={to} search={search} className="block w-full rounded-md border border-border px-3 py-2 text-center text-sm text-primary hover:bg-accent">
      {label}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}

function statusClass(s: string) {
  if (s === "approved" || s === "paid") return "bg-success/10 text-success";
  if (s === "rejected") return "bg-destructive/10 text-destructive";
  return "bg-warning/10 text-warning";
}
function labelStatus(s: string) {
  return ({ pending: "待审核", approved: "通过", rejected: "驳回", paid: "已打款" } as Record<string, string>)[s] ?? s;
}
