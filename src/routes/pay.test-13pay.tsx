// 13pay JSAPI 测试页
// 在微信内：点击发起支付 → 调 /api/public/pay-13pay-create (method=jsapi)
//   → 拿到 jsApiParameters → WeixinJSBridge.invoke('getBrandWCPayRequest', ...)
//   → 支付完成不离开当前页，监听 res.err_msg 后开始轮询订单状态
// 微信外：提示请在微信内打开，或可选 method=jump 跳转兜底
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

type WxBridge = {
  invoke: (
    api: string,
    params: Record<string, string>,
    cb: (res: { err_msg: string; [k: string]: unknown }) => void,
  ) => void;
};
type WxWin = Window & { WeixinJSBridge?: WxBridge };

function isWechat() {
  if (typeof window === "undefined") return false;
  return /micromessenger|wechat|weixin/i.test(navigator.userAgent || "")
    || typeof (window as WxWin).WeixinJSBridge !== "undefined"
    || new URLSearchParams(window.location.search).get("env") === "wechat";
}

type LogLine = { t: string; level: "info" | "ok" | "err"; msg: string };

function Test13Page() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [orderNo, setOrderNo] = useState<string | null>(null);
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

    // 调 13pay 创建接口
    push("info", `请求 /api/public/pay-13pay-create (method=${inWechat ? "jsapi" : "jump"})`);
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
        body: JSON.stringify({
          orderNo: oNo,
          payType: "wechat",
          method: inWechat ? "jsapi" : "jump",
        }),
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      push("err", `网络错误：${m}`);
      setBusy(false);
      return;
    }
    let data: {
      success?: boolean; error?: string;
      payType?: string; payInfo?: string;
      jsApiParams?: Record<string, string> | null;
      payUrl?: string | null; qrcode?: string | null;
      tradeNo?: string;
    } = {};
    try { data = await resp.json(); } catch { /* ignore */ }
    if (!data.success) {
      push("err", `13pay 返回失败：${data.error ?? `HTTP ${resp.status}`}`);
      setBusy(false);
      return;
    }
    push("ok", `13pay pay_type=${data.payType}，trade_no=${data.tradeNo}`);

    // 微信内 + jsapi → 直拉
    if (inWechat && data.payType === "jsapi" && data.jsApiParams) {
      const params = data.jsApiParams;
      push("info", "调用 WeixinJSBridge.getBrandWCPayRequest");
      const bridge = (window as WxWin).WeixinJSBridge;
      const invoke = () => {
        if (!bridge) {
          push("err", "WeixinJSBridge 不存在，可能未在微信内打开");
          setBusy(false);
          return;
        }
        bridge.invoke("getBrandWCPayRequest", params, (res) => {
          push("info", `JSBridge 返回 err_msg=${res.err_msg}`);
          if (res.err_msg === "get_brand_wcpay_request:ok") {
            push("ok", "用户支付完成，开始轮询订单状态");
            startPolling(String(oNo));
          } else if (res.err_msg === "get_brand_wcpay_request:cancel") {
            push("err", "用户取消支付");
            setBusy(false);
          } else {
            push("err", `支付失败：${res.err_msg}`);
            setBusy(false);
          }
        });
      };
      if (bridge) invoke();
      else document.addEventListener("WeixinJSBridgeReady", invoke, { once: true });
      return;
    }

    // 微信外或 jump → 跳转兜底
    if (data.payType === "jump" && data.payUrl) {
      push("info", `跳转 ${data.payUrl.slice(0, 80)}…`);
      window.location.href = data.payUrl;
      return;
    }
    if (data.payType === "qrcode" && data.qrcode) {
      push("info", `二维码内容：${data.qrcode}`);
      setBusy(false);
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
      <PageHeader title="13pay JSAPI 测试" />
      <main className="flex-1 px-3 py-3 space-y-3">
        <Card className="p-4 space-y-3">
          <div className="text-xs rounded-md bg-muted p-3 leading-relaxed text-muted-foreground space-y-1">
            <p>当前环境：<strong>{inWechat ? "微信内 → 走 JSAPI" : "外部浏览器 → 走 jump 跳转"}</strong></p>
            <p>通道：管理后台 → 支付通道 → 新增 13pay（填 pid / 商户私钥 / 平台公钥）</p>
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
            {busy ? "处理中…" : inWechat ? "微信内发起 JSAPI 支付" : "微信外发起跳转支付"}
          </Button>

          {orderNo && (
            <Button size="sm" variant="outline" className="w-full" onClick={manualQuery}>
              手动查询订单状态
            </Button>
          )}

          {paid && (
            <div className="rounded-md bg-success/10 text-success text-sm p-3 text-center font-medium">
              🎉 支付成功（页面未跳转，未关闭）
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
            <li>管理后台 /admin/payment → 新增「13pay 聚合」通道（启用）</li>
            <li>填写 13pay 商户ID、商户私钥、平台公钥（在 13pay 后台 → API 信息）</li>
            <li>用微信扫码打开本页 /pay/test-13pay</li>
            <li>点支付，应直接弹出微信支付密码框；完成后页面不会跳走</li>
            <li>如未弹起，按上方日志排查；日志同步写入 payment_logs 表</li>
          </ol>
        </Card>
      </main>
    </div>
  );
}
