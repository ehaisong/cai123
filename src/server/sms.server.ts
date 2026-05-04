// Server-only helpers: aliyun SMS send + sms_codes storage.
import crypto from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALIYUN_ENDPOINT = "https://dysmsapi.aliyuncs.com/";
const ALIYUN_VERSION = "2017-05-25";
const ALIYUN_REGION = "cn-hangzhou";

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/** Aliyun POP RPC signature v1.0 (HMAC-SHA1). */
function signAliyunRequest(
  params: Record<string, string>,
  accessKeySecret: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const canonical = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  return crypto
    .createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");
}

export async function sendAliyunSms(opts: {
  phone: string;
  code: string;
}): Promise<{ ok: boolean; message?: string; raw?: unknown }> {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    return { ok: false, message: "短信服务未配置完整凭据" };
  }

  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: opts.phone,
    RegionId: ALIYUN_REGION,
    SignName: signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: opts.code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: ALIYUN_VERSION,
  };

  const signature = signAliyunRequest(params, accessKeySecret);
  const body = new URLSearchParams({ ...params, Signature: signature }).toString();

  const res = await fetch(ALIYUN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let json: { Code?: string; Message?: string } | null = null;
  try {
    json = text ? (JSON.parse(text) as { Code?: string; Message?: string }) : null;
  } catch {
    /* not json */
  }
  if (!res.ok || !json || json.Code !== "OK") {
    console.error("[aliyun-sms] send failed", {
      status: res.status,
      code: json?.Code,
      message: json?.Message,
      preview: text.slice(0, 200),
    });
    return {
      ok: false,
      message: json?.Message ?? `发送失败 (${res.status})`,
      raw: json ?? text,
    };
  }
  return { ok: true, raw: json };
}

export function normalizePhoneCN(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  // strip leading 86 country code
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
}

export function hashSmsCode(phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

export function generate6DigitCode(): string {
  // 100000 - 999999
  const n = crypto.randomInt(100000, 1000000);
  return String(n);
}

/** Light-weight rate limit using sms_codes table. */
export async function checkSendRateLimit(phone: string): Promise<
  { ok: true } | { ok: false; message: string }
> {
  // Last 60s: at most 1 send per phone
  const since60s = new Date(Date.now() - 60_000).toISOString();
  const { count: c1 } = await supabaseAdmin
    .from("sms_codes")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", since60s);
  if ((c1 ?? 0) > 0) {
    return { ok: false, message: "请 60 秒后再获取验证码" };
  }
  // Last hour: at most 5 sends per phone
  const since1h = new Date(Date.now() - 3600_000).toISOString();
  const { count: c2 } = await supabaseAdmin
    .from("sms_codes")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", since1h);
  if ((c2 ?? 0) >= 5) {
    return { ok: false, message: "1 小时内验证码请求过多，请稍后再试" };
  }
  return { ok: true };
}
