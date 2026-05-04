// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneCN(String(body.phone ?? ""));
    const code = String(body.code ?? "");
    if (!phone) return j({ ok: false, message: "请输入正确的手机号" });
    if (!/^\d{6}$/.test(code)) return j({ ok: false, message: "请输入 6 位验证码" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: rows, error: qErr } = await supabase
      .from("sms_codes")
      .select("id, code_hash, expires_at, consumed_at")
      .eq("phone", phone)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (qErr) {
      console.error("[sms-verify] query", qErr);
      return j({ ok: false, message: "服务繁忙，请稍后再试" });
    }
    const row = rows?.[0];
    if (!row) return j({ ok: false, message: "请先获取验证码" });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return j({ ok: false, message: "验证码已过期，请重新获取" });
    }
    const expected = await sha256Hex(`${phone}:${code}`);
    if (row.code_hash !== expected) {
      return j({ ok: false, message: "验证码不正确" });
    }
    await supabase.from("sms_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);

    // Find or create user by phone
    const { data: foundUid, error: rpcErr } = await supabase.rpc("find_user_by_phone", { _phone: phone });
    if (rpcErr) {
      console.error("[sms-verify] find_user_by_phone", rpcErr);
      return j({ ok: false, message: "查询用户失败" });
    }
    let userId = (foundUid as string | null) ?? null;
    if (!userId) {
      const { data: created, error: cErr } = await supabase.auth.admin.createUser({
        phone,
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
      await supabase.from("profiles").update({ phone }).eq("user_id", userId!).is("phone", null);
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
