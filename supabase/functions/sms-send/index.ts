// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

async function hmacSha1Base64(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALIYUN_ENDPOINT = "https://dysmsapi.aliyuncs.com/";
const ALIYUN_VERSION = "2017-05-25";
const ALIYUN_REGION = "cn-hangzhou";

function percentEncode(s: string) {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function signAliyun(params: Record<string, string>, secret: string) {
  const keys = Object.keys(params).sort();
  const canonical = keys.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  const sig = hmac("sha1", `${secret}&`, stringToSign, "utf8", "base64");
  return sig as string;
}

function normalizePhoneCN(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gen6Code() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, message: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneCN(String(body.phone ?? ""));
    if (!phone) {
      return new Response(JSON.stringify({ ok: false, message: "请输入正确的手机号" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit: 60s 1 send, 1h 5 sends
    const since60s = new Date(Date.now() - 60_000).toISOString();
    const { count: c1 } = await supabase.from("sms_codes")
      .select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since60s);
    if ((c1 ?? 0) > 0) {
      return new Response(JSON.stringify({ ok: false, message: "请 60 秒后再获取验证码" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const since1h = new Date(Date.now() - 3600_000).toISOString();
    const { count: c2 } = await supabase.from("sms_codes")
      .select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since1h);
    if ((c2 ?? 0) >= 5) {
      return new Response(JSON.stringify({ ok: false, message: "1 小时内验证码请求过多，请稍后再试" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const code = gen6Code();
    const ip = req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const { error: insErr } = await supabase.from("sms_codes").insert({
      phone,
      code_hash: await sha256Hex(`${phone}:${code}`),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      ip,
    });
    if (insErr) {
      console.error("[sms-send] insert", insErr);
      return new Response(JSON.stringify({ ok: false, message: "服务繁忙，请稍后再试" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessKeyId = Deno.env.get("ALIYUN_SMS_ACCESS_KEY_ID");
    const accessKeySecret = Deno.env.get("ALIYUN_SMS_ACCESS_KEY_SECRET");
    const signName = Deno.env.get("ALIYUN_SMS_SIGN_NAME");
    const templateCode = Deno.env.get("ALIYUN_SMS_TEMPLATE_CODE");
    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      return new Response(JSON.stringify({ ok: false, message: "短信服务未配置完整凭据" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: "SendSms",
      Format: "JSON",
      PhoneNumbers: phone,
      RegionId: ALIYUN_REGION,
      SignName: signName,
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: crypto.randomUUID(),
      SignatureVersion: "1.0",
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      Version: ALIYUN_VERSION,
    };
    const signature = signAliyun(params, accessKeySecret);
    const formBody = new URLSearchParams({ ...params, Signature: signature }).toString();

    const res = await fetch(ALIYUN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!res.ok || !json || json.Code !== "OK") {
      console.error("[sms-send] aliyun fail", { status: res.status, body: text.slice(0, 300) });
      return new Response(JSON.stringify({ ok: false, message: json?.Message ?? `发送失败 (${res.status})` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[sms-send] exception", e);
    return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : "服务异常" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
