// 通过 3ypay 中转支付网关 gw.nrnc.net 发起支付。
// 前端直接调用网关 /api/pay/create 与 /api/pay/query；
// 网关异步回调到 Supabase Edge Function pay-notify 更新订单状态。
const GATEWAY_BASE = "https://gw.nrnc.net";

// 网关异步通知地址（Supabase Edge Function 公开 URL，无需走自有域名）
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
  payDataType?: "payUrl" | "qrCode";
  payData?: string;
  message?: string;
}

async function getClientIp(): Promise<string> {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = (await r.json()) as { ip?: string };
    return j.ip || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function buildReturnUrl(orderNo: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://66cai.site";
  return `${origin}/pay/success?orderNo=${encodeURIComponent(orderNo)}`;
}

export const PaymentService = {
  isWechat(): boolean {
    if (typeof navigator === "undefined") return false;
    return /micromessenger/i.test(navigator.userAgent);
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

    // 微信内点击支付宝 → 提示在浏览器打开（先创建订单缓存 payUrl）
    const inWechat = this.isWechat();

    const body: Record<string, unknown> = {
      orderId: orderNo,
      amount: Math.round(amountYuan * 100), // 单位：分
      payType,
      subject,
      notifyUrl: NOTIFY_URL,
      returnUrl: buildReturnUrl(orderNo),
    };
    if (payType === "wechat") {
      body.clientIp = await getClientIp();
    }

    const res = await fetch(`${GATEWAY_BASE}/api/pay/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`网关错误 HTTP ${res.status}`);
    const j = (await res.json()) as CreateOrderResponse;
    if (!j.success || !j.payData) throw new Error(j.message || "创建支付订单失败");

    if (inWechat && payType === "alipay") {
      // 微信内打开支付宝会被拦截 → 缓存 payUrl + 弹层引导
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
