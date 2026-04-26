import { supabase } from "@/integrations/supabase/client";

// 临时 Demo 用户，方便设计期免登录跳过流程。
// 后续接入微信扫码登录后可移除此文件。
export const DEMO_NICKNAME = "Demo 体验账号";

/**
 * 以 Demo 账号登录。账号由后端安全创建并确认，避免设计期被邮箱校验/确认邮件阻断。
 * 返回登录后的 user，失败抛错。
 */
export async function signInAsDemo() {
  const { data, error } = await supabase.functions.invoke("demo-login", { method: "POST" });
  if (error) throw error;
  if (!data?.session?.access_token || !data?.session?.refresh_token) {
    throw new Error("Demo 登录服务未返回有效会话");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError) throw sessionError;
  return sessionData.user!;
}
