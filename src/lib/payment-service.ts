// 直连 3ypay 的前端支付服务。
// - 微信内：跳转 /api/public/pay/wx-start → OAuth → JSAPI 唤起
// - 微信外：POST /api/public/pay/create 拿支付宝 H5 链接 → 直接跳转
import { supabase } from "@/integrations/supabase/client";

export type PayType = "wechat" | "alipay";

export interface QueryOrderResponse {
  success: boolean;
  tradeStatus?: "SUCCESS" | "WAIT_BUYER_PAY" | "CLOSED" | "FAILED";
  amount?: number; // 元
  tradeNo?: string;
}

export const PaymentService = {
  isWechat(): boolean {
    if (typeof navigator === "undefined") return false;
    return /micromessenger/i.test(navigator.userAgent);
  },

  async queryOrder(orderNo: string): Promise<QueryOrderResponse> {
    const { data } = await supabase
      .from("payment_orders")
      .select("status, amount, trade_no")
      .eq("order_no", orderNo)
      .maybeSingle();
    if (!data) return { success: true, tradeStatus: "WAIT_BUYER_PAY" };
    const map: Record<string, QueryOrderResponse["tradeStatus"]> = {
      paid: "SUCCESS",
      pending: "WAIT_BUYER_PAY",
      closed: "CLOSED",
      failed: "FAILED",
    };
    return {
      success: true,
      tradeStatus: map[data.status] ?? "WAIT_BUYER_PAY",
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
    const { orderNo, payType } = opts;

    // 微信内 → 走微信公众号 OAuth + JSAPI
    if (this.isWechat() && payType === "wechat") {
      window.location.href = `/api/public/pay/wx-start?orderNo=${encodeURIComponent(orderNo)}`;
      return;
    }

    // 微信内点支付宝 → 弹层提示在外部浏览器打开
    if (this.isWechat() && payType === "alipay") {
      this.showOpenInBrowserMask(orderNo);
      return;
    }

    // 微信外 → 创建订单 → 跳支付链接
    const res = await fetch("/api/public/pay/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo, payType }),
    });
    const j = (await res.json()) as { ok: boolean; payInfo?: string; msg?: string };
    if (!j.ok || !j.payInfo) throw new Error(j.msg || "创建支付订单失败");
    window.location.href = j.payInfo;
  },

  showOpenInBrowserMask(orderNo?: string): void {
    const id = "open-in-browser-mask";
    if (orderNo) {
      localStorage.setItem("pending_alipay_order", orderNo);
    }
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

  checkPendingAlipay(): void {
    // 兼容旧版本占位，新流程不再需要预存 URL
    if (typeof window === "undefined") return;
    if (this.isWechat()) return;
    const orderNo = localStorage.getItem("pending_alipay_order");
    if (!orderNo) return;
    localStorage.removeItem("pending_alipay_order");
    // 自动重新拉起
    void this.pay({ orderNo, amountYuan: 0, payType: "alipay", subject: "" }).catch(() => {});
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
