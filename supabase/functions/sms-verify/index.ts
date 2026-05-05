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
    const code = String(body.code ?? "");
    if (!phone) return j({ ok: false, message: "请输入正确的手机号" });
    if (!/^\d{4,8}$/.test(code)) return j({ ok: false, message: "请输入正确的验证码" });

    const accessKeyId = Deno.env.get("UNIMTX_ACCESS_KEY_ID");
    if (!accessKeyId) return j({ ok: false, message: "短信服务未配置完整凭据" });

    // Verify code via Unimatrix
    const url = `${UNIMTX_ENDPOINT}?action=otp.verify&accessKeyId=${encodeURIComponent(accessKeyId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: `+86${phone}`,
        code,
        intent: "login",
      }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok || !json || String(json.code) !== "0") {
      console.error("[sms-verify] unimtx fail", {
        status: res.status,
        code: json?.code,
        message: json?.message,
      });
      return j({ ok: false, message: json?.message ?? "验证失败，请重新获取" });
    }
    if (json?.data?.valid !== true) {
      return j({ ok: false, message: "验证码不正确或已过期" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
