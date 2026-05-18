// 13pay（彩虹易支付）测试页
// 流程：创建订单 → /api/public/pay-13pay-create → 拿 payUrl → 跳转 13pay 收银台
//   → 13pay 完成后自动回跳 /pay/return?orderNo=...（该页轮询订单状态）
// 微信内/外通用；微信内 13pay 收银台会自动拉起支付键盘。
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentService } from "@/lib/payment-service";
import { toast } from "sonner";
import { reportRpcError } from "@/lib/error-logger";

export const Route = createFileRoute("/pay/test-13pay")({
  component: Test13Page,
});

function isWechat() {
  if (typeof window === "undefined") return false;
  return /micromessenger|wechat|weixin/i.test(navigator.userAgent || "");
}

type LogLine = { t: string; level: "info" | "ok" | "err"; msg: string };

function Test13Page() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const inWechat = isWechat();
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth/login" });
  }, [loading, user, navigate]);

  useEffect(() => () => { stopRef.current?.(); }, []);

  const push = (level: LogLine["level"], msg: string) =>
    setLogs((prev) => [...prev, { t: new Date().toLocaleTimeString(), level, msg }]);

  const startPay = async () => {
    if (!user) return;
    if (!(amount >= 1)) { toast.error("最低 1 元"); return; }
    setBusy(true);
    setPaid(false);
    setQrcode(null);
    setLogs([]);
    setOrderNo(null);

    push("info", `创建订单 ${amount.toFixed(2)} 元`);
    const subject = `13pay 测试 ${amount.toFixed(2)}元`;
    const { data: oNo, error } = await supabase.rpc("create_payment_order", {
      _amount: amount,
      _pay_type: "wechat",
      _subject: subject,
      _purpose: "test",
    });
    if (error || !oNo) {
      reportRpcError(error, { op: "rpc:create_payment_order", scope: "13pay-test" });
      push("err", `创建订单失败：${error?.message ?? "未知"}`);
      setBusy(false);
      return;
    }
    setOrderNo(String(oNo));
    push("ok", `订单号 ${oNo}`);

    push("info", "请求 /api/public/pay-13pay-create");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    let resp: Response;
    try {
      resp = await fetch("/api/public/pay-13pay-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderNo: oNo, payType: "wechat" }),
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      push("err", `网络错误：${m}`);
      setBusy(false);
      return;
    }
    let data: {
      success?: boolean; error?: string;
      payType?: string;
      payUrl?: string | null; qrcode?: string | null; urlscheme?: string | null;
      tradeNo?: string;
    } = {};
    try { data = await resp.json(); } catch { /* ignore */ }
    if (!data.success) {
      push("err", `13pay 返回失败：${data.error ?? `HTTP ${resp.status}`}`);
      setBusy(false);
      return;
    }
    push("ok", `13pay pay_type=${data.payType}，trade_no=${data.tradeNo}`);

    // 启动轮询（即使页面跳走，回到 /pay/return 也会继续轮询；这里是保险）
    startPolling(String(oNo));

    if (data.payType === "jump" && data.payUrl) {
      push("info", `1 秒后跳转 13pay 收银台…付完会自动回到本站 /pay/return`);
      setTimeout(() => {
        window.location.href = data.payUrl as string;
      }, 1000);
      return;
    }
    if (data.payType === "qrcode" && data.qrcode) {
      setQrcode(data.qrcode);
      push("info", "请使用对应 App 扫码完成支付");
      return;
    }
    if (data.payType === "scheme" && data.urlscheme) {
      push("info", `跳转 scheme：${data.urlscheme}`);
      window.location.href = data.urlscheme;
      return;
    }
    push("err", `未处理的 pay_type=${data.payType}`);
    setBusy(false);
  };

  const startPolling = (oNo: string) => {
    stopRef.current?.();
    stopRef.current = PaymentService.startPolling(
      oNo,
      () => {
        push("ok", "✅ 后端确认订单已支付");
        setPaid(true);
        setBusy(false);
      },
      (r) => {
        push("err", `轮询结束：${r}`);
        setBusy(false);
      },
      2500,
      3 * 60 * 1000,
    );
  };

  const manualQuery = async () => {
    if (!orderNo) return;
    const r = await PaymentService.queryOrder(orderNo);
    push("info", `手动查询：${JSON.stringify(r)}`);
    if (r.tradeStatus === "SUCCESS") setPaid(true);
  };

  return (
    <div className="h5-shell flex min-h-screen flex-col">
      <PageHeader title="13pay 测试" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <Card className="p-4 space-y-3">
          <div className="text-xs rounded-md bg-muted p-3 leading-relaxed text-muted-foreground space-y-1">
            <p>当前环境：<strong>{inWechat ? "微信内" : "外部浏览器"}</strong></p>
            <p>此通道走 <strong>跳转支付</strong>，付款后页面会自动回跳到 <code>/pay/return</code>，无需手动重新打开本站。</p>
            <p>通道配置：管理后台 → 支付通道 → 13pay（apiBase / pid / key）</p>
            <p>回调：<code>https://wordpro.cn/api/public/pay-13pay-notify</code></p>
          </div>

          <div>
            <Label className="text-xs">测试金额（元）</Label>
            <Input
              type="number"
              step="1"
              min="1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={busy}
            />
          </div>

          <Button size="lg" className="w-full" disabled={busy} onClick={startPay}>
            {busy ? "处理中…" : "发起 13pay 支付"}
          </Button>

          {orderNo && (
            <Button size="sm" variant="outline" className="w-full" onClick={manualQuery}>
              手动查询订单状态
            </Button>
          )}

          {qrcode && !paid && (
            <div className="rounded-md border border-border p-3 text-center text-xs space-y-2">
              <p>二维码内容：</p>
              <p className="break-all font-mono">{qrcode}</p>
              <img
                alt="支付二维码"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrcode)}`}
                className="mx-auto"
              />
            </div>
          )}

          {paid && (
            <div className="rounded-md bg-success/10 text-success text-sm p-3 text-center font-medium">
              🎉 支付成功
            </div>
          )}
        </Card>

        <Card className="p-3">
          <h3 className="text-xs font-semibold mb-2">实时日志</h3>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">等待操作…</p>
          ) : (
            <div className="space-y-1 text-xs font-mono">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.level === "err"
                      ? "text-destructive"
                      : l.level === "ok"
                        ? "text-success"
                        : "text-muted-foreground"
                  }
                >
                  [{l.t}] {l.msg}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">使用步骤</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>管理后台 /pc/payments → 新增/编辑「13pay 聚合」通道（启用）</li>
            <li>填写 apiBase（默认 https://pay.13pay.cn/）、商户 ID（pid）、商户密钥（MD5 通讯密钥）</li>
            <li>用微信扫码打开本页 /pay/test-13pay，点击支付</li>
            <li>页面短暂跳转到 13pay 收银台 → 微信自动弹出支付键盘 → 付完自动回跳本站</li>
          </ol>
        </Card>
      </main>
    </div>
  );
}
