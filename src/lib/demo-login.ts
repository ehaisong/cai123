import { supabase } from "@/integrations/supabase/client";

export type DemoRole = "admin" | "merchant" | "agent" | "buyer";

export const DEMO_ROLE_OPTIONS: { role: DemoRole; label: string; desc: string }[] = [
  { role: "admin", label: "商城管理", desc: "进入管理后台，审核商家与提现" },
  { role: "merchant", label: "商家账号", desc: "发布商品、查看销量与佣金" },
  { role: "agent", label: "代理账号", desc: "推广分销、查看分成与提现" },
  { role: "buyer", label: "普通用户", desc: "浏览商品、下单与查看订单" },
];

/**
 * 以指定角色的 Demo 账号登录。
 */
export async function signInAsDemo(role: DemoRole = "buyer") {
  const { data, error } = await supabase.functions.invoke("demo-login", {
    method: "POST",
    body: { role },
  });
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
