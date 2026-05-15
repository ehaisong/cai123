import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/h5/page-header";
import { Input } from "@/components/ui/input";
import { RouteGuard } from "@/components/route-guard";
import { reportRpcError } from "@/lib/error-logger";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Search } from "lucide-react";

export const Route = createFileRoute("/admin/merchants/$merchantId/agents")({
  component: () => (
    <RouteGuard title="店铺代理" roles={["admin"]} forbiddenText="此页面仅限管理员访问">
      <Inner />
    </RouteGuard>
  ),
});

type Row = {
  user_id: string;
  agent_code: string | null;
  l1_rate: number | null;
  created_at: string;
  nickname: string | null;
  phone: string | null;
  user_code: string | null;
  customer_count: number;
  total_sales: number;
  total_commission: number;
};

function Inner() {
  const { merchantId } = Route.useParams();
  const [shopName, setShopName] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: m } = await supabase.from("merchants").select("shop_name").eq("id", merchantId).maybeSingle();
      setShopName(m?.shop_name ?? "");
      const { data, error } = await supabase.rpc("admin_merchant_agents_with_stats" as any, { _merchant_id: merchantId });
      setLoading(false);
      if (error) { reportRpcError(error, { op: "admin_merchant_agents_with_stats", scope: "AdminMerchantAgents" }); return; }
      setRows((data as any[]) ?? []);
    })();
  }, [merchantId]);

  const filtered = useMemo(() => rows.filter((r) =>
    !keyword.trim() ||
    r.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
    r.agent_code?.toLowerCase().includes(keyword.toLowerCase()) ||
    r.phone?.includes(keyword),
  ), [rows, keyword]);

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title={shopName ? `${shopName} · 代理` : "店铺代理"} />
      <div className="bg-card border-b border-border px-3 py-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input className="h-8 text-sm" placeholder="搜索昵称/代理码/手机号" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <main className="flex-1 px-3 py-3 space-y-2">
        {loading && <p className="text-center py-4 text-sm text-muted-foreground">加载中…</p>}
        {!loading && filtered.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">暂无代理</p>}
        {filtered.map((r) => (
          <div key={r.user_id} className="bg-card rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">{r.nickname ?? "未命名"}</div>
              <span className="text-xs text-primary">
                {r.l1_rate != null ? `${(Number(r.l1_rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%` : "默认"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">代理码 {r.agent_code ?? "-"} · {r.phone ?? "-"}</div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-xs">
                <span className="text-muted-foreground">客户：</span>
                <span className="text-foreground font-medium">{Number(r.customer_count ?? 0)} 人</span>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">成交额：</span>
                <span className="text-foreground font-medium">{fmtMoney(r.total_sales)}</span>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">佣金额：</span>
                <span className="text-success font-medium">{fmtMoney(r.total_commission)}</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">加入：{fmtDate(r.created_at)}</div>
          </div>
        ))}
      </main>
    </div>
  );
}
