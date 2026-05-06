// Idempotent admin seeder: phone 13877678808 / password 123456.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PHONE = "13877678808";
const PASSWORD = "123456";
const EMAIL = `${PHONE}@phone.local`;

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Find or create user
    let userId: string | null = null;
    const { data: foundId } = await admin.rpc("find_user_by_phone", { _phone: PHONE });
    if (foundId) {
      userId = foundId as string;
      const { error: uerr } = await admin.auth.admin.updateUserById(userId, {
        phone: PHONE, password: PASSWORD, phone_confirm: true, email: EMAIL, email_confirm: true,
      });
      if (uerr) throw new Error("updateUser: " + uerr.message);
    } else {
      const { data: created, error: cerr } = await admin.auth.admin.createUser({
        phone: PHONE, password: PASSWORD, phone_confirm: true,
        email: EMAIL, email_confirm: true,
      });
      if (cerr || !created.user) throw new Error("createUser: " + (cerr?.message ?? "unknown"));
      userId = created.user.id;
    }

    // 2. Grant admin role
    await admin.from("user_roles").upsert(
      { user_id: userId, role: "admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    // 3. Ensure profile phone
    await admin.from("profiles").update({ phone: PHONE }).eq("user_id", userId);

    return j({ ok: true, user_id: userId, phone: PHONE });
  } catch (e) {
    return j({ ok: false, message: (e as Error).message }, 500);
  }
});
