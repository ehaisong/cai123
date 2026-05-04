// SMS login server functions: send code + verify code -> Supabase magiclink token_hash.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checkSendRateLimit,
  generate6DigitCode,
  hashSmsCode,
  normalizePhoneCN,
  sendAliyunSms,
} from "./sms.server";

const sendSchema = z.object({ phone: z.string().min(8).max(20) });
const verifySchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().regex(/^\d{6}$/),
});

export const sendSmsCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => sendSchema.parse(input))
  .handler(async ({ data }) => {
    const phone = normalizePhoneCN(data.phone);
    if (!phone) {
      return { ok: false as const, message: "请输入正确的手机号" };
    }

    const limit = await checkSendRateLimit(phone);
    if (!limit.ok) {
      return { ok: false as const, message: limit.message };
    }

    const code = generate6DigitCode();
    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    const { error: insErr } = await supabaseAdmin.from("sms_codes").insert({
      phone,
      code_hash: hashSmsCode(phone, code),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      ip,
    });
    if (insErr) {
      console.error("[sendSmsCode] insert error", insErr);
      return { ok: false as const, message: "服务繁忙，请稍后再试" };
    }

    const send = await sendAliyunSms({ phone, code });
    if (!send.ok) {
      return { ok: false as const, message: send.message ?? "短信发送失败" };
    }
    return { ok: true as const };
  });

export const verifySmsCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => verifySchema.parse(input))
  .handler(async ({ data }) => {
    const phone = normalizePhoneCN(data.phone);
    if (!phone) {
      return { ok: false as const, message: "请输入正确的手机号" };
    }

    // Latest unconsumed code that has not expired
    const { data: rows, error: qErr } = await supabaseAdmin
      .from("sms_codes")
      .select("id, code_hash, expires_at, consumed_at")
      .eq("phone", phone)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (qErr) {
      console.error("[verifySmsCode] query error", qErr);
      return { ok: false as const, message: "服务繁忙，请稍后再试" };
    }
    const row = rows?.[0];
    if (!row) {
      return { ok: false as const, message: "请先获取验证码" };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false as const, message: "验证码已过期，请重新获取" };
    }
    if (row.code_hash !== hashSmsCode(phone, data.code)) {
      return { ok: false as const, message: "验证码不正确" };
    }

    // Consume code
    await supabaseAdmin
      .from("sms_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);

    // Find existing user by phone via RPC, else create
    const { data: foundUid, error: rpcErr } = await supabaseAdmin.rpc(
      "find_user_by_phone",
      { _phone: phone },
    );
    if (rpcErr) {
      console.error("[verifySmsCode] find_user_by_phone error", rpcErr);
      return { ok: false as const, message: "查询用户失败" };
    }
    let userId = (foundUid as string | null) ?? null;
    if (!userId) {
      const { data: created, error: cErr } =
        await supabaseAdmin.auth.admin.createUser({
          phone,
          phone_confirm: true,
          user_metadata: { login_provider: "phone" },
        });
      if (cErr || !created.user) {
        console.error("[verifySmsCode] createUser error", cErr);
        return { ok: false as const, message: `创建用户失败: ${cErr?.message ?? ""}` };
      }
      userId = created.user.id;
    }

    // Ensure email exists for magiclink issuance
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    let email = u?.user?.email ?? null;
    if (!email) {
      email = `phone_${userId}@phone.local`;
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });
      if (upErr) {
        console.error("[verifySmsCode] attach email error", upErr);
        return { ok: false as const, message: `登录失败: ${upErr.message}` };
      }
    }

    // Backfill profile.phone if empty
    try {
      await supabaseAdmin
        .from("profiles")
        .update({ phone })
        .eq("user_id", userId)
        .is("phone", null);
    } catch {
      /* non-blocking */
    }

    const { data: link, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (lErr || !link.properties?.hashed_token) {
      console.error("[verifySmsCode] generateLink error", lErr);
      return { ok: false as const, message: `签发登录令牌失败: ${lErr?.message ?? ""}` };
    }

    return {
      ok: true as const,
      tokenHash: link.properties.hashed_token,
      email,
    };
  });
