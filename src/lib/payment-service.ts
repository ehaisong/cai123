// 通过 3ypay 中转支付网关 gw.nrnc.net 发起支付（v2 协议）。
// 微信内：跳转网关统一 OAuth 中转 → 回跳带 ?wx_openid → method=jsapi 创建 → 直接跳 pay_info
// 浏览器内：jump → 直跳 pay_info；qrcode → 渲染二维码
// 网关异步回调到 Supabase Edge Function pay-notify 更新订单状态。
import QRCode from "qrcode";
import { logPayment } from "./payment-logger";

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
  provider?: string;
  payType?: PayType;
  payMethod?: "jsapi" | "qrcode" | "jump";
  // 网关有时把 pay_info / pay_type 放在顶层，有时放在 data 中，做兼容
  pay_info?: string;
  pay_type?: "qrcode" | "jump";
  data?: {
    pay_type?: "qrcode" | "jump";
    pay_info?: string;
  };
  message?: string;
  raw?: { pay_info?: string; pay_type?: "qrcode" | "jump"; failReason?: string; failCode?: string } & Record<string, unknown>;
}

function buildReturnUrl(orderNo: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://66cai.site";
  return `${origin}/pay/success?orderNo=${encodeURIComponent(orderNo)}`;
}

const OPENID_KEY = "wx_openid";
const PENDING_WX_PAY_KEY = "pending_wx_pay";

type PendingWxPay = {
  orderNo: string;
  amountYuan: number;
  payType: "wechat";
  subject: string;
  createdAt: number;
};

function savePendingWxPay(pending: Omit<PendingWxPay, "createdAt">): void {
  try {
    sessionStorage.setItem(PENDING_WX_PAY_KEY, JSON.stringify({ ...pending, createdAt: Date.now() }));
  } catch {
    // ignore
  }
}

function consumePendingWxPay(): PendingWxPay | null {
  try {
    const raw = sessionStorage.getItem(PENDING_WX_PAY_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingWxPay;
    const fresh = Date.now() - Number(pending.createdAt || 0) < 10 * 60 * 1000;
    if (!fresh || !pending.orderNo || pending.payType !== "wechat") {
      sessionStorage.removeItem(PENDING_WX_PAY_KEY);
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

function clearPendingWxPay(): void {
  try {
    sessionStorage.removeItem(PENDING_WX_PAY_KEY);
  } catch {
    // ignore
  }
}

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

let cachedClientIp: string | null = null;
async function fetchClientIp(): Promise<string | null> {
  if (cachedClientIp) return cachedClientIp;
  const sources = [
    "https://api.ipify.org?format=json",
    "https://ipapi.co/json/",
  ];
  for (const url of sources) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = (await r.json()) as { ip?: string };
      if (j.ip && /^[\d.]+$|:/.test(j.ip)) {
        cachedClientIp = j.ip;
        return j.ip;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function gatewayFailureDetail(j: CreateOrderResponse): string {
  const raw = j.raw as { failReason?: string; failCode?: string } | undefined;
  return j.message || raw?.failReason || raw?.failCode || "创建支付订单失败";
}

/** 全屏 Loading 遮罩，避免微信 OAuth 回跳/跳转支付间隙露出原页面 */
function showLoadingMask(text = "正在拉起微信支付…", subText = "请稍候，不要关闭页面"): void {
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

/** 渲染二维码到全屏遮罩层 */
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
      const pending = consumePendingWxPay();
      logPayment({
        orderNo: pending?.orderNo,
        stage: "oauth_resume",
        message: "OAuth 回跳，已获取 openid",
        payload: { openidPrefix: openid.slice(0, 6), hasPending: !!pending },
      });
      if (pending) {
        try {
          await this.pay({
            orderNo: pending.orderNo,
            amountYuan: pending.amountYuan,
            payType: pending.payType,
            subject: pending.subject,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logPayment({
            orderNo: pending.orderNo,
            stage: "error",
            level: "error",
            message: `OAuth 回跳后续单失败：${msg}`,
            payload: { pending },
          });
        }
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
        savePendingWxPay({ orderNo, amountYuan, payType: "wechat", subject });
        logPayment({
          orderNo,
          stage: "oauth_redirect",
          message: "微信内未取到 openid，跳网关 OAuth",
          payload: { amountYuan, subject },
        });
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
      // v2 协议：微信 JSAPI 必填 method
      body.method = "jsapi";
    }
    const clientIp = await fetchClientIp();
    if (clientIp) body.clientIp = clientIp;
    logPayment({
      orderNo,
      stage: "create_request",
      message: "调用网关 /api/pay/create",
      payload: { ...body, openId: openId ? `${openId.slice(0, 6)}***` : undefined },
    });

    let res: Response;
    try {
      res = await fetch(`${GATEWAY_BASE}/api/pay/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logPayment({ orderNo, stage: "create_error", level: "error", message: `网络错误：${msg}` });
      throw new Error(`网关网络错误：${msg}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { message?: string; msg?: string; error?: string };
        detail = parsed.message || parsed.msg || parsed.error || text;
      } catch {
        // keep raw text
      }
      logPayment({
        orderNo,
        stage: "create_error",
        level: "error",
        message: `网关 HTTP ${res.status}`,
        payload: { status: res.status, body: text.slice(0, 2000) },
      });
      throw new Error(`网关错误 HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const j = (await res.json()) as CreateOrderResponse;
    const payInfo = j.data?.pay_info ?? j.pay_info ?? j.raw?.pay_info;
    const payTypeResp = j.data?.pay_type ?? j.pay_type ?? j.raw?.pay_type;
    const okResp = j.success && !!payInfo;
    logPayment({
      orderNo,
      stage: "create_response",
      level: okResp ? "info" : "error",
      message: okResp ? "网关返回成功" : `网关返回不可支付：${gatewayFailureDetail(j)}`,
      payload: {
        success: j.success,
        provider: j.provider,
        payMethod: j.payMethod,
        payType: j.payType,
        dataPayType: payTypeResp,
        message: j.message,
        raw: j.raw,
        payInfoPreview: typeof payInfo === "string" ? payInfo.slice(0, 500) : null,
      },
    });
    if (!okResp || !payInfo) throw new Error(gatewayFailureDetail(j));

    // 跳转支付（13pay JSAPI / H5 / 支付宝 H5 都走此分支）
    const isJump =
      j.payMethod === "jsapi" ||
      j.payMethod === "jump" ||
      payTypeResp === "jump" ||
      (inWechat && payType === "wechat");

    if (isJump) {
      // 微信内 JSAPI 跳转前清理 pending
      if (inWechat && payType === "wechat") clearPendingWxPay();

      // 微信内点支付宝 → 提示在外部浏览器打开
      if (inWechat && payType === "alipay") {
        try {
          localStorage.setItem(
            "pending_alipay",
            JSON.stringify({ orderId: orderNo, payUrl: payInfo, createdAt: Date.now() }),
          );
        } catch {
          // ignore
        }
        this.showOpenInBrowserMask();
        return;
      }

      logPayment({
        orderNo,
        stage: "jsapi_invoke",
        message: "跳转网关返回的支付 URL",
        payload: { urlPreview: payInfo.slice(0, 200) },
      });
      window.location.href = payInfo;
      return;
    }

    // 二维码支付（PC / 桌面浏览器场景）
    if (payTypeResp === "qrcode" || j.payMethod === "qrcode") {
      await showQrCodeMask(payInfo, subject);
      return;
    }

    throw new Error(`不支持的支付响应类型：${payTypeResp || j.payMethod || "unknown"}`);
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
