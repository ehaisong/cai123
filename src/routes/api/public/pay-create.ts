// 同源 3ypay 创建订单接口（运行在 wordpro.cn 自有服务器，
// 出口 IP 即站点白名单 IP，避免被 3ypay 风控拦截）。
// 替代原 supabase/functions/pay-create。
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { signRSA2, verifyRSA2, buildSignContent, stringifySorted } from "@/lib/threeypay-verify";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY_URL = "https://openapi.3ypay.com/openapi/order/pay/create";
const NOTIFY_URL = "https://wordpro.cn/api/public/pay-notify";
const DEFAULT_RETURN_ORIGIN = "https://wordpro.cn";

/**
 * 选择 redirectUrl 的 origin：优先使用前端传入的 returnOrigin（必须在白名单内），
 * 否则回退到请求自身的 origin / referer，最后兜底 wordpro.cn。
 * 这样用户在哪个域名（cai123.lovable.app / 预览域 / wordpro.cn）发起支付，
 * 3ypay 完成后就跳回同一个域名，避免"被踢出"现象。
 */
function pickReturnOrigin(request: Request, requested: string | undefined): string {
  const allowHost = (host: string) =>
    host === "wordpro.cn" ||
    host === "www.wordpro.cn" ||
    host === "cai123.lovable.app" ||
    host.endsWith(".lovable.app");

  const tryParse = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (!allowHost(u.host)) return null;
      return `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  };

  return (
    tryParse(requested) ||
    tryParse(request.headers.get("origin")) ||
    tryParse(request.headers.get("referer")) ||
    DEFAULT_RETURN_ORIGIN
  );
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

async function getServerEgressIp(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const resp = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { ip?: unknown };
    return typeof data.ip === "string" ? data.ip : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type AppSupabase = SupabaseClient<Database>;
const WsTransport = WebSocket as unknown as WebSocketLikeConstructor;

function getSupabaseForRequest(
  request: Request,
  env: { supabaseUrl?: string; serviceRoleKey?: string; publishableKey?: string },
): { supabase: AppSupabase; mode: "service" | "user" } {
  const { supabaseUrl, serviceRoleKey, publishableKey } = env;
  if (!supabaseUrl || (!serviceRoleKey && !publishableKey)) {
    throw new Error("服务器缺少 Supabase 环境变量");
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!serviceRoleKey && !authHeader) {
    throw new Error("服务器缺少 service role，且请求未携带用户登录态");
  }

  const supabaseKey = serviceRoleKey || publishableKey;
  if (!supabaseKey) throw new Error("服务器缺少 Supabase 访问密钥");

  return {
    mode: serviceRoleKey ? "service" : "user",
    supabase: createClient<Database, "public">(supabaseUrl, supabaseKey, {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: { transport: WsTransport },
      global: authHeader && !serviceRoleKey ? { headers: { Authorization: authHeader } } : undefined,
    }),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function sanitizeSubject(raw: string): string {
  if (!raw) return "支付订单";
  let s = raw
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u2600-\u27BF\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = "支付订单";
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}

function normalizeProductCode(raw: string | undefined, payType: "wechat" | "alipay"): string | undefined {
  const value = String(raw || "").trim();
  if (!value) return payType === "alipay" ? "Ali-PAY" : "WeChat-PAY";
  const upper = value.toUpperCase();
  if (upper === "ALI_NATIVE" || upper === "ALIPAY" || upper === "ALI_PAY") return "Ali-PAY";
  if (upper === "WX_NATIVE" || upper === "WECHAT" || upper === "WECHAT_PAY" || upper === "WX_PAY") {
    return "WeChat-PAY";
  }
  return value;
}

async function logPay(
  supabase: AppSupabase,
  orderNo: string | null,
  stage: string,
  level: "info" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  try {
    await supabase.from("payment_logs").insert([
      {
        order_no: orderNo,
        source: "tanstack-pay-create",
        stage,
        level,
        message,
        payload: payload as never,
      },
    ] as never);
  } catch (e) {
    console.error("[pay-create] log insert failed", e);
  }
}

export const Route = createFileRoute("/api/public/pay-create")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        const diagnose = new URL(request.url).searchParams.get("diagnose");
        if (diagnose === "egress") {
          return json({
            ok: true,
            endpoint: "pay-create",
            serverEgressIp: await getServerEgressIp(),
            expectedWhitelistIp: "103.87.9.218",
            note: "此 IP 是 wordpro.cn Node 服务调用 3ypay 时对方看到的出口 IP，不是 Supabase 出口 IP。",
          });
        }
        return json({ ok: true, endpoint: "pay-create", method: "POST" });
      },
      POST: async ({ request }) => {
        let body: { orderNo?: string; payType?: string; returnOrigin?: string } = {};
        try {
          body = await request.json();
        } catch {
          return json({ success: false, error: "请求体无效" }, 200);
        }
        const orderNo = String(body.orderNo || "");
        const payType = String(body.payType || "") as "wechat" | "alipay";
        if (!orderNo || !["wechat", "alipay"].includes(payType)) {
          return json({ success: false, error: "缺少 orderNo / payType" }, 200);
        }
        const returnOrigin = pickReturnOrigin(request, body.returnOrigin);

        let supabase: AppSupabase;
        let supabaseMode: "service" | "user";
        try {
          const client = getSupabaseForRequest(request, {
            supabaseUrl: process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL,
            serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            publishableKey:
              process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          });
          supabase = client.supabase;
          supabaseMode = client.mode;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[pay-create] supabase init failed", msg);
          return json({ success: false, error: msg }, 200);
        }

        // 1. 取订单
        const { data: order, error: orderErr } = await supabase
          .from("payment_orders")
          .select("order_no, amount, subject, status, user_id")
          .eq("order_no", orderNo)
          .maybeSingle();
        if (orderErr || !order) {
          await logPay(supabase, orderNo, "create_error", "error", "订单不存在", {
            orderErr, supabaseMode,
          });
          return json({ success: false, error: "订单不存在" }, 200);
        }
        if (order.status !== "pending") {
          return json(
            { success: false, error: `订单状态为 ${order.status}，无法支付` },
            200,
          );
        }

        // 2. 取 3ypay 通道配置
        const { data: chans } = await supabase
          .from("payment_channels")
          .select("provider, config, is_enabled")
          .eq("is_enabled", true);
        const chan =
          (chans ?? []).find((c: { provider: string }) => c.provider === "3ypay") ??
          (chans ?? []).find((c: { provider: string }) => c.provider === payType);
        if (!chan) {
          await logPay(supabase, orderNo, "create_error", "error", "未配置 3ypay 通道", {});
          return json(
            { success: false, error: "未配置 3ypay 支付通道，请联系管理员" },
            200,
          );
        }
        const cfg = (chan.config ?? {}) as Record<string, unknown>;
        const appId = cfg.appId as string | undefined;
        // 商户私钥：优先读后台 payment_channels.config.merchantPrivateKey；
        // env THREEYPAY_MCH_PRIVATE_KEY 作为兜底（适合 Lovable Worker 环境，
        // 自建 Node 服务建议直接在后台维护）。
        const merchantPrivateKey =
          (cfg.merchantPrivateKey as string | undefined) ||
          (process.env.THREEYPAY_MCH_PRIVATE_KEY as string | undefined);
        const merchantPrivateKeySource = cfg.merchantPrivateKey
          ? "db"
          : process.env.THREEYPAY_MCH_PRIVATE_KEY
            ? "env"
            : "none";
        const platformPublicKey = cfg.platformPublicKey as string | undefined;
        const sub = (cfg[payType] ?? {}) as Record<string, string | undefined>;
        const rawProductCode = sub.productCode;
        const productCode = normalizeProductCode(rawProductCode, payType);
        const paySubType = sub.paySubType || "NATIVE";
        if (!appId || !merchantPrivateKey || !platformPublicKey || !productCode) {
          const allEnvKeys = Object.keys(process.env || {});
          const envKeys = allEnvKeys.filter((k) => k.startsWith("THREEYPAY") || k.startsWith("SUPABASE") || k.startsWith("VITE_"));
          await logPay(supabase, orderNo, "create_error", "error", "通道配置不完整", {
            hasAppId: !!appId,
            hasPriv: !!merchantPrivateKey,
            privLen: merchantPrivateKey?.length ?? 0,
            merchantPrivateKeySource,
            hasPub: !!platformPublicKey,
            hasProductCode: !!productCode,
            envKeys,
            allEnvKeyCount: allEnvKeys.length,
            allEnvKeysSample: allEnvKeys.slice(0, 50),
            nodeVersion: typeof process !== "undefined" ? process.version : "n/a",
            buildTarget: process.env.BUILD_TARGET || "unset",
          });
          return json({ success: false, error: "支付通道配置不完整" }, 200);
        }

        // 3. 构造 bizContent
        const xff = request.headers.get("x-forwarded-for") || "";
        const clientIp =
          xff.split(",")[0].trim() ||
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-real-ip") ||
          "127.0.0.1";
        const bizContentObj: Record<string, unknown> = {
          mchOrderNo: orderNo,
          productCode,
          paySubType,
          subject: sanitizeSubject(order.subject || "支付订单"),
          description: sanitizeSubject(order.subject || "支付订单"),
          orderAmount: Number(order.amount).toFixed(2),
          clientIp,
          notifyUrl: NOTIFY_URL,
          redirectUrl: `${returnOrigin}/pay/success?orderNo=${encodeURIComponent(orderNo)}`,
        };
        // 3ypay 签名文档要求 bizContent 作为 JSON 字符串参与签名，
        // 且最终请求体里也传同一个字符串，避免 3ypay 服务端重组后验签不一致。
        const bizContent = JSON.stringify(bizContentObj);

        // 4. 公共参数 + 签名
        const requestId =
          crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
        // 3ypay 客服确认：timestamp 为毫秒字符串。
        const timestamp = String(Date.now());
        const common: Record<string, unknown> = {
          appId,
          requestId,
          signType: "RSA2",
          timestamp,
          version: "1.0",
          charset: "UTF-8",
          bizContent,
        };
        const bizContentSerialized = bizContent;
        const signString = buildSignContent(common);

        // 诊断：派生本地商户私钥对应的公钥 SPKI SHA-256，便于和后台保存的商户公钥指纹比对
        let derivedPublicSha256 = "";
        let derivedPublicBase64 = "";
        try {
          const pemToDer = (pem: string) => {
            const b64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
          };
          const wrapped = merchantPrivateKey.includes("BEGIN")
            ? merchantPrivateKey
            : `-----BEGIN PRIVATE KEY-----\n${merchantPrivateKey.match(/.{1,64}/g)?.join("\n") ?? merchantPrivateKey}\n-----END PRIVATE KEY-----`;
          const der = pemToDer(wrapped);
          const priv = await crypto.subtle.importKey("pkcs8", der.buffer as ArrayBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]);
          const jwk = (await crypto.subtle.exportKey("jwk", priv)) as JsonWebKey;
          const pub = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]);
          const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pub));
          const sha = await crypto.subtle.digest("SHA-256", spki.buffer as ArrayBuffer);
          derivedPublicSha256 = Array.from(new Uint8Array(sha)).map((b) => b.toString(16).padStart(2, "0")).join("");
          derivedPublicBase64 = btoa(String.fromCharCode(...spki));
        } catch (e) {
          derivedPublicSha256 = `ERR:${e instanceof Error ? e.message : String(e)}`;
        }

        let sign: string;
        try {
          sign = await signRSA2(common, merchantPrivateKey);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logPay(supabase, orderNo, "create_error", "error", `RSA2 签名失败：${msg}`, {
            signString,
            bizContentSerialized,
          });
          return json({ success: false, error: `签名失败：${msg}` }, 200);
        }
        const reqBody = { ...common, sign };
        const requestBodyJson = JSON.stringify(reqBody);

        // 5. 调用 3ypay
        await logPay(supabase, orderNo, "create_request", "info", "POST 3ypay openapi (同源)", {
          requestId,
          productCode,
          rawProductCode,
          paySubType,
          bizContent: bizContentObj,
          bizContentSerialized,
          signString,
          sign,
          timestamp,
          appId,
          merchantPrivateKeySource,
          merchantPrivateKeyLen: merchantPrivateKey.length,
          merchantPrivateKeyFormat: merchantPrivateKey.includes("BEGIN") ? "pem" : "base64",
          requestBodyJson,
          supabaseMode,
          derivedPublicSha256,
          derivedPublicBase64,
        });
        let resp: Response;
        try {
          resp = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logPay(supabase, orderNo, "create_error", "error", `网络错误：${msg}`, {});
          return json({ success: false, error: `请求 3ypay 失败：${msg}` }, 200);
        }

        const respText = await resp.text();
        const respCt = resp.headers.get("content-type") || "";
        await logPay(supabase, orderNo, "create_response", "info", `3ypay HTTP ${resp.status}`, {
          httpStatus: resp.status,
          contentType: respCt,
          bodyPreview: respText.slice(0, 1500),
        });

        const isHtml =
          respCt.includes("text/html") || /^\s*<(!doctype|html)/i.test(respText);
        if (isHtml || resp.status === 403) {
          const blocked = /you have been blocked|被阻止访问|forbidden/i.test(respText);
          const serverEgressIp = await getServerEgressIp();
          const errMsg = blocked
            ? `3ypay 拒绝访问（HTTP ${resp.status}）：服务器出口 IP ${serverEgressIp ?? "检测失败"} 被风控拦截。请将此 IP 加入 3ypay 白名单，或联系 3ypay 客服解封。`
            : `3ypay 返回非 JSON 响应（HTTP ${resp.status}）`;
          await logPay(supabase, orderNo, "create_error", "error", errMsg, {
            httpStatus: resp.status,
            serverEgressIp,
            expectedWhitelistIp: "103.87.9.218",
          });
          return json(
            { success: false, error: errMsg, httpStatus: resp.status },
            200,
          );
        }

        let respJson: Record<string, unknown> = {};
        try {
          respJson = JSON.parse(respText);
        } catch {
          const errMsg = `3ypay 响应非 JSON（HTTP ${resp.status})`;
          await logPay(supabase, orderNo, "create_error", "error", errMsg, {
            body: respText.slice(0, 1500),
          });
          return json({ success: false, error: errMsg }, 200);
        }

        if (respJson.code !== 200 || !respJson.data) {
          const errMsg = `3ypay 返回失败：${respJson.msg || respJson.subMsg || "未知错误"}（code=${respJson.code}）`;
          await logPay(supabase, orderNo, "create_error", "error", errMsg, {
            code: respJson.code,
            raw: respJson,
          });
          return json({ success: false, error: errMsg, raw: respJson }, 200);
        }

        // 6. 验签响应
        if (respJson.sign) {
          const ok = await verifyRSA2(
            respJson,
            String(respJson.sign),
            platformPublicKey,
          );
          if (!ok) {
            await logPay(supabase, orderNo, "create_error", "error", "响应验签失败（仅告警）", {
              raw: respJson,
            });
          }
        }

        // 7. 解析 data → payInfo / payUrl
        let dataObj: Record<string, unknown> = {};
        try {
          dataObj =
            typeof respJson.data === "string"
              ? JSON.parse(respJson.data as string)
              : (respJson.data as Record<string, unknown>);
        } catch {
          await logPay(supabase, orderNo, "create_error", "error", "data 解析失败", {
            data: respJson.data,
          });
          return json({ success: false, error: "3ypay data 解析失败" }, 200);
        }
        const payUrl =
          (dataObj.payInfo as string) ||
          (dataObj.payUrl as string) ||
          (dataObj.payData as string) ||
          (dataObj.cashierUrl as string);
        if (!payUrl || typeof payUrl !== "string") {
          const failReason =
            (dataObj.failReason as string) ||
            (dataObj.failCode as string) ||
            "未取到收银台 URL";
          await logPay(supabase, orderNo, "create_error", "error", String(failReason), {
            dataObj,
          });
          return json(
            { success: false, error: String(failReason), data: dataObj },
            200,
          );
        }

        await logPay(supabase, orderNo, "create_response", "info", "已获取收银台 URL", {
          payDataType: dataObj.payDataType,
          payOrderNo: dataObj.payOrderNo,
          payUrlPreview: payUrl.slice(0, 200),
        });

        return json({
          success: true,
          payUrl,
          payOrderNo: dataObj.payOrderNo,
        });
      },
    },
  },
});
