import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/payment-logs")({
  component: AdminPaymentLogs,
});

interface PayLogRow {
  id: string;
  order_no: string | null;
  source: string;
  stage: string;
  level: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

function AdminPaymentLogs() {
  const [orderNo, setOrderNo] = useState("");
  const [rows, setRows] = useState<PayLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (q: string) => {
    setLoading(true);
    let query = supabase
      .from("payment_logs" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (q.trim()) query = query.ilike("order_no", `%${q.trim()}%`);
    const { data, error } = await query;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as unknown as PayLogRow[]);
  };

  useEffect(() => {
    void load("");
  }, []);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="支付日志" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <Card className="p-3 space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="按订单号搜索（支持模糊）"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load(orderNo);
              }}
            />
            <Button onClick={() => void load(orderNo)} disabled={loading}>
              查询
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            来源 frontend = 前端流程；gateway-notify = 网关异步回调。最多展示 200 条。
          </p>
        </Card>

        <div className="space-y-2">
          {rows.length === 0 && !loading && (
            <p className="text-sm text-center text-muted-foreground py-6">无日志</p>
          )}
          {rows.map((r) => (
            <Card key={r.id} className="p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={r.level === "error" ? "destructive" : r.level === "warn" ? "secondary" : "outline"}>
                  {r.level}
                </Badge>
                <Badge variant="outline">{r.source}</Badge>
                <Badge>{r.stage}</Badge>
                <span className="ml-auto text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("zh-CN")}
                </span>
              </div>
              {r.order_no && <div className="font-mono text-[11px]">订单：{r.order_no}</div>}
              {r.message && <div>{r.message}</div>}
              {r.payload && Object.keys(r.payload).length > 0 && (
                <pre className="bg-muted/50 rounded p-2 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              )}
              {r.ip && <div className="text-muted-foreground">IP: {r.ip}</div>}
              {r.user_agent && (
                <div className="text-muted-foreground truncate" title={r.user_agent}>
                  UA: {r.user_agent}
                </div>
              )}
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
