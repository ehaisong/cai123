// 通过 3ypay 中转支付网关 gw.nrnc.net 发起支付。
// 微信内：跳转网关统一 OAuth 中转 → 回跳带 ?wx_openid → JSAPI 唤起
// 浏览器内：支付宝直跳 payUrl
// 网关异步回调到 Supabase Edge Function pay-notify 更新订单状态。
const GATEWAY_BASE = "https://gw.nrnc.net";

// 网关异步通知地址（Supabase Edge Function 公开 URL）
const NOTIFY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pay-notify`;

export type PayType = "wechat" | "alipay";

export interface QueryOrderResponse {
  success: boolean;
  tradeStatus?: "SUCCESS" | "WAIT_BUYER_PAY" | "CLOSED" | "FAILED";
  amount?: number;
  tradeNo?: string;
}

interface CreateOrderResponse {
  success: boolean;
  payDataType?: "payUrl" | "qrCode" | "weChat" | "data" | "jsapi";
  payData?: string;
  message?: string;
}

interface WxJsApiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

declare global {
  interface Window {
    WeixinJSBridge?: {
      invoke: (
        api: string,
        params: WxJsApiPayParams,
        cb: (res: { err_msg: string }) => void,
      ) => void;
    };
  }
}

function buildReturnUrl(orderNo: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://66cai.site";
  return `${origin}/pay/success?orderNo=${encodeURIComponent(orderNo)}`;
}

const OPENID_KEY = "wx_openid";

/** 从 URL 读取并清理 wx_openid / wx_oauth_error，返回 openid */
function consumeOpenIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const openid = params.get("wx_openid");
  const oauthErr = params.get("wx_oauth_error");
  if (!openid && !oauthErr) return null;
  params.delete("wx_openid");
  params.delete("wx_oauth_error");
  const cleanSearch = params.toString() ? `?${params.toString()}` : "";
  window.history.replaceState({}, "", window.location.pathname + cleanSearch + window.location.hash);
  if (oauthErr) {
    console.error("[wx oauth] gateway error:", decodeURIComponent(oauthErr));
    return null;
  }
  return openid;
}

/** 跳转到网关统一 OAuth 中转入口 */
function redirectToGatewayOAuth(): void {
  const target = encodeURIComponent(window.location.href);
  window.location.href = `${GATEWAY_BASE}/api/wx/oauth/redirect?target=${target}`;
}

function parseJsApiPayParams(payData: string): WxJsApiPayParams {
  const obj = JSON.parse(payData) as Record<string, string>;
  return {
    appId: obj.appId || obj.appid,
    timeStamp: String(obj.timeStamp || obj.timestamp),
    nonceStr: obj.nonceStr || obj.noncestr,
    package: obj.package,
    signType: obj.signType || "RSA",
    paySign: obj.paySign || obj.sign,
  };
}

function invokeWxJsApiPay(params: WxJsApiPayParams, onClose: () => void): void {
  const fire = () => {
    window.WeixinJSBridge!.invoke("getBrandWCPayRequest", params, () => {
      onClose();
    });
  };
  if (typeof window.WeixinJSBridge === "undefined") {
    document.addEventListener("WeixinJSBridgeReady", fire, false);
  } else {
    fire();
  }
}

export const PaymentService = {
  isWechat(): boolean {
    if (typeof navigator === "undefined") return false;
    return /micromessenger/i.test(navigator.userAgent);
  },

  /** App 入口调用：把网关回跳带回的 wx_openid 写入缓存并清理 URL */
  async resumeFromWxOAuthIfAny(): Promise<void> {
    if (typeof window === "undefined") return;
    const openid = consumeOpenIdFromUrl();
    if (openid) {
      try {
        sessionStorage.setItem(OPENID_KEY, openid);
      } catch {
        // ignore
      }
    }
  },

  async queryOrder(orderNo: string): Promise<QueryOrderResponse> {
    try {
      const res = await fetch(`${GATEWAY_BASE}/api/pay/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderNo }),
      });
      if (!res.ok) return { success: false };
      const j = (await res.json()) as QueryOrderResponse;
      return j;
    } catch {
      return { success: false };
    }
  },

  async pay(opts: {
    orderNo: string;
    amountYuan: number;
    payType: PayType;
    subject: string;
  }): Promise<void> {
    const { orderNo, amountYuan, payType, subject } = opts;
    const inWechat = this.isWechat();

    // 微信内 + 微信支付：必须先有 openid，否则跳网关 OAuth
    let openId: string | null = null;
    if (inWechat && payType === "wechat") {
      try {
        openId = sessionStorage.getItem(OPENID_KEY);
      } catch {
        openId = null;
      }
      if (!openId) {
        // 试一次：URL 上可能刚被网关带回来还没清理
        openId = consumeOpenIdFromUrl();
        if (openId) {
          try {
            sessionStorage.setItem(OPENID_KEY, openId);
          } catch {
            // ignore
          }
        }
      }
      if (!openId) {
        redirectToGatewayOAuth();
        return; // 页面将跳转
      }
    }

    const body: Record<string, unknown> = {
      orderId: orderNo,
      amount: Math.round(amountYuan * 100), // 单位：分
      payType,
      subject,
      notifyUrl: NOTIFY_URL,
      returnUrl: buildReturnUrl(orderNo),
    };
    if (payType === "wechat" && openId) {
      body.openId = openId;
    }

    const res = await fetch(`${GATEWAY_BASE}/api/pay/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`网关错误 HTTP ${res.status}`);
    const j = (await res.json()) as CreateOrderResponse;
    if (!j.success || !j.payData) throw new Error(j.message || "创建支付订单失败");

    // 微信内 + 微信支付 → JSAPI 唤起
    if (inWechat && payType === "wechat") {
      try {
        const params = parseJsApiPayParams(j.payData);
        invokeWxJsApiPay(params, () => {
          window.location.href = buildReturnUrl(orderNo);
        });
      } catch (e) {
        console.error("[wx jsapi] parse/invoke failed", e, j);
        throw new Error("微信支付参数解析失败");
      }
      return;
    }

    // 微信内点支付宝 → 提示在浏览器打开
    if (inWechat && payType === "alipay") {
      try {
        localStorage.setItem(
          "pending_alipay",
          JSON.stringify({ orderId: orderNo, payUrl: j.payData, createdAt: Date.now() }),
        );
      } catch {
        // ignore
      }
      this.showOpenInBrowserMask();
      return;
    }

    // 浏览器内 → 直接跳 payUrl
    window.location.href = j.payData;
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
        // ignore, will retry
      }
      setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      stopped = true;
    };
  },
};
