// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UNIMTX_ENDPOINT = "https://api-cn.unimtx.com/";

function normalizePhoneCN(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
}

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneCN(String(body.phone ?? ""));
    if (!phone) return j({ ok: false, message: "请输入正确的手机号" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit: 60s 1 send, 1h 5 sends
    const since60s = new Date(Date.now() - 60_000).toISOString();
    const { count: c1 } = await supabase.from("sms_codes")
      .select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since60s);
    if ((c1 ?? 0) > 0) {
      return j({ ok: false, message: "请 60 秒后再获取验证码" });
    }
    const since1h = new Date(Date.now() - 3600_000).toISOString();
    const { count: c2 } = await supabase.from("sms_codes")
      .select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since1h);
    if ((c2 ?? 0) >= 5) {
      return j({ ok: false, message: "1 小时内验证码请求过多，请稍后再试" });
    }

    const accessKeyId = Deno.env.get("UNIMTX_ACCESS_KEY_ID");
    const signature = (Deno.env.get("UNIMTX_SIGNATURE") ?? "").trim();
    if (!accessKeyId || !signature) {
      return j({ ok: false, message: "短信服务未配置完整凭据" });
    }

    const url = `${UNIMTX_ENDPOINT}?action=otp.send&accessKeyId=${encodeURIComponent(accessKeyId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: `+86${phone}`,
        signature,
        intent: "login",
      }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok || !json || String(json.code) !== "0") {
      console.error("[sms-send] unimtx fail", {
        status: res.status,
        code: json?.code,
        message: json?.message,
      });
      return j({ ok: false, message: json?.message ?? `发送失败 (${res.status})` });
    }

    const ip = req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    // Record send for rate limiting (code stored remotely by Unimatrix)
    const { error: insErr } = await supabase.from("sms_codes").insert({
      phone,
      code_hash: "unimtx",
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      ip,
    });
    if (insErr) console.error("[sms-send] rate-record insert", insErr);

    return j({ ok: true });
  } catch (e) {
    console.error("[sms-send] exception", e);
    return j({ ok: false, message: e instanceof Error ? e.message : "服务异常" }, 500);
  }
});
