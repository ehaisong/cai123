// 微信内执行 WeixinJSBridge 唤起支付。
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/pay/invoke")({
  validateSearch: (s: Record<string, unknown>) => ({
    orderNo: typeof s.orderNo === "string" ? s.orderNo : "",
    payInfo: typeof s.payInfo === "string" ? s.payInfo : "",
  }),
  component: PayInvokePage,
});

interface PayInfo {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

function PayInvokePage() {
  const { orderNo, payInfo } = Route.useSearch();
  const navigate = useNavigate();
  const [msg, setMsg] = useState("正在唤起微信支付…");

  useEffect(() => {
    if (!orderNo || !payInfo) {
      setMsg("缺少支付参数");
      return;
    }
    let parsed: PayInfo;
    try {
      parsed = JSON.parse(payInfo) as PayInfo;
    } catch {
      setMsg("支付参数解析失败");
      return;
    }

    const invoke = () => {
      const wb = (window as unknown as { WeixinJSBridge?: { invoke: (a: string, b: unknown, c: (r: { err_msg: string }) => void) => void } }).WeixinJSBridge;
      if (!wb) {
        setMsg("请在微信中打开此页面");
        return;
      }
      wb.invoke(
        "getBrandWCPayRequest",
        {
          appId: parsed.appId,
          timeStamp: parsed.timeStamp,
          nonceStr: parsed.nonceStr,
          package: parsed.package,
          signType: parsed.signType || "RSA",
          paySign: parsed.paySign,
        },
        (res) => {
          if (res.err_msg === "get_brand_wcpay_request:ok") {
            navigate({ to: "/pay/success", search: { orderNo } });
          } else if (res.err_msg === "get_brand_wcpay_request:cancel") {
            setMsg("已取消支付");
          } else {
            setMsg(`支付失败：${res.err_msg}`);
          }
        },
      );
    };

    if (typeof (window as unknown as { WeixinJSBridge?: unknown }).WeixinJSBridge === "undefined") {
      document.addEventListener("WeixinJSBridgeReady", invoke, false);
    } else {
      invoke();
    }
    return () => document.removeEventListener("WeixinJSBridgeReady", invoke);
  }, [orderNo, payInfo, navigate]);

  return (
    <div style={{ padding: 32, fontFamily: "-apple-system, sans-serif", textAlign: "center" }}>
      <p style={{ fontSize: 16, color: "#333" }}>{msg}</p>
    </div>
  );
}
