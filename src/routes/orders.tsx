import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { BottomNav } from "@/components/h5/bottom-nav";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/orders")({
  component: OrdersPage,
});

interface OrderRow {
  id: string; amount: number; status: string; paid_at: string | null; created_at: string;
  product_id: string; merchant_id: string;
  products: { title: string } | null;
  merchants: { shop_name: string } | null;
}

function OrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<OrderRow[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("orders")
      .select("id, amount, status, paid_at, created_at, product_id, merchant_id, products(title), merchants(shop_name)")
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setList((data ?? []) as any));
  }, [user?.id]);

  if (!user) {
    return (
      <div className="h5-shell flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 h-12 bg-card border-b border-border flex items-center justify-center"><h1 className="font-medium">我的订单</h1></header>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-muted-foreground text-sm">请登录后查看订单</p>
          <Button onClick={() => navigate({ to: "/auth/login" })}>去登录</Button>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 h-12 bg-card border-b border-border flex items-center justify-center">
        <h1 className="font-medium">我的订单</h1>
      </header>
      <main className="flex-1 px-3 py-3 space-y-2">
        {list.length === 0 && <p className="text-center py-12 text-sm text-muted-foreground">暂无订单</p>}
        {list.map((o) => (
          <Link
            key={o.id}
            to="/product/$productId"
            params={{ productId: o.product_id }}
            className="block bg-card rounded-md p-3"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{o.merchants?.shop_name ?? "—"}</span>
              <span className={o.status === "paid" ? "text-success" : ""}>{o.status === "paid" ? "已支付" : o.status}</span>
            </div>
            <div className="text-sm font-medium line-clamp-1">{o.products?.title ?? "商品"}</div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-muted-foreground">{fmtDate(o.paid_at ?? o.created_at)}</span>
              <span className="text-primary font-semibold">{fmtMoney(o.amount)}</span>
            </div>
          </Link>
        ))}
      </main>
      <BottomNav />
    </div>
  );
}
