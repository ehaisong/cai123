// Unified payment service for the 3ypay aggregated gateway.
// Backend notify URL points to our own /api/public/pay-notify route,
// which validates and updates the order via supabaseAdmin.

// 支付网关：腾讯云 SCF（广州），中国大陆可直接访问，微信内浏览器无障碍。
const GATEWAY_BASE =
  (import.meta.env.VITE_PAY_GATEWAY as string | undefined) ||
  "https://gw.nrnc.net";

// Use the canonical production domain for callbacks/return URLs so the
// payment gateway always reaches a stable URL even when previewing.
const SITE_ORIGIN = "https://66cai.site";

export type PayType = "wechat" | "alipay";

interface CreateOrderRequest {
  orderId: string;
  amount: number; // 分
  payType: PayType;
  subject: string;
  notifyUrl: string;
  returnUrl: string;
  clientIp?: string;
}

interface CreateOrderResponse {
  success: boolean;
  payType?: string;
  payDataType?: "payUrl" | "qrCode" | "data";
  payData?: string;
  message?: string;
}

export interface QueryOrderResponse {
  success: boolean;
  tradeStatus?: "SUCCESS" | "WAIT_BUYER_PAY" | "CLOSED" | "FAILED";
  amount?: number;
  tradeNo?: string;
}

export const PaymentService = {
  isWechat(): boolean {
    if (typeof navigator === "undefined") return false;
    return /micromessenger/i.test(navigator.userAgent);
  },

  async getClientIp(): Promise<string> {
    // 不再调用外部 IP 服务（ipify 在中国大陆不可达，会导致长时间卡顿）。
    // 网关侧通常会从请求头自动获取真实 IP。
    return "127.0.0.1";
  },

  buildUrls(orderNo: string) {
    return {
      notifyUrl: `${SITE_ORIGIN}/api/public/pay-notify`,
      returnUrl: `${SITE_ORIGIN}/pay/success?orderNo=${encodeURIComponent(orderNo)}`,
    };
  },

  async createGatewayOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
    const res = await fetch(`${GATEWAY_BASE}/api/pay/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`支付网关 HTTP ${res.status}`);
    return res.json();
  },

  async queryOrder(orderNo: string): Promise<QueryOrderResponse> {
    const res = await fetch(`${GATEWAY_BASE}/api/pay/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: orderNo }),
    });
    if (!res.ok) throw new Error(`查询失败 HTTP ${res.status}`);
    return res.json();
  },

  /**
   * Pay flow: amountYuan in 元, gateway needs 分.
   */
  async pay(opts: {
    orderNo: string;
    amountYuan: number;
    payType: PayType;
    subject: string;
  }): Promise<void> {
    const { orderNo, amountYuan, payType, subject } = opts;
    const { notifyUrl, returnUrl } = this.buildUrls(orderNo);
    const amountCents = Math.round(amountYuan * 100);

    const req: CreateOrderRequest = {
      orderId: orderNo,
      amount: amountCents,
      payType,
      subject,
      notifyUrl,
      returnUrl,
    };
    if (payType === "wechat") {
      req.clientIp = await this.getClientIp();
    }
    const result = await this.createGatewayOrder(req);
    if (!result.success || !result.payData) {
      throw new Error(result.message || "创建支付订单失败");
    }

    if (payType === "alipay" && this.isWechat()) {
      // Wechat blocks alipay URLs. Persist and prompt the user to open in
      // an external browser; the root component will auto-redirect.
      localStorage.setItem(
        "pending_alipay",
        JSON.stringify({
          orderNo,
          payUrl: result.payData,
          createdAt: Date.now(),
        }),
      );
      this.showOpenInBrowserMask();
      return;
    }

    // 微信 H5：payDataType=data，payData 为含 schemeCode 的 JSON 字符串
    if (result.payDataType === "data") {
      let scheme: string | undefined;
      try {
        const parsed = JSON.parse(result.payData) as {
          schemeCode?: string;
          scheme_url?: string;
          mweb_url?: string;
        };
        scheme = parsed.schemeCode || parsed.scheme_url || parsed.mweb_url;
      } catch {
        // 非 JSON，回退当作 URL 处理
      }
      if (scheme) {
        window.location.href = scheme;
        return;
      }
    }

    window.location.href = result.payData;
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

  /** Call once on app entry. If a pending alipay order exists in non-wechat env, redirect. */
  checkPendingAlipay(): void {
    if (typeof window === "undefined") return;
    if (this.isWechat()) return;
    const raw = localStorage.getItem("pending_alipay");
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as { payUrl: string; createdAt: number };
      localStorage.removeItem("pending_alipay");
      if (Date.now() - p.createdAt < 5 * 60 * 1000 && p.payUrl) {
        window.location.href = p.payUrl;
      }
    } catch {
      localStorage.removeItem("pending_alipay");
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
