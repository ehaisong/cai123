import { supabase } from "@/integrations/supabase/client";

// 临时 Demo 用户，方便设计期免登录跳过流程。
// 后续接入微信扫码登录后可移除此文件。
export const DEMO_EMAIL = "demo@hxxgo.com";
export const DEMO_PASSWORD = "demo-pass-2026!";
export const DEMO_NICKNAME = "Demo 体验账号";

/**
 * 以 Demo 账号登录。如果账号不存在则先注册再登录。
 * 返回登录后的 user，失败抛错。
 */
export async function signInAsDemo() {
  // 先尝试直接登录
  const first = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (!first.error && first.data.user) return first.data.user;

  // 登录失败 -> 尝试注册（首次使用的情况）
  const signUp = await supabase.auth.signUp({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    options: {
      data: { nickname: DEMO_NICKNAME },
      emailRedirectTo: `${window.location.origin}/`,
    },
  });
  if (signUp.error) {
    // 已存在但密码错 / 其它错误，把原始登录错误抛出更直观
    throw first.error ?? signUp.error;
  }
  // 部分项目开启了邮箱确认，这里再尝试一次登录以确保拿到 session
  const second = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (second.error) throw second.error;
  return second.data.user!;
}
