// Seed/reset DEMO merchant: phone+password login, default shop, role.
// Idempotent. Call with POST (no body required).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MERCHANT_ID = "b36f6413-2d03-47ee-83b9-9794f3cefdee";
const USER_ID = "725b6638-0d75-4c10-86a7-d210cd934834";
const PHONE = "15120857030";
const PASSWORD = "123456";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Update auth user: set phone + password, confirm phone
    const { error: uerr } = await admin.auth.admin.updateUserById(USER_ID, {
      phone: PHONE,
      password: PASSWORD,
      phone_confirm: true,
    });
    if (uerr) throw new Error("updateUser: " + uerr.message);

    // 2. Update merchant
    const { error: merr } = await admin.from("merchants").update({
      shop_name: "DEMO 测试店铺",
      shop_description: "平台演示店铺，用于功能测试。手机号 15120857030 / 密码 123456",
      status: "approved",
      is_disabled: false,
    }).eq("id", MERCHANT_ID);
    if (merr) throw new Error("merchants: " + merr.message);

    // 3. Ensure merchant role
    await admin.from("user_roles").upsert(
      { user_id: USER_ID, role: "merchant" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    // 4. Profile phone sync
    await admin.from("profiles").update({ phone: PHONE }).eq("user_id", USER_ID);

    // 5. Default shop setting
    const { error: serr } = await admin.from("app_settings").upsert(
      { key: "default_shop_id", value: MERCHANT_ID, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (serr) throw new Error("app_settings: " + serr.message);

    return new Response(JSON.stringify({ ok: true, merchant_id: MERCHANT_ID, phone: PHONE }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
