// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RELAY = "https://wx.lovclaw.com";

function normalizePhoneCN(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
}

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function relay(path: string, body: Record<string, unknown>) {
  const client = Deno.env.get("SMS_RELAY_CLIENT");
  const secret = Deno.env.get("SMS_RELAY_CLIENT_SECRET");
  if (!client || !secret) return { status: 500, json: { ok: false, message: "短信中转站未配置" } };
  const r = await fetch(`${RELAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client, client_secret: secret, ...body }),
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: r.status, json: json ?? { ok: false, message: text } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneCN(String(body.phone ?? ""));
    const code = String(body.code ?? "").trim();
    const sid = String(body.sid ?? "").trim();
    if (!phone) return j({ ok: false, message: "请输入正确的商家手机号" });
    if (!/^\d{4,8}$/.test(code)) return j({ ok: false, message: "请输入正确的验证码" });
    if (!sid) return j({ ok: false, message: "会话已失效，请重新获取验证码" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return j({ ok: false, message: "未登录" }, 401);

    // 验证短信
    const verify = await relay("/api/public/sms/verify", { sid, phone, code });
    if (!verify.json?.ok || !verify.json?.ticket) {
      const map: Record<string, string> = {
        bad_code: "验证码错误", too_many_attempts: "尝试次数过多，请重新获取",
        expired: "验证码已过期", session_expired: "会话已过期，请重新获取",
      };
      return j({ ok: false, message: map[verify.json?.error] ?? verify.json?.message ?? "验证失败" }, verify.status);
    }
    // 校验 ticket 对应手机号与传入一致
    const ex = await relay("/api/public/oauth/exchange", { ticket: verify.json.ticket });
    if (!ex.json?.phone) return j({ ok: false, message: "验证失败" }, ex.status);
    const verified = String(ex.json.phone).replace(/^\+?86/, "").replace(/\D/g, "");
    if (verified !== phone) return j({ ok: false, message: "手机号不匹配" });

    // 调 RPC 完成绑定（用调用者 JWT，保证 auth.uid() 是当前用户）
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: mid, error } = await supa.rpc("agent_add_merchant_binding", { _merchant_owner_phone: phone });
    if (error) return j({ ok: false, message: error.message ?? "绑定失败" });
    return j({ ok: true, merchant_id: mid });
  } catch (e) {
    console.error("[agent-bind-merchant]", e);
    return j({ ok: false, message: e instanceof Error ? e.message : "服务异常" }, 500);
  }
});
