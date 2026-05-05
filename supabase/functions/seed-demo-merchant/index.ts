// Seed/reset DEMO merchant: phone+password login, default shop, role, and demo products.
// Idempotent. POST to invoke.
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
const FC3D = "64760bce-a5e1-47cc-9d5f-e887bb51f582";
const LHC = "cd1483ee-8714-40a7-bb8b-1e1ef06c6efa";
const FC = "e8914fcd-9abf-40a4-91da-386bc3f41b0f";

type Item = {
  types: string[]; cat: string; issue: string; title: string; tags: string[];
  streak: number; rec: boolean; price: number; paid: string;
  refund?: boolean; presale?: boolean;
};

const ITEMS: Item[] = [
  // 3D x6
  { types:['3D'], cat:FC3D, issue:'2026111', title:'111期【白斩鸡】福+体通用单挑一注直组包含三码全定位复试 🔥🔥', tags:['3连红','中单挑'], streak:3, rec:true, price:8,
    paid:'111期【白斩鸡】福+体通用单挑一注直组包含三码全定位复试🔥不断更 已更新\n108期【567】体开656✅\n109期【159】福开195✅\n110期【379】福开379✅\n111期【420】' },
  { types:['3D'], cat:FC3D, issue:'2026111', title:'111期【云南福家超市3D双独胆+双飞+四五六码】 🔥🔥', tags:[], streak:0, rec:false, price:6,
    paid:'111期 双独胆：4 7\n双飞：47 48 49\n四五六码复试：1 4 5 7 9 0\n单挑：877' },
  { types:['3D'], cat:FC3D, issue:'2026111', title:'111期【太保送票3D独胆一枚】 🔥🔥', tags:[], streak:0, rec:false, price:0,
    paid:'111期 独胆：5\n参考组合：5 8 9 / 5 0 7' },
  { types:['3D'], cat:FC3D, issue:'2026111', title:'111期【龙飞凤舞3D双胆+五码复试+单挑】 🔥🔥 2连红', tags:['2连红'], streak:2, rec:false, price:6,
    paid:'111期 双胆：3 7\n五码复试：1 3 5 7 9\n单挑：357' },
  { types:['3D'], cat:FC3D, issue:'2026111', title:'111期【强度双控3D四码+垂直二注】重销量第一 🔥', tags:[], streak:0, rec:false, price:8,
    paid:'111期 四码：0 2 5 9\n垂直一注：052\n垂直二注：259' },
  { types:['3D'], cat:FC3D, issue:'2026111', title:'111期【浪里白条3D四七码复式+垂点单挑】专业研究20年 🔥🔥', tags:[], streak:0, rec:false, price:0,
    paid:'111期 四码：1 3 7 9\n七码：0 1 3 5 7 8 9\n单挑：513' },
  // P3 x5
  { types:['P3'], cat:FC3D, issue:'2026111', title:'111期【口碑P3独胆+双飞】 🔥🔥 5连红', tags:['5连红'], streak:5, rec:true, price:6,
    paid:'111期 独胆：5\n双飞：53 56 58' },
  { types:['P3'], cat:FC3D, issue:'2026111', title:'111期【入梦P3独胆+双飞】 🔥🔥 6连红', tags:['6连红'], streak:6, rec:false, price:0,
    paid:'111期 独胆：8\n双飞：83 87 80' },
  { types:['P3'], cat:FC3D, issue:'2026111', title:'111期【名画P3独胆一枚】 🔥🔥 6连红', tags:['6连红'], streak:6, rec:false, price:0,
    paid:'111期 独胆：3' },
  { types:['P3'], cat:FC3D, issue:'2026111', title:'111期【韩剧P3独胆一枚】 🔥🔥 6连红', tags:['6连红'], streak:6, rec:false, price:0,
    paid:'111期 独胆：6' },
  { types:['P3'], cat:FC3D, issue:'2026111', title:'111期【冠盖P3独胆双星+六码+单挑2注】 🔥🔥', tags:[], streak:0, rec:false, price:0,
    paid:'111期 独胆：4\n双星：47\n六码：1 4 5 7 9 0\n单挑：479 / 471' },
  // P5 x4
  { types:['P5'], cat:FC3D, issue:'2026111', title:'111期【词神P5独胆一枚】 🔥', tags:['中单挑'], streak:0, rec:true, price:0,
    paid:'111期 独胆：2' },
  { types:['P5'], cat:FC3D, issue:'2026111', title:'111期【万家路福体四五七码复式+单挑4注】 🔥🔥', tags:[], streak:0, rec:false, price:8,
    paid:'111期 五码复式：1 4 5 7 8\n七码复式：0 1 4 5 7 8 9\n单挑：14578 / 14579 / 14587 / 14589' },
  { types:['P5'], cat:FC3D, issue:'2026111', title:'111期【万家灯火P5排五定位三码+五码】 🔥🔥', tags:['上期连开'], streak:0, rec:false, price:8,
    paid:'111期 定位三码：1 4 8\n五码：1 4 5 7 8' },
  { types:['P5'], cat:FC3D, issue:'2026111', title:'111期【许冠杰排五三+排五单挑3注】 🔥', tags:[], streak:0, rec:false, price:0,
    paid:'111期 排五：1 4 5 7 8\n单挑：14578 / 14587 / 14580' },
  // 3D+P3 x2
  { types:['3D','P3'], cat:FC3D, issue:'2026111', title:'111期【神雕侠侣福体大双飞+四六码+定位四码+单挑5注】 🔥🔥', tags:[], streak:0, rec:false, price:6,
    paid:'111期 大双飞：47 48 49 57 58\n四码：1 4 5 7\n六码：1 4 5 7 8 9\n单挑：145 / 147 / 148 / 157 / 158' },
  { types:['3D','P3'], cat:FC3D, issue:'2026111', title:'111期【超级玩家福体通用4码复试一注】 🔥', tags:['中单挑'], streak:0, rec:false, price:0,
    paid:'111期 四码复试：1 4 5 7' },
  // P3+P5 x1
  { types:['P3','P5'], cat:FC3D, issue:'2026111', title:'111期【黑龙江体排五三五码+排五单挑2注】 🔥🔥', tags:['中单挑'], streak:0, rec:false, price:10,
    paid:'111期 排五五码：1 4 5 7 8\n单挑：14578 / 14587' },
  // 球赛 x4
  { types:['球赛'], cat:FC, issue:'20260419', title:'【法老研球】👑【足球重磅单场】胜率top1 🏆 维罗纳vsAC米兰', tags:['心水'], streak:0, rec:true, price:68, refund:true,
    paid:'比赛：维罗纳 VS AC米兰\n开赛：21:00\n推荐：客胜\n本场信心：⭐⭐⭐⭐⭐' },
  { types:['球赛'], cat:FC, issue:'20260418', title:'【一手球员货】💥18:00 韩篮 釜山vs原州 没错就这单', tags:[], streak:0, rec:false, price:58, refund:true,
    paid:'比赛：釜山 VS 原州\n开赛：18:00\n推荐：让分主胜\n信心：⭐⭐⭐⭐' },
  { types:['球赛'], cat:FC, issue:'20260418', title:'【升班马一环球甄选】三月88.8%胜率，德乙0点30 海登海姆vs凯泽斯劳滕', tags:[], streak:0, rec:false, price:88, refund:true,
    paid:'比赛：海登海姆 VS 凯泽斯劳滕\n开赛：00:30\n推荐：主胜\n胜率参考：88.8%' },
  { types:['球赛'], cat:FC, issue:'20260417', title:'【超神聊球】👑葡超03:45里奥阿维vsAVS【主任盘】', tags:[], streak:0, rec:false, price:68, refund:true,
    paid:'比赛：里奥阿维 VS AVS\n开赛：03:45\n推荐：主胜或平' },
  // 其他/快乐8 x4
  { types:['其他'], cat:LHC, issue:'104', title:'104期【周天子快乐8 选十/选五/选三/选一】 🔥🔥【预售】', tags:[], streak:0, rec:false, price:0, presale:true,
    paid:'26104期 快乐8：\n选十：47 49 13 56 78 77 07 14 28 29\n选五：47 49 13 56 78\n选三：47 49 13\n选一：47' },
  { types:['其他'], cat:LHC, issue:'103', title:'103期【周天子快乐8 选十/选五/选三/选一】 🔥', tags:[], streak:0, rec:false, price:8,
    paid:'26103期 快乐8：\n选十：67 41 58 24 27 17 03 45 76 34\n选五：67 41 58 24 27\n选三：67 41 58\n选一：67' },
  { types:['其他'], cat:LHC, issue:'102', title:'102期【周天子快乐8 选十/选五/选三/选一】 🔥', tags:[], streak:0, rec:false, price:8,
    paid:'26102期 快乐8：\n选十：12 35 47 68 09 22 31 44 55 66\n选五：12 35 47 68 09\n选三：12 35 47\n选一：35' },
  { types:['其他'], cat:LHC, issue:'101', title:'101期【周天子快乐8 选十/选五/选三/选一】 🔥', tags:[], streak:0, rec:false, price:8,
    paid:'26101期 快乐8：\n选十：05 11 23 38 41 52 64 70 78 89\n选五：05 11 23 38 41\n选三：05 11 23\n选一：23' },
];

const INTRO = '本站资料仅供参考，不代表平台建议，不保证连续性，不做任何承诺。';
const DISCLAIMER = '此料任何情况下都不退款，请知悉。所有图片、文字仅供参考。';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Auth user
    const { error: uerr } = await admin.auth.admin.updateUserById(USER_ID, {
      phone: PHONE, password: PASSWORD, phone_confirm: true,
    });
    if (uerr) throw new Error("updateUser: " + uerr.message);

    // 2. Merchant
    await admin.from("merchants").update({
      shop_name: "DEMO 测试店铺",
      shop_description: "平台演示店铺，用于功能测试。商家手机号 15120857030 / 密码 123456",
      status: "approved", is_disabled: false,
    }).eq("id", MERCHANT_ID);

    // 3. Role
    await admin.from("user_roles").upsert(
      { user_id: USER_ID, role: "merchant" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    // 4. Profile phone
    await admin.from("profiles").update({ phone: PHONE }).eq("user_id", USER_ID);

    // 5. Default shop
    await admin.from("app_settings").upsert(
      { key: "default_shop_id", value: MERCHANT_ID, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    // 6. Wipe + reseed products
    const { data: existing } = await admin.from("products").select("id").eq("merchant_id", MERCHANT_ID);
    if (existing?.length) {
      const ids = existing.map((r: any) => r.id);
      await admin.from("product_issues").delete().in("product_id", ids);
      await admin.from("products").delete().in("id", ids);
    }

    const now = Date.now();
    let inserted = 0;
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const publishAt = new Date(now - (i % 11) * 86400000 - i * 13 * 60000).toISOString();
      const { data: prod, error: perr } = await admin.from("products").insert({
        merchant_id: MERCHANT_ID,
        category_id: it.cat,
        kind: "single",
        title: it.title,
        types: it.types,
        tags: it.tags,
        streak: it.streak,
        is_presale: it.presale ?? false,
        is_recommended: it.rec,
        intro: INTRO,
        paid_content: it.paid,
        price: it.price,
        no_win_refund: it.refund ?? false,
        has_self_issue: true,
        issue_no: it.issue,
        publish_at: publishAt,
        status: "published",
        disclaimer: DISCLAIMER,
      }).select("id").single();
      if (perr) throw new Error(`product[${i}]: ${perr.message}`);
      await admin.from("product_issues").insert({
        product_id: prod!.id,
        issue_no: it.issue,
        paid_content: it.paid,
        publish_at: publishAt,
        status: "published",
      });
      inserted++;
    }

    return new Response(JSON.stringify({
      ok: true, merchant_id: MERCHANT_ID, phone: PHONE, products_inserted: inserted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
