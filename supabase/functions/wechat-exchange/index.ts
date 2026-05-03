// Supabase Edge Function: 用 ticket 与微信中转站换取用户信息，
// 在 Supabase Auth 内查/建用户，签发 magiclink token_hash 给前端 verifyOtp。
//
// 部署后地址：
//   https://<project-ref>.functions.supabase.co/wechat-exchange
//
// 在静态部署（Zeabur）下，前端走这个 Edge Function，不再依赖 TanStack server function。

// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const HUB_EXCHANGE = "https://wx.lovclaw.com/api/public/oauth/wechat/exchange";

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
    console.log(`[wechat-exchange] ${step}`, JSON.stringify(info));
  } catch {
    console.log(`[wechat-exchange] ${step}`, info);
  }
}

function logErr(step: string, info: Record<string, unknown>) {
  try {
    console.error(`[wechat-exchange:ERR] ${step}`, JSON.stringify(info));
  } catch {
    console.error(`[wechat-exchange:ERR] ${step}`, info);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { step: "method", message: "Method Not Allowed" });
  }

  const t0 = Date.now();
  let payload: { ticket?: string; return_path?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { step: "input", message: "invalid JSON body" });
  }

  const ticket = (payload.ticket ?? "").trim();
  const return_path = payload.return_path ?? "/";

  if (!ticket || ticket.length < 20 || ticket.length > 200) {
    return jsonResponse(400, {
      step: "input",
      message: "缺少或非法的 ticket 参数",
    });
  }

  const ticketTail = ticket.slice(-8);
  log("start", { ticketTail, return_path });

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

  // 1. 用 ticket 换取微信用户信息
  let hubRes: Response;
  try {
    hubRes = await fetch(HUB_EXCHANGE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket,
        client: "66cai",
        client_secret: HUB_SECRET,
      }),
    });
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
    keys:
      hubBody && typeof hubBody === "object" ? Object.keys(hubBody) : null,
    rawPreview: !hubBody ? raw?.slice(0, 200) : null,
  });

  if (!hubRes.ok) {
    const errcode = hubBody?.error ?? hubBody?.errcode ?? hubRes.status;
    const errmsg =
      hubBody?.message ?? hubBody?.errmsg ?? raw?.slice(0, 200) ?? "exchange_failed";
    logErr("hub.exchange", { ticketTail, errcode, errmsg });
    return jsonResponse(400, {
      step: "hub.exchange",
      message: `微信登录失败: ${errmsg}`,
      errcode,
      errmsg,
      raw: hubBody ?? raw,
    });
  }

  const wxUser = (hubBody?.user ?? hubBody) as {
    openid?: string;
    unionid?: string | null;
    nickname?: string | null;
    avatar?: string | null;
  };

  if (!wxUser?.openid) {
    logErr("hub.payload", { ticketTail, payload: hubBody });
    return jsonResponse(400, {
      step: "hub.payload",
      message: "微信返回数据缺少 openid",
      raw: hubBody,
    });
  }

  const openidTail = wxUser.openid.slice(-6);
  log("hub.user", {
    openidTail,
    hasUnionid: !!wxUser.unionid,
    hasNickname: !!wxUser.nickname,
  });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. 查找已绑定的 user
  const { data: existingUid, error: findErr } = await supabaseAdmin.rpc(
    "find_user_by_wechat",
    { _openid: wxUser.openid, _unionid: wxUser.unionid ?? "" } as any,
  );
  if (findErr) {
    logErr("rpc.find_user_by_wechat", {
      openidTail,
      message: findErr.message,
      code: (findErr as any).code,
    });
    return jsonResponse(500, {
      step: "rpc.find_user_by_wechat",
      message: `查找用户失败: ${findErr.message}`,
      errmsg: findErr.message,
    });
  }

  let userId = existingUid as string | null;
  log("user.match", { openidTail, matched: !!userId });

  // 3. 不存在则创建
  if (!userId) {
    const syntheticEmail = `wx_${wxUser.openid}@wechat.local`;
    const { data: created, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: {
          nickname: wxUser.nickname ?? "微信用户",
          avatar_url: wxUser.avatar,
          login_provider: "wechat",
        },
      });
    if (createErr || !created.user) {
      logErr("auth.createUser", {
        openidTail,
        message: createErr?.message,
        status: (createErr as any)?.status,
      });
      return jsonResponse(500, {
        step: "auth.createUser",
        message: `创建用户失败: ${createErr?.message ?? "unknown"}`,
        errmsg: createErr?.message ?? null,
      });
    }
    userId = created.user.id;
    log("auth.created", { openidTail, userId });
  }

  // 4. 回填 profile
  const { error: bindErr } = await supabaseAdmin.rpc(
    "bind_wechat_to_profile",
    {
      _user_id: userId,
      _openid: wxUser.openid,
      _unionid: wxUser.unionid ?? "",
      _nickname: wxUser.nickname ?? "",
      _avatar: wxUser.avatar ?? "",
    } as any,
  );
  if (bindErr) {
    logErr("rpc.bind_wechat_to_profile", {
      userId,
      openidTail,
      message: bindErr.message,
    });
    // 不阻塞登录
  } else {
    log("profile.bound", { userId, openidTail });
  }

  // 5. 获取 email 并签发 magiclink
  const { data: userInfo, error: getErr } =
    await supabaseAdmin.auth.admin.getUserById(userId!);
  if (getErr || !userInfo.user?.email) {
    logErr("auth.getUserById", {
      userId,
      message: getErr?.message,
      hasEmail: !!userInfo?.user?.email,
    });
    return jsonResponse(500, {
      step: "auth.getUserById",
      message: `无法读取用户信息: ${getErr?.message ?? "no email"}`,
    });
  }

  const { data: linkData, error: linkErr } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: userInfo.user.email,
    });
  if (linkErr || !linkData.properties?.hashed_token) {
    logErr("auth.generateLink", {
      userId,
      message: linkErr?.message,
    });
    return jsonResponse(500, {
      step: "auth.generateLink",
      message: `签发登录令牌失败: ${linkErr?.message ?? "unknown"}`,
      errmsg: linkErr?.message ?? null,
    });
  }

  const safeRedirect =
    return_path && return_path.startsWith("/") && !return_path.startsWith("//")
      ? return_path
      : "/";

  log("done", {
    userId,
    openidTail,
    ms: Date.now() - t0,
    redirectTo: safeRedirect,
  });

  return jsonResponse(200, {
    success: true,
    tokenHash: linkData.properties.hashed_token,
    email: userInfo.user.email,
    redirectTo: safeRedirect,
  });
});
