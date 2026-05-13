// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function normalizePhoneCN(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneCN(String(body.phone ?? ""));
    const password = String(body.password ?? "");
    if (!phone) return j({ ok: false, message: "请输入正确的手机号" });
    if (password.length < 6) return j({ ok: false, message: "密码至少 6 位" });

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const admin = createClient(url, serviceKey);

    // 1. 查 user by phone
    const { data: foundUid, error: rpcErr } = await admin.rpc("find_user_by_phone", { _phone: phone });
    if (rpcErr) {
      console.error("[phone-password-login] find_user_by_phone", rpcErr);
      return j({ ok: false, message: "查询用户失败" });
    }
    if (!foundUid) return j({ ok: false, message: "手机号未注册或密码错误" });

    // 2. 取邮箱（合成或真实）
    const { data: u, error: gErr } = await admin.auth.admin.getUserById(foundUid as string);
    if (gErr || !u?.user) return j({ ok: false, message: "账号不存在" });
    const email = u.user.email;
    if (!email) return j({ ok: false, message: "该账号未设置密码，请使用验证码登录" });

    // 3. 用 anon client 走 password grant（Email provider 默认开启）
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr || !signIn.session) {
      return j({ ok: false, message: "手机号或密码错误" });
    }
    return j({
      ok: true,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (e) {
    console.error("[phone-password-login] exception", e);
    return j({ ok: false, message: e instanceof Error ? e.message : "服务异常" }, 500);
  }
});
