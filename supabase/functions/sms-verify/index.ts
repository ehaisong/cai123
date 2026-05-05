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
  if (!client || !secret) {
    return { status: 500, json: { ok: false, error: "relay_not_configured", message: "短信中转站未配置凭据" } };
  }
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
    const mode = String(body.mode ?? "login"); // "login" | "bind"
    const password = body.password ? String(body.password) : null;

    if (!phone) return j({ ok: false, message: "请输入正确的手机号" });
    if (!/^\d{4,8}$/.test(code)) return j({ ok: false, message: "请输入正确的验证码" });
    if (!sid) return j({ ok: false, message: "会话已失效，请重新获取验证码" });

    // verify
    const verify = await relay("/api/public/sms/verify", { sid, phone, code });
    if (!verify.json?.ok || !verify.json?.ticket) {
      const map: Record<string, string> = {
        bad_code: "验证码错误",
        too_many_attempts: "尝试次数过多，请重新获取验证码",
        expired: "验证码已过期",
        session_expired: "会话已过期，请重新获取验证码",
      };
      const msg = map[verify.json?.error] ?? verify.json?.message ?? "验证失败";
      return j({ ok: false, message: msg }, verify.status);
    }

    // exchange ticket -> phone (E.164 +8613...)
    const ex = await relay("/api/public/oauth/exchange", { ticket: verify.json.ticket });
    if (!ex.json?.phone) {
      console.error("[sms-verify] exchange fail", ex);
      return j({ ok: false, message: ex.json?.message ?? "登录失败" }, ex.status);
    }
    const e164 = String(ex.json.phone); // +8613...
    const normalized = e164.replace(/^\+?86/, "").replace(/\D/g, "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ===== 绑定模式：把已登录的微信账号绑定手机号（可选设置密码） =====
    if (mode === "bind") {
      const authHeader = req.headers.get("Authorization") ?? "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      if (!jwt) return j({ ok: false, message: "未登录" }, 401);
      const { data: userData, error: uErr } = await supabase.auth.getUser(jwt);
      if (uErr || !userData.user) return j({ ok: false, message: "登录态已失效" }, 401);
      const currentUid = userData.user.id;

      // 该手机号是否已被其他账号占用？
      const { data: foundUid } = await supabase.rpc("find_user_by_phone", { _phone: normalized });
      if (foundUid && foundUid !== currentUid) {
        return j({ ok: false, message: "该手机号已被其他账号绑定" });
      }

      const updates: any = { phone: normalized, phone_confirm: true };
      if (password && password.length >= 6) updates.password = password;
      const { error: upErr } = await supabase.auth.admin.updateUserById(currentUid, updates);
      if (upErr) {
        console.error("[sms-verify] bind updateUserById", upErr);
        return j({ ok: false, message: `绑定失败：${upErr.message}` });
      }
      try { await supabase.from("profiles").update({ phone: normalized }).eq("user_id", currentUid); } catch { /* noop */ }
      return j({ ok: true, bound: true });
    }

    // ===== 登录模式：按手机号查/建用户，签发登录令牌 =====
    const { data: foundUid, error: rpcErr } = await supabase.rpc("find_user_by_phone", { _phone: normalized });
    if (rpcErr) {
      console.error("[sms-verify] find_user_by_phone", rpcErr);
      return j({ ok: false, message: "查询用户失败" });
    }
    let userId = (foundUid as string | null) ?? null;
    if (!userId) {
      const { data: created, error: cErr } = await supabase.auth.admin.createUser({
        phone: normalized,
        phone_confirm: true,
        user_metadata: { login_provider: "phone" },
      });
      if (cErr || !created.user) {
        console.error("[sms-verify] createUser", cErr);
        return j({ ok: false, message: `创建用户失败: ${cErr?.message ?? ""}` });
      }
      userId = created.user.id;
    }

    const { data: u } = await supabase.auth.admin.getUserById(userId!);
    let email = u?.user?.email ?? null;
    if (!email) {
      email = `phone_${userId}@phone.local`;
      const { error: upErr } = await supabase.auth.admin.updateUserById(userId!, {
        email, email_confirm: true,
      });
      if (upErr) {
        console.error("[sms-verify] attach email", upErr);
        return j({ ok: false, message: `登录失败: ${upErr.message}` });
      }
    }

    try {
      await supabase.from("profiles").update({ phone: normalized }).eq("user_id", userId!).is("phone", null);
    } catch { /* noop */ }

    const { data: link, error: lErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (lErr || !link.properties?.hashed_token) {
      console.error("[sms-verify] generateLink", lErr);
      return j({ ok: false, message: `签发登录令牌失败: ${lErr?.message ?? ""}` });
    }

    return j({ ok: true, tokenHash: link.properties.hashed_token, email });
  } catch (e) {
    console.error("[sms-verify] exception", e);
    return j({ ok: false, message: e instanceof Error ? e.message : "服务异常" }, 500);
  }
});
