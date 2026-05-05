// Supabase Edge Function: 用 ticket 与中转站换取用户信息（统一兑换：微信/手机号），
// 在 Supabase Auth 内查/建用户，签发 magiclink token_hash 给前端 verifyOtp。
//
// 部署后地址：
//   https://<project-ref>.functions.supabase.co/wechat-exchange
//
// 入参：{ ticket, return_path, provider? }
//   provider 可选，仅用于日志提示；后端以中转站返回的 provider 为准。
//
// 中转站接口（统一）：
//   POST https://wx.lovclaw.com/api/public/oauth/exchange
//     body: { ticket, client, client_secret }
//   响应：
//     { provider:"wechat", openid, unionid, nickname, avatar, ... }
//     { provider:"phone", phone:"+8613800001111", issued_at }
//
// 老路径 /api/public/oauth/wechat/exchange 也兼容（同样按 provider 分支）。

// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const HUB_EXCHANGE = "https://wx.lovclaw.com/api/public/oauth/exchange";
const HUB_EXCHANGE_LEGACY =
  "https://wx.lovclaw.com/api/public/oauth/wechat/exchange";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function log(step: string, info: Record<string, unknown>) {
  try {
    console.log(`[oauth-exchange] ${step}`, JSON.stringify(info));
  } catch {
    console.log(`[oauth-exchange] ${step}`, info);
  }
}

function logErr(step: string, info: Record<string, unknown>) {
  try {
    console.error(`[oauth-exchange:ERR] ${step}`, JSON.stringify(info));
  } catch {
    console.error(`[oauth-exchange:ERR] ${step}`, info);
  }
}

function maskPhone(p: string): string {
  if (!p) return "";
  const digits = p.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return digits.slice(0, 3) + "****" + digits.slice(-4);
}

function normalizePhoneForAuth(raw: string): string {
  // Supabase auth.users.phone 通常存为不带 + 的纯数字（E.164 去掉 +）
  return raw.replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { step: "method", message: "Method Not Allowed" });
  }

  const t0 = Date.now();
  let payload: { ticket?: string; return_path?: string; provider?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { step: "input", message: "invalid JSON body" });
  }

  const ticket = (payload.ticket ?? "").trim();
  const return_path = payload.return_path ?? "/";
  const hintProvider = payload.provider ?? "";

  if (!ticket || ticket.length < 20 || ticket.length > 200) {
    return jsonResponse(400, {
      step: "input",
      message: "缺少或非法的 ticket 参数",
    });
  }

  const ticketTail = ticket.slice(-8);
  log("start", { ticketTail, return_path, hintProvider });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const HUB_SECRET = Deno.env.get("WECHAT_HUB_SECRET");

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    logErr("config", { hasUrl: !!SUPABASE_URL, hasKey: !!SERVICE_ROLE });
    return jsonResponse(500, {
      step: "config",
      message: "服务端缺少 Supabase 配置",
    });
  }
  if (!HUB_SECRET) {
    logErr("config", { reason: "missing WECHAT_HUB_SECRET" });
    return jsonResponse(500, {
      step: "config",
      message: "服务端未配置 WECHAT_HUB_SECRET",
    });
  }

  // 1. 用 ticket 换取用户信息（先走统一接口；404/未知则回退老接口，兼容微信旧 ticket）
  async function callHub(url: string): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket,
        client: "66cai",
        client_secret: HUB_SECRET,
      }),
    });
  }

  let hubRes: Response;
  try {
    hubRes = await callHub(HUB_EXCHANGE);
    if (hubRes.status === 404) {
      log("hub.fallback_legacy", { ticketTail });
      hubRes = await callHub(HUB_EXCHANGE_LEGACY);
    }
  } catch (e) {
    logErr("hub.fetch", { ticketTail, error: String(e?.message ?? e) });
    return jsonResponse(502, {
      step: "hub.fetch",
      message: `中转站请求失败: ${e?.message ?? "network error"}`,
    });
  }

  const raw = await hubRes.text();
  let hubBody: any = null;
  try {
    hubBody = raw ? JSON.parse(raw) : null;
  } catch {
    // not JSON
  }

  log("hub.response", {
    ticketTail,
    status: hubRes.status,
    ok: hubRes.ok,
    keys: hubBody && typeof hubBody === "object" ? Object.keys(hubBody) : null,
    rawPreview: !hubBody ? raw?.slice(0, 200) : null,
  });

  if (!hubRes.ok) {
    const errcode = hubBody?.error ?? hubBody?.errcode ?? hubRes.status;
    const errmsg =
      hubBody?.message ?? hubBody?.errmsg ?? raw?.slice(0, 200) ?? "exchange_failed";
    logErr("hub.exchange", { ticketTail, errcode, errmsg });
    return jsonResponse(400, {
      step: "hub.exchange",
      message: `登录失败: ${errmsg}`,
      errcode,
      errmsg,
      raw: hubBody ?? raw,
    });
  }

  // 中转站可能把数据放在 .user 或者直接平铺
  const data = (hubBody?.user ?? hubBody) as Record<string, any>;
  const provider: string =
    data?.provider ?? (data?.openid ? "wechat" : data?.phone ? "phone" : "");

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId: string | null = null;
  let knownEmail: string | null = null;
  // 后台任务（profile 回填等），不阻塞登录
  const sideEffects: Promise<unknown>[] = [];

  if (provider === "wechat") {
    const wx = data as {
      openid?: string;
      unionid?: string | null;
      nickname?: string | null;
      avatar?: string | null;
    };
    if (!wx?.openid) {
      logErr("hub.payload", { ticketTail, payload: hubBody });
      return jsonResponse(400, {
        step: "hub.payload",
        message: "微信返回数据缺少 openid",
        raw: hubBody,
      });
    }
    const openidTail = wx.openid.slice(-6);
    log("hub.user.wechat", {
      openidTail,
      hasUnionid: !!wx.unionid,
      hasNickname: !!wx.nickname,
    });

    // 1) 查找已绑定的 user
    const { data: existingUid, error: findErr } = await supabaseAdmin.rpc(
      "find_user_by_wechat",
      { _openid: wx.openid, _unionid: wx.unionid ?? "" } as any,
    );
    if (findErr) {
      logErr("rpc.find_user_by_wechat", {
        openidTail,
        message: findErr.message,
      });
      return jsonResponse(500, {
        step: "rpc.find_user_by_wechat",
        message: `查找用户失败: ${findErr.message}`,
      });
    }
    userId = (existingUid as string | null) ?? null;
    log("user.match", { provider, openidTail, matched: !!userId });

    // 2) 不存在则创建（合成 email）
    if (!userId) {
      const syntheticEmail = `wx_${wx.openid}@wechat.local`;
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email: syntheticEmail,
          email_confirm: true,
          user_metadata: {
            nickname: wx.nickname ?? "微信用户",
            avatar_url: wx.avatar,
            login_provider: "wechat",
          },
        });
      if (createErr || !created.user) {
        logErr("auth.createUser.wechat", {
          openidTail,
          message: createErr?.message,
        });
        return jsonResponse(500, {
          step: "auth.createUser",
          message: `创建用户失败: ${createErr?.message ?? "unknown"}`,
        });
      }
      userId = created.user.id;
      knownEmail = syntheticEmail;
      log("auth.created.wechat", { openidTail, userId });
    }

    // 3) 回填 profile（并行，不阻塞登录）
    sideEffects.push(
      supabaseAdmin
        .rpc("bind_wechat_to_profile", {
          _user_id: userId,
          _openid: wx.openid,
          _unionid: wx.unionid ?? "",
          _nickname: wx.nickname ?? "",
          _avatar: wx.avatar ?? "",
        } as any)
        .then(({ error }) => {
          if (error) {
            logErr("rpc.bind_wechat_to_profile", {
              userId,
              openidTail,
              message: error.message,
            });
          } else {
            log("profile.bound", { userId, openidTail });
          }
        }),
    );
  } else if (provider === "phone") {
    const rawPhone: string = String(data?.phone ?? "").trim();
    if (!rawPhone || !/^\+?\d{8,15}$/.test(rawPhone.replace(/\s|-/g, ""))) {
      logErr("hub.payload.phone", { ticketTail, payload: hubBody });
      return jsonResponse(400, {
        step: "hub.payload",
        message: "中转站返回的 phone 格式不正确",
        raw: hubBody,
      });
    }
    const normPhone = normalizePhoneForAuth(rawPhone); // e.g. "8613800001111"
    const phoneMasked = maskPhone(rawPhone);
    log("hub.user.phone", { phoneMasked });

    // 1) 按 phone 查找
    const { data: foundUid, error: findErr } = await supabaseAdmin.rpc(
      "find_user_by_phone",
      { _phone: normPhone } as any,
    );
    if (findErr) {
      logErr("rpc.find_user_by_phone", { phoneMasked, message: findErr.message });
      return jsonResponse(500, {
        step: "rpc.find_user_by_phone",
        message: `查找用户失败: ${findErr.message}`,
      });
    }
    userId = (foundUid as string | null) ?? null;
    log("user.match", { provider, phoneMasked, matched: !!userId });

    // 2) 不存在则按手机号创建
    if (!userId) {
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          phone: normPhone,
          phone_confirm: true,
          user_metadata: { login_provider: "phone" },
        });
      if (createErr || !created.user) {
        logErr("auth.createUser.phone", {
          phoneMasked,
          message: createErr?.message,
        });
        return jsonResponse(500, {
          step: "auth.createUser",
          message: `创建用户失败: ${createErr?.message ?? "unknown"}`,
        });
      }
      userId = created.user.id;
      log("auth.created.phone", { phoneMasked, userId });
    }

    // 回填 profile.phone（并行，不阻塞登录）
    sideEffects.push(
      supabaseAdmin
        .from("profiles")
        .update({ phone: rawPhone })
        .eq("user_id", userId)
        .is("phone", null)
        .then(({ error }) => {
          if (error) {
            log("profile.phone.update.skip", { userId, msg: error.message });
          }
        }),
    );
  } else {
    logErr("hub.provider.unknown", { provider, ticketTail, payload: hubBody });
    return jsonResponse(400, {
      step: "hub.payload",
      message: `中转站返回的 provider 未知：${provider || "(empty)"}`,
      raw: hubBody,
    });
  }

  // 4. 拿到 userId 后，签发 magiclink token_hash 给前端 verifyOtp。
  //    若已知 email（刚创建的用户）则直接用，省一次 getUserById RTT。
  let email = knownEmail;
  if (!email) {
    const { data: userInfo, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(userId!);
    if (getErr || !userInfo.user) {
      logErr("auth.getUserById", { userId, message: getErr?.message });
      return jsonResponse(500, {
        step: "auth.getUserById",
        message: `无法读取用户信息: ${getErr?.message ?? "unknown"}`,
      });
    }
    email = userInfo.user.email ?? null;
    if (!email) {
      // 纯手机号用户补合成 email（仅用于签发 magiclink）
      const syntheticEmail = `phone_${userId}@phone.local`;
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
        userId!,
        { email: syntheticEmail, email_confirm: true },
      );
      if (updErr) {
        logErr("auth.attachSyntheticEmail", { userId, message: updErr.message });
        return jsonResponse(500, {
          step: "auth.attachSyntheticEmail",
          message: `补全用户邮箱失败: ${updErr.message}`,
        });
      }
      email = syntheticEmail;
      log("auth.email.synthesized", { userId });
    }
  }

  const { data: linkData, error: linkErr } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkErr || !linkData.properties?.hashed_token) {
    logErr("auth.generateLink", { userId, message: linkErr?.message });
    return jsonResponse(500, {
      step: "auth.generateLink",
      message: `签发登录令牌失败: ${linkErr?.message ?? "unknown"}`,
    });
  }

  const safeRedirect =
    return_path && return_path.startsWith("/") && !return_path.startsWith("//")
      ? return_path
      : "/";

  log("done", {
    provider,
    userId,
    ms: Date.now() - t0,
    redirectTo: safeRedirect,
  });

  return jsonResponse(200, {
    success: true,
    provider,
    tokenHash: linkData.properties.hashed_token,
    email: usedEmailForLink,
    redirectTo: safeRedirect,
  });
});
