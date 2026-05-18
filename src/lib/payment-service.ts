// 默认走 13pay method=jump 收银台。前端调 /api/public/pay-13pay-create 拿到
// payUrl（H5 收银台 URL）后跳转，13pay 收银台页面在微信内自行拉起 JSAPI。
// 不需要 openid，不需要公众号配置。
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { logPayment } from "./payment-logger";

export type PayType = "wechat" | "alipay";

export interface QueryOrderResponse {
  success: boolean;
  tradeStatus?: "SUCCESS" | "WAIT_BUYER_PAY" | "CLOSED" | "FAILED";
  amount?: number;
  tradeNo?: string;
}

function showLoadingMask(text = "支付中…", subText = "请稍候，不要关闭页面"): void {
  if (typeof document === "undefined") return;
  const id = "pay-loading-mask";
  if (document.getElementById(id)) return;
  const mask = document.createElement("div");
  mask.id = id;
  mask.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;color:#fff;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;";
  mask.innerHTML = `
    <div style="width:42px;height:42px;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:pay-spin 0.9s linear infinite;margin-bottom:18px"></div>
    <p style="font-size:16px;font-weight:600;margin:0 0 6px">${text}</p>
    <p style="font-size:12px;opacity:0.65;margin:0">${subText}</p>
    <style>@keyframes pay-spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(mask);
}

function hideLoadingMask(): void {
  if (typeof document === "undefined") return;
  document.getElementById("pay-loading-mask")?.remove();
}

async function showQrCodeMask(qrContent: string, subject: string): Promise<void> {
  const dataUrl = await QRCode.toDataURL(qrContent, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const id = "pay-qrcode-mask";
  document.getElementById(id)?.remove();
  const mask = document.createElement("div");
  mask.id = id;
  mask.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;color:#fff;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;";
  mask.innerHTML = `
    <p style="font-size:15px;margin:0 0 12px">请使用手机扫码完成支付</p>
    <p style="font-size:13px;opacity:0.7;margin:0 0 16px">${subject}</p>
    <img src="${dataUrl}" alt="支付二维码" style="background:#fff;border-radius:8px;padding:8px;width:240px;height:240px"/>
    <button id="${id}-close" style="margin-top:24px;background:#fff;color:#000;border:0;border-radius:8px;padding:10px 24px;font-size:14px">关闭</button>
  `;
  document.body.appendChild(mask);
  document.getElementById(`${id}-close`)?.addEventListener("click", () => mask.remove());
}

export const PaymentService = {
  isWechat(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const hasWechatUa = /micromessenger|wechat|weixin/i.test(ua);
    const hasWechatBridge = typeof (window as Window & { WeixinJSBridge?: unknown }).WeixinJSBridge !== "undefined";
    const forcedWechat = new URLSearchParams(window.location.search).get("env") === "wechat";
    return hasWechatUa || hasWechatBridge || forcedWechat;
  },

  /** 兼容旧入口：3ypay 直连模式下不再需要 OAuth resume，直接 no-op。 */
  async resumeFromWxOAuthIfAny(): Promise<void> {
    return;
  },

  async queryOrder(orderNo: string): Promise<QueryOrderResponse> {
    const { data, error } = await supabase
      .from("payment_orders")
      .select("status, amount, trade_no")
      .eq("order_no", orderNo)
      .maybeSingle();
    if (error || !data) return { success: false };
    const tradeStatus =
      data.status === "paid"
        ? "SUCCESS"
        : data.status === "closed"
          ? "CLOSED"
          : data.status === "failed"
            ? "FAILED"
            : "WAIT_BUYER_PAY";
    return {
      success: true,
      tradeStatus: tradeStatus as QueryOrderResponse["tradeStatus"],
      amount: Number(data.amount),
      tradeNo: data.trade_no ?? undefined,
    };
  },

  async pay(opts: {
    orderNo: string;
    amountYuan: number;
    payType: PayType;
    subject: string;
  }): Promise<void> {
    const { orderNo, payType, subject } = opts;
    const inWechat = this.isWechat();

    showLoadingMask();
    logPayment({
      orderNo,
      stage: "create_request",
      message: "调用 13pay pay-create",
      payload: { payType, inWechat },
    });

    let data: {
      success?: boolean;
      payType?: string;
      payUrl?: string | null;
      qrcode?: string | null;
      tradeNo?: string;
      error?: string;
    } | null = null;
    let fetchErr: Error | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await fetch("/api/public/pay-13pay-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          orderNo,
          payType,
          // 让 13pay 完成后跳回用户当前域名（cai123.lovable.app / 预览 / wordpro.cn）
          returnOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
        }),
      });
      try {
        data = await resp.json();
      } catch {
        data = { success: false, error: `HTTP ${resp.status}` };
      }
    } catch (e) {
      fetchErr = e instanceof Error ? e : new Error(String(e));
    }

    if (fetchErr || !data?.success) {
      hideLoadingMask();
      const msg = data?.error || fetchErr?.message || "创建支付订单失败";
      logPayment({
        orderNo,
        stage: "create_error",
        level: "error",
        message: msg,
        payload: { fetchErr: fetchErr?.message, data },
      });
      throw new Error(msg);
    }

    const payUrl = data.payUrl ? String(data.payUrl) : "";
    const qrcode = data.qrcode ? String(data.qrcode) : "";
    logPayment({
      orderNo,
      stage: "create_response",
      message: "已获取 13pay 收银台 URL，准备跳转",
      payload: {
        payTypeResp: data.payType,
        tradeNo: data.tradeNo,
        urlPreview: (payUrl || qrcode).slice(0, 200),
      },
    });

    // 微信内点支付宝 → 提示在外部浏览器打开
    if (inWechat && payType === "alipay") {
      try {
        localStorage.setItem(
          "pending_alipay",
          JSON.stringify({ orderId: orderNo, payUrl, createdAt: Date.now() }),
        );
      } catch {
        // ignore
      }
      hideLoadingMask();
      this.showOpenInBrowserMask();
      return;
    }

    // PC 浏览器扫码场景：13pay 极少返回二维码内容，但兜底处理
    if (qrcode && !payUrl) {
      hideLoadingMask();
      await showQrCodeMask(qrcode, subject);
      return;
    }
    if (!inWechat && /^(weixin:|alipayqr:|alipays:)/i.test(payUrl)) {
      hideLoadingMask();
      await showQrCodeMask(payUrl, subject);
      return;
    }

    // 默认：直接跳转 13pay 收银台 URL（微信内自动拉起支付）
    window.location.href = payUrl;
  },

  showOpenInBrowserMask(): void {
    const id = "open-in-browser-mask";
    if (document.getElementById(id)) {
      (document.getElementById(id) as HTMLElement).style.display = "flex";
      return;
    }
    const mask = document.createElement("div");
    mask.id = id;
    mask.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;color:#fff;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:15px;";
    mask.innerHTML = `
      <div style="position:absolute;top:16px;right:24px;font-size:13px;line-height:1.6">
        点击右上角 <strong style="font-size:20px">⋯</strong><br/>
        选择「在浏览器中打开」
      </div>
      <div style="font-size:48px;line-height:1;margin-bottom:16px">↗</div>
      <p style="font-size:17px;font-weight:600;margin:0 0 8px">支付宝支付需在浏览器中完成</p>
      <p style="font-size:12px;opacity:0.7;margin:0 0 24px">订单已保留，浏览器打开后将自动继续支付</p>
      <button style="background:#fff;color:#000;border:0;border-radius:8px;padding:10px 24px;font-size:14px" id="${id}-close">我已知晓</button>
    `;
    document.body.appendChild(mask);
    document.getElementById(`${id}-close`)?.addEventListener("click", () => {
      mask.style.display = "none";
    });
  },

  /** 在外部浏览器入口处调用，检测 localStorage 待支付订单并自动跳转 */
  checkPendingAlipay(): void {
    if (typeof window === "undefined") return;
    if (this.isWechat()) return;
    const raw = localStorage.getItem("pending_alipay");
    if (!raw) return;
    localStorage.removeItem("pending_alipay");
    try {
      const p = JSON.parse(raw) as { payUrl?: string; createdAt?: number };
      if (!p.payUrl) return;
      const fresh = !p.createdAt || Date.now() - p.createdAt < 5 * 60 * 1000;
      if (!fresh) return;
      window.location.href = p.payUrl;
    } catch {
      // ignore
    }
  },

  startPolling(
    orderNo: string,
    onSuccess: (r: QueryOrderResponse) => void,
    onFail: (reason: string) => void,
    intervalMs = 3000,
    timeoutMs = 5 * 60 * 1000,
  ): () => void {
    const start = Date.now();
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - start > timeoutMs) {
        onFail("支付超时");
        return;
      }
      try {
        const r = await this.queryOrder(orderNo);
        if (r.success && r.tradeStatus === "SUCCESS") {
          onSuccess(r);
          return;
        }
        if (r.tradeStatus === "CLOSED" || r.tradeStatus === "FAILED") {
          onFail("订单已关闭或失败");
          return;
        }
      } catch {
        // ignore
      }
      setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      stopped = true;
    };
  },
};
