import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEMO_EMAIL = "hxxgo.demo@gmail.com";
const DEMO_PASSWORD = "demo-pass-2026!";
const DEMO_NICKNAME = "Demo 体验账号";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Demo 登录服务未配置完成");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError) throw usersError;

    let demoUser = usersData.users.find((user) => user.email?.toLowerCase() === DEMO_EMAIL);

    if (!demoUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { nickname: DEMO_NICKNAME },
      });
      if (error) throw error;
      demoUser = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(demoUser.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { ...(demoUser.user_metadata ?? {}), nickname: DEMO_NICKNAME },
      });
      if (error) throw error;
      demoUser = data.user;
    }

    const userCode = `demo${demoUser.id.slice(0, 8)}`;
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("user_id", demoUser.id)
      .maybeSingle();

    if (!existingProfile) {
      await admin.from("profiles").insert({
        user_id: demoUser.id,
        user_code: userCode,
        nickname: DEMO_NICKNAME,
      });
    }

    const { data: existingWallet } = await admin
      .from("wallets")
      .select("id")
      .eq("user_id", demoUser.id)
      .maybeSingle();
    if (!existingWallet) await admin.from("wallets").insert({ user_id: demoUser.id });

    const { data: existingRole } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", demoUser.id)
      .eq("role", "buyer")
      .maybeSingle();
    if (!existingRole) await admin.from("user_roles").insert({ user_id: demoUser.id, role: "buyer" });

    const { data: existingRelation } = await admin
      .from("agent_relations")
      .select("id")
      .eq("user_id", demoUser.id)
      .maybeSingle();
    if (!existingRelation) await admin.from("agent_relations").insert({ user_id: demoUser.id });

    const { data: sessionData, error: signInError } = await admin.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    });
    if (signInError) throw signInError;

    return new Response(JSON.stringify({ session: sessionData.session }), {
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