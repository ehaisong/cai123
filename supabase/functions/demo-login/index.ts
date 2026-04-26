import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DemoRole = "admin" | "merchant" | "agent" | "buyer";

const DEMO_PASSWORD = "demo-pass-2026!";

const DEMO_ACCOUNTS: Record<DemoRole, { email: string; nickname: string; userCodePrefix: string }> = {
  admin: { email: "demo.admin@hxxgo.test", nickname: "Demo 管理员", userCodePrefix: "admin" },
  merchant: { email: "demo.merchant@hxxgo.test", nickname: "Demo 商家", userCodePrefix: "merch" },
  agent: { email: "demo.agent@hxxgo.test", nickname: "Demo 代理", userCodePrefix: "agent" },
  buyer: { email: "demo.buyer@hxxgo.test", nickname: "Demo 普通用户", userCodePrefix: "buyer" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Demo 登录服务未配置完成");

    const body = await req.json().catch(() => ({}));
    const role = (body?.role as DemoRole) || "buyer";
    if (!DEMO_ACCOUNTS[role]) throw new Error("无效的 Demo 角色");
    const account = DEMO_ACCOUNTS[role];

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 找用户或创建
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;

    let demoUser = usersData.users.find((u) => u.email?.toLowerCase() === account.email);
    if (!demoUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { nickname: account.nickname },
      });
      if (error) throw error;
      demoUser = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(demoUser.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { ...(demoUser.user_metadata ?? {}), nickname: account.nickname },
      });
      if (error) throw error;
      demoUser = data.user;
    }

    const userId = demoUser.id;
    const userCode = `${account.userCodePrefix}${userId.slice(0, 6)}`;

    // profiles
    const { data: existingProfile } = await admin
      .from("profiles").select("id, user_code").eq("user_id", userId).maybeSingle();
    if (!existingProfile) {
      await admin.from("profiles").insert({ user_id: userId, user_code: userCode, nickname: account.nickname });
    } else {
      await admin.from("profiles").update({ nickname: account.nickname }).eq("user_id", userId);
    }

    // wallets
    const { data: existingWallet } = await admin.from("wallets").select("id").eq("user_id", userId).maybeSingle();
    if (!existingWallet) await admin.from("wallets").insert({ user_id: userId });

    // agent_relations
    const { data: existingRelation } = await admin.from("agent_relations").select("id").eq("user_id", userId).maybeSingle();
    if (!existingRelation) await admin.from("agent_relations").insert({ user_id: userId });

    // 角色配置
    const rolesToAssign: string[] = ["buyer"];
    if (role === "admin") rolesToAssign.push("admin");
    if (role === "merchant") rolesToAssign.push("merchant");
    if (role === "agent") rolesToAssign.push("agent");

    for (const r of rolesToAssign) {
      const { data: er } = await admin.from("user_roles").select("id").eq("user_id", userId).eq("role", r).maybeSingle();
      if (!er) await admin.from("user_roles").insert({ user_id: userId, role: r });
    }

    // 角色专属：商家
    if (role === "merchant") {
      const { data: existingMerchant } = await admin
        .from("merchants").select("id").eq("user_id", userId).maybeSingle();
      if (!existingMerchant) {
        await admin.from("merchants").insert({
          user_id: userId,
          shop_name: "Demo 演示店铺",
          shop_description: "这是用于演示的商家账号",
          status: "approved",
          real_name: "Demo 商家",
        });
      }
    }

    // 角色专属：代理（设置 agent_code）
    if (role === "agent") {
      await admin.from("agent_relations").update({
        is_agent: true,
        agent_code: userCode,
      }).eq("user_id", userId);
    }

    // 登录获取 session
    const { data: sessionData, error: signInError } = await admin.auth.signInWithPassword({
      email: account.email,
      password: DEMO_PASSWORD,
    });
    if (signInError) throw signInError;

    return new Response(JSON.stringify({ session: sessionData.session, role }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo 登录失败";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
