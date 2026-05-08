// 3ypay 直连 SDK（服务端专用）。RSA2 (SHA256withRSA) 签名/验签 + 业务接口封装。
import crypto from "node:crypto";

const BASE = "https://openapi.3ypay.com";

const APP_ID = process.env.THREEYPAY_APP_ID || "";
const MCH_PRIVATE_KEY_RAW = process.env.THREEYPAY_MCH_PRIVATE_KEY || "";
const PLATFORM_PUBLIC_KEY_RAW = process.env.THREEYPAY_PLATFORM_PUBLIC_KEY || "";

function pemWrap(key: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const trimmed = key.trim();
  if (trimmed.includes("BEGIN")) return trimmed.replace(/\\n/g, "\n");
  // 纯 base64 → 包成 PEM
  const body = trimmed.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

const MCH_PRIVATE_KEY = pemWrap(MCH_PRIVATE_KEY_RAW, "PRIVATE KEY");
const PLATFORM_PUBLIC_KEY = pemWrap(PLATFORM_PUBLIC_KEY_RAW, "PUBLIC KEY");

// 拼接待签名串：所有非空字段按 key 字典序，bizContent 序列化为 JSON 字符串
export function buildSignString(params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign")
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort();
  return keys
    .map((k) => {
      const v = params[k];
      const str = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}=${str}`;
    })
    .join("&");
}

export function rsa2Sign(params: Record<string, unknown>): string {
  const str = buildSignString(params);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(str, "utf8");
  return signer.sign(MCH_PRIVATE_KEY, "base64");
}

export function rsa2Verify(params: Record<string, unknown>, sign: string): boolean {
  if (!sign) return false;
  const str = buildSignString(params);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(str, "utf8");
  try {
    return verifier.verify(PLATFORM_PUBLIC_KEY, sign, "base64");
  } catch {
    return false;
  }
}

export interface CreateOrderInput {
  mchOrderNo: string;
  productCode: "WeChat-PAY" | "Ali-PAY";
  paySubType: "JSAPI" | "H5" | "NATIVE";
  subject: string;
  description: string;
  orderAmount: number; // 元
  clientIp: string;
  notifyUrl: string;
  redirectUrl?: string;
  extra?: Record<string, unknown>;
}

export interface CreateOrderResult {
  ok: boolean;
  msg: string;
  payDataType?: "payUrl" | "data" | "form" | "none";
  payInfo?: string;
  payOrderNo?: string;
  state?: number;
  raw?: unknown;
}

async function callOpenApi(path: string, bizContent: Record<string, unknown>) {
  if (!APP_ID || !MCH_PRIVATE_KEY_RAW) {
    throw new Error("3ypay 凭证未配置");
  }
  const params: Record<string, unknown> = {
    appId: APP_ID,
    version: "1.0",
    timestamp: Date.now(),
    requestId: crypto.randomUUID().replace(/-/g, ""),
    signType: "RSA2",
    charset: "UTF-8",
    bizContent,
  };
  params.sign = rsa2Sign(params);

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, msg: `网关响应非 JSON: ${text.slice(0, 200)}`, raw: text };
  }
  return { ok: res.ok, http: res.status, json };
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const biz: Record<string, unknown> = {
    mchOrderNo: input.mchOrderNo,
    productCode: input.productCode,
    paySubType: input.paySubType,
    subject: input.subject.slice(0, 32),
    description: (input.description || input.subject).slice(0, 64),
    orderAmount: Number(input.orderAmount.toFixed(2)),
    clientIp: input.clientIp || "127.0.0.1",
    notifyUrl: input.notifyUrl,
  };
  if (input.redirectUrl) biz.redirectUrl = input.redirectUrl;
  if (input.extra) biz.extra = input.extra;

  const r = await callOpenApi("/openapi/order/pay/create", biz);
  if ("raw" in r) return { ok: false, msg: r.msg ?? "网关响应错误", raw: r.raw };

  const j = r.json as { code?: number; msg?: string; data?: string | Record<string, unknown> };
  if (j.code !== 200) {
    return { ok: false, msg: j.msg || `code=${j.code}`, raw: j };
  }
  let data: Record<string, unknown> = {};
  try {
    data = typeof j.data === "string" ? JSON.parse(j.data) : (j.data ?? {});
  } catch {
    return { ok: false, msg: "data 非法 JSON", raw: j };
  }
  return {
    ok: true,
    msg: "ok",
    payDataType: data.payDataType as CreateOrderResult["payDataType"],
    payInfo: data.payInfo as string | undefined,
    payOrderNo: data.payOrderNo as string | undefined,
    state: data.state as number | undefined,
    raw: data,
  };
}

export interface QueryOrderResult {
  ok: boolean;
  state?: number; // 1=init 2=paying 3=success 4=cancelled 5=closed 7=failed
  payAmount?: number;
  payOrderNo?: string;
  raw?: unknown;
}

export async function queryOrder(mchOrderNo: string): Promise<QueryOrderResult> {
  const r = await callOpenApi("/openapi/order/pay/query", { mchOrderNo });
  if ("raw" in r) return { ok: false, raw: r.raw };
  const j = r.json as { code?: number; data?: string | Record<string, unknown> };
  if (j.code !== 200) return { ok: false, raw: j };
  const data = typeof j.data === "string" ? JSON.parse(j.data) : (j.data ?? {});
  return {
    ok: true,
    state: (data as Record<string, unknown>).state as number | undefined,
    payAmount: Number((data as Record<string, unknown>).payAmount ?? 0),
    payOrderNo: (data as Record<string, unknown>).payOrderNo as string | undefined,
    raw: data,
  };
}

// 微信公众号网页授权 → openid
export async function wechatExchangeOpenid(code: string): Promise<{ openid?: string; error?: string }> {
  const appid = process.env.WECHAT_OA_APPID;
  const secret = process.env.WECHAT_OA_SECRET;
  if (!appid || !secret) return { error: "WECHAT_OA_APPID/SECRET 未配置" };
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appid}&secret=${secret}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const j = (await res.json()) as { openid?: string; errmsg?: string };
  if (!j.openid) return { error: j.errmsg || "无法获取 openid" };
  return { openid: j.openid };
}

export const ThreeYPayConfig = {
  get wxOaAppId() {
    return process.env.WECHAT_OA_APPID || "";
  },
};
