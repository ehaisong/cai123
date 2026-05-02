import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HUB_EXCHANGE = "https://wx.lovclaw.com/api/public/oauth/wechat/exchange";

interface HubUser {
  openid: string;
  unionid: string | null;
  nickname: string | null;
  avatar: string | null;
}

/** 结构化日志，统一前缀方便在 worker logs 中过滤 */
function logStep(step: string, info: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.log(`[wechat-login] ${step}`, JSON.stringify(info));
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[wechat-login] ${step}`, info);
  }
}

function logError(step: string, info: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.error(`[wechat-login:ERR] ${step}`, JSON.stringify(info));
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[wechat-login:ERR] ${step}`, info);
  }
}

/** 自定义错误：把 errcode / errmsg / step / raw 一起透出到前端 */
class WechatLoginError extends Error {
  step: string;
  errcode: string | number | null;
  errmsg: string | null;
  raw: unknown;
  constructor(opts: {
    step: string;
    message: string;
    errcode?: string | number | null;
    errmsg?: string | null;
    raw?: unknown;
  }) {
    // message 形如 "[step][code] errmsg"
    const code = opts.errcode != null ? `[${opts.errcode}]` : "";
    super(`[${opts.step}]${code} ${opts.message}`);
    this.name = "WechatLoginError";
    this.step = opts.step;
    this.errcode = opts.errcode ?? null;
    this.errmsg = opts.errmsg ?? null;
    this.raw = opts.raw;
  }
}

/**
 * 用 ticket 与中转站换微信用户信息，并在本站完成 Supabase Auth 登录。
 * 返回前端可直接用 verifyOtp 消费的 token_hash。
 */
export const exchangeWechatTicket = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        ticket: z.string().min(20).max(200),
        return_path: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const t0 = Date.now();
    const ticketTail = data.ticket.slice(-8);
    logStep("start", { ticketTail, return_path: data.return_path });

    const secret = process.env.WECHAT_HUB_SECRET;
    if (!secret) {
      logError("config", { reason: "missing WECHAT_HUB_SECRET" });
      throw new WechatLoginError({
        step: "config",
        message: "服务端未配置 WECHAT_HUB_SECRET",
      });
    }

    // 1. 用 ticket 换微信用户信息
    let res: Response;
    try {
      res = await fetch(HUB_EXCHANGE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: data.ticket,
          client: "66cai",
          client_secret: secret,
        }),
      });
    } catch (e: any) {
      logError("hub.fetch", { ticketTail, error: e?.message });
      throw new WechatLoginError({
        step: "hub.fetch",
        message: `中转站请求失败: ${e?.message ?? "network error"}`,
        raw: { error: e?.message },
      });
    }

    const raw = await res.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // ignore
    }

    logStep("hub.response", {
      ticketTail,
      status: res.status,
      ok: res.ok,
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : null,
      rawPreview: !payload ? raw?.slice(0, 200) : null,
    });

    if (!res.ok) {
      const errcode = payload?.error ?? payload?.errcode ?? res.status;
      const errmsg =
        payload?.message ?? payload?.errmsg ?? raw?.slice(0, 200) ?? "exchange_failed";
      logError("hub.exchange", { ticketTail, errcode, errmsg, payload });
      throw new WechatLoginError({
        step: "hub.exchange",
        message: `微信登录失败: ${errmsg}`,
        errcode,
        errmsg,
        raw: payload ?? raw,
      });
    }

    // 兼容两种返回结构：{ user: {...} } 或顶层即用户
    const wxUser = (payload?.user ?? payload) as HubUser;

    if (!wxUser?.openid) {
      logError("hub.payload", { ticketTail, payload });
      throw new WechatLoginError({
        step: "hub.payload",
        message: "微信返回数据缺少 openid",
        raw: payload,
      });
    }

    const openidTail = wxUser.openid.slice(-6);
    logStep("hub.user", {
      openidTail,
      hasUnionid: !!wxUser.unionid,
      hasNickname: !!wxUser.nickname,
      hasAvatar: !!wxUser.avatar,
    });

    // 2. 通过 unionid/openid 查找已绑定的用户
    const { data: existingUid, error: findErr } = await supabaseAdmin.rpc(
      "find_user_by_wechat",
      {
        _openid: wxUser.openid,
        _unionid: wxUser.unionid ?? "",
      } as any,
    );
    if (findErr) {
      logError("rpc.find_user_by_wechat", {
        openidTail,
        message: findErr.message,
        code: (findErr as any).code,
        details: (findErr as any).details,
      });
      throw new WechatLoginError({
        step: "rpc.find_user_by_wechat",
        message: `查找用户失败: ${findErr.message}`,
        errcode: (findErr as any).code ?? null,
        errmsg: findErr.message,
        raw: findErr,
      });
    }

    let userId = existingUid as string | null;
    logStep("user.match", { openidTail, matched: !!userId });

    // 3. 不存在则在 auth.users 创建一个新用户（使用合成邮箱占位，禁用密码登录）
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
        logError("auth.createUser", {
          openidTail,
          message: createErr?.message,
          status: (createErr as any)?.status,
        });
        throw new WechatLoginError({
          step: "auth.createUser",
          message: `创建用户失败: ${createErr?.message ?? "unknown"}`,
          errcode: (createErr as any)?.status ?? null,
          errmsg: createErr?.message ?? null,
          raw: createErr,
        });
      }
      userId = created.user.id;
      logStep("auth.created", { openidTail, userId });
    }

    // 4. 把微信信息回填到 profile（含首次绑定）
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
      // 绑定失败不阻塞登录，但记录详细日志
      logError("rpc.bind_wechat_to_profile", {
        userId,
        openidTail,
        message: bindErr.message,
        code: (bindErr as any).code,
        details: (bindErr as any).details,
      });
    } else {
      logStep("profile.bound", { userId, openidTail });
    }

    // 5. 拿到该用户的邮箱，签发 magiclink，提取 token_hash 给前端 verifyOtp 消费
    const { data: userInfo, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (getErr || !userInfo.user?.email) {
      logError("auth.getUserById", {
        userId,
        message: getErr?.message,
        hasEmail: !!userInfo?.user?.email,
      });
      throw new WechatLoginError({
        step: "auth.getUserById",
        message: `无法读取用户信息: ${getErr?.message ?? "no email"}`,
        errmsg: getErr?.message ?? null,
        raw: getErr,
      });
    }

    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: userInfo.user.email,
      });
    if (linkErr || !linkData.properties?.hashed_token) {
      logError("auth.generateLink", {
        userId,
        message: linkErr?.message,
        hasHashedToken: !!linkData?.properties?.hashed_token,
      });
      throw new WechatLoginError({
        step: "auth.generateLink",
        message: `签发登录令牌失败: ${linkErr?.message ?? "unknown"}`,
        errmsg: linkErr?.message ?? null,
        raw: linkErr,
      });
    }

    const safeRedirect =
      data.return_path && data.return_path.startsWith("/") && !data.return_path.startsWith("//")
        ? data.return_path
        : "/";

    logStep("done", {
      userId,
      openidTail,
      ms: Date.now() - t0,
      redirectTo: safeRedirect,
    });

    return {
      success: true as const,
      tokenHash: linkData.properties.hashed_token,
      email: userInfo.user.email,
      redirectTo: safeRedirect,
    };
  });
