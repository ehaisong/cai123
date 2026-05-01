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
    const secret = process.env.WECHAT_HUB_SECRET;
    if (!secret) throw new Error("服务端未配置 WECHAT_HUB_SECRET");

    // 1. 用 ticket 换微信用户信息
    const res = await fetch(HUB_EXCHANGE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket: data.ticket,
        client: "66cai",
        client_secret: secret,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "exchange_failed" }));
      throw new Error(`微信登录失败: ${err.error ?? res.status}`);
    }

    const wxUser = (await res.json()) as HubUser;

    if (!wxUser.openid) {
      throw new Error("微信返回数据缺少 openid");
    }

    // 2. 通过 unionid/openid 查找已绑定的用户
    const { data: existingUid, error: findErr } = await supabaseAdmin.rpc(
      "find_user_by_wechat",
      {
        _openid: wxUser.openid,
        _unionid: wxUser.unionid,
      },
    );
    if (findErr) throw new Error(`查找用户失败: ${findErr.message}`);

    let userId = existingUid as string | null;

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
        throw new Error(`创建用户失败: ${createErr?.message ?? "unknown"}`);
      }
      userId = created.user.id;
    }

    // 4. 把微信信息回填到 profile（含首次绑定）
    const { error: bindErr } = await supabaseAdmin.rpc(
      "bind_wechat_to_profile",
      {
        _user_id: userId,
        _openid: wxUser.openid,
        _unionid: wxUser.unionid,
        _nickname: wxUser.nickname,
        _avatar: wxUser.avatar,
      },
    );
    if (bindErr) {
      console.error("bind_wechat_to_profile failed", bindErr);
    }

    // 5. 拿到该用户的邮箱，签发 magiclink，提取 token_hash 给前端 verifyOtp 消费
    const { data: userInfo, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (getErr || !userInfo.user?.email) {
      throw new Error("无法读取用户信息");
    }

    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: userInfo.user.email,
      });
    if (linkErr || !linkData.properties?.hashed_token) {
      throw new Error(`签发登录令牌失败: ${linkErr?.message ?? "unknown"}`);
    }

    const safeRedirect =
      data.return_path && data.return_path.startsWith("/") && !data.return_path.startsWith("//")
        ? data.return_path
        : "/";

    return {
      success: true as const,
      tokenHash: linkData.properties.hashed_token,
      email: userInfo.user.email,
      redirectTo: safeRedirect,
    };
  });
