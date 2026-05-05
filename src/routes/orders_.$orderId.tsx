import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/orders/$orderId")({
  component: OrderDetailPage,
});

interface OrderDetail {
  id: string;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  product_id: string;
  merchant_id: string;
  issue_id: string | null;
  products: { title: string; subtitle: string | null } | null;
  merchants: { shop_name: string } | null;
  product_issues: { issue_no: string; paid_content: string | null; result: string } | null;
}

function OrderDetailPage() {
  const { orderId } = useParams({ from: "/orders/$orderId" });
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth/login", search: { redirect: `/orders/${orderId}` } });
      return;
    }
    supabase
      .from("orders")
      .select(
        "id, amount, status, paid_at, created_at, product_id, merchant_id, issue_id, products(title, subtitle), merchants(shop_name), product_issues(issue_no, paid_content, result)"
      )
      .eq("id", orderId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setNotFound(true);
        else setOrder(data as any);
      });
  }, [orderId, user?.id, loading]);

  if (notFound) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <PageHeader title="订单详情" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">订单不存在或无权限查看</p>
          <Button onClick={() => navigate({ to: "/orders" })}>返回订单列表</Button>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="h5-shell">
        <PageHeader title="订单详情" />
        <p className="text-center py-20 text-muted-foreground text-sm">加载中…</p>
      </div>
    );
  }

  const paid = order.status === "paid";
  const statusText: Record<string, string> = {
    paid: "已支付",
    pending: "待支付",
    refunded: "已退款",
    cancelled: "已取消",
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="订单详情" />

      <div className="bg-card mx-3 mt-3 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">订单状态</span>
          <span className={paid ? "text-success font-semibold" : "text-warning font-semibold"}>
            {statusText[order.status] ?? order.status}
          </span>
        </div>
        <div className="text-2xl font-bold text-primary">{fmtMoney(order.amount)}</div>
      </div>

      <div className="bg-card mx-3 mt-3 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">店铺</span><span>{order.merchants?.shop_name ?? "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">商品</span><span className="text-right max-w-[60%] line-clamp-2">{order.products?.title ?? "—"}</span></div>
        {order.product_issues?.issue_no && (
          <div className="flex justify-between"><span className="text-muted-foreground">期号</span><span>第 {order.product_issues.issue_no} 期</span></div>
        )}
        <div className="flex justify-between"><span className="text-muted-foreground">下单时间</span><span>{fmtDate(order.created_at)}</span></div>
        {order.paid_at && (
          <div className="flex justify-between"><span className="text-muted-foreground">支付时间</span><span>{fmtDate(order.paid_at)}</span></div>
        )}
        <div className="flex justify-between"><span className="text-muted-foreground">订单号</span><span className="text-xs font-mono">{order.id.slice(0, 8)}…</span></div>
      </div>

      {paid && order.product_issues?.paid_content && (
        <div className="bg-card mx-3 mt-3 rounded-xl p-4">
          <div className="mb-2"><span className="text-xs text-primary bg-accent px-2 py-1 rounded">已解锁内容</span></div>
          <div className="text-base whitespace-pre-wrap leading-relaxed">{order.product_issues.paid_content}</div>
        </div>
      )}

      <div className="mx-3 mt-4 mb-6 space-y-2">
        <Link to="/product/$productId" params={{ productId: order.product_id }}>
          <Button variant="outline" className="w-full">查看商品</Button>
        </Link>
        <Link to="/orders">
          <Button variant="ghost" className="w-full">返回订单列表</Button>
        </Link>
      </div>
    </div>
  );
}
