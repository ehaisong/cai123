// @ts-nocheck
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

    // 使用 any 规避 supabase-js 在 Deno 下的复杂泛型推断
    const admin: any = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. 确保所有 4 个 demo 账号都存在（这样种子数据可以连成链）
    const allUserIds = await ensureAllDemoUsers(admin);

    // 2. 为每个 demo 账号补齐 profile / wallet / agent_relation / role
    await ensureProfileSetup(admin, allUserIds);

    // 3. 建立分成链：buyer 的上级是 agent，agent 的 bound_merchant 是 merchant
    await ensureAgentChain(admin, allUserIds);

    // 4. 商家发布若干商品 + 历史开奖
    await ensureMerchantProducts(admin, allUserIds.merchant);

    // 5. 买家充值（首次）+ 自动购买若干商品产生佣金流水
    await ensureBuyerOrders(admin, allUserIds);

    const userId = allUserIds[role];

    // 登录获取 session
    const { data: sessionData, error: signInError } = await admin.auth.signInWithPassword({
      email: account.email,
      password: DEMO_PASSWORD,
    });
    if (signInError) throw signInError;

    return new Response(JSON.stringify({ session: sessionData.session, role, userId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo 登录失败";
    console.error("[demo-login] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---------- helpers ----------
// 使用 any 规避 supabase-js 在 Deno 下的复杂泛型推断

async function ensureAllDemoUsers(admin: any) {
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;

  const ids: Record<DemoRole, string> = {} as Record<DemoRole, string>;
  for (const r of Object.keys(DEMO_ACCOUNTS) as DemoRole[]) {
    const acc = DEMO_ACCOUNTS[r];
    let u = usersData.users.find((x) => x.email?.toLowerCase() === acc.email);
    if (!u) {
      const { data, error } = await admin.auth.admin.createUser({
        email: acc.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { nickname: acc.nickname },
      });
      if (error) throw error;
      u = data.user!;
    } else {
      // 重置密码确保可登录
      await admin.auth.admin.updateUserById(u.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { ...(u.user_metadata ?? {}), nickname: acc.nickname },
      });
    }
    ids[r] = u.id;
  }
  return ids;
}

async function ensureProfileSetup(
  admin: ReturnType<typeof createClient>,
  ids: Record<DemoRole, string>,
) {
  for (const r of Object.keys(DEMO_ACCOUNTS) as DemoRole[]) {
    const userId = ids[r];
    const acc = DEMO_ACCOUNTS[r];
    const userCode = `${acc.userCodePrefix}${userId.slice(0, 6)}`;

    const { data: p } = await admin.from("profiles").select("id, user_code").eq("user_id", userId).maybeSingle();
    if (!p) {
      await admin.from("profiles").insert({ user_id: userId, user_code: userCode, nickname: acc.nickname });
    } else {
      await admin.from("profiles").update({ nickname: acc.nickname }).eq("user_id", userId);
    }

    const { data: w } = await admin.from("wallets").select("id").eq("user_id", userId).maybeSingle();
    if (!w) await admin.from("wallets").insert({ user_id: userId });

    const { data: ar } = await admin.from("agent_relations").select("id").eq("user_id", userId).maybeSingle();
    if (!ar) await admin.from("agent_relations").insert({ user_id: userId });

    const rolesToAssign: string[] = ["buyer"];
    if (r === "admin") rolesToAssign.push("admin");
    if (r === "merchant") rolesToAssign.push("merchant");
    if (r === "agent") rolesToAssign.push("agent");
    for (const role of rolesToAssign) {
      const { data: er } = await admin.from("user_roles").select("id").eq("user_id", userId).eq("role", role).maybeSingle();
      if (!er) await admin.from("user_roles").insert({ user_id: userId, role });
    }
  }

  // 商家专属
  const merchantId = ids.merchant;
  const { data: existingMerchant } = await admin.from("merchants").select("id").eq("user_id", merchantId).maybeSingle();
  if (!existingMerchant) {
    await admin.from("merchants").insert({
      user_id: merchantId,
      shop_name: "Demo 演示店铺",
      shop_description: "用于 Demo 体验的官方演示店铺，含多款示例商品",
      status: "approved",
      real_name: "Demo 商家",
    });
  } else {
    await admin.from("merchants").update({ status: "approved" }).eq("user_id", merchantId);
  }
}

async function ensureAgentChain(
  admin: ReturnType<typeof createClient>,
  ids: Record<DemoRole, string>,
) {
  // agent 设置为 is_agent + agent_code
  const { data: agentProfile } = await admin
    .from("profiles").select("id, user_code").eq("user_id", ids.agent).maybeSingle();
  if (!agentProfile) return;

  await admin.from("agent_relations").update({
    is_agent: true,
    agent_code: agentProfile.user_code,
  }).eq("user_id", ids.agent);

  // 拿到商家 id
  const { data: merchantRow } = await admin
    .from("merchants").select("id").eq("user_id", ids.merchant).maybeSingle();

  // buyer 的 upline 设置为 agent profile id；bound_merchant_id = merchant.id
  const { data: buyerRel } = await admin
    .from("agent_relations").select("upline_id").eq("user_id", ids.buyer).maybeSingle();
  if (buyerRel && !buyerRel.upline_id) {
    await admin.from("agent_relations").update({
      upline_id: agentProfile.id,
      bound_merchant_id: merchantRow?.id ?? null,
    }).eq("user_id", ids.buyer);
    await admin.from("profiles").update({ referrer_id: agentProfile.id }).eq("user_id", ids.buyer);
  }
}

async function ensureMerchantProducts(
  admin: ReturnType<typeof createClient>,
  merchantUserId: string,
) {
  const { data: merchantRow } = await admin
    .from("merchants").select("id").eq("user_id", merchantUserId).maybeSingle();
  if (!merchantRow) return;

  const { data: cats } = await admin.from("lottery_categories").select("id, code, name").order("sort_order");
  if (!cats || cats.length === 0) return;

  const seedProducts = [
    {
      key: "demo-fc3d-001",
      categoryCode: "fc3d",
      title: "【独胆精选】福彩3D 今日内部参考",
      subtitle: "资深分析师独家整理，胆码 + 杀号一站式参考",
      issue_no: "2026001",
      price: 18.0,
      paid_content: "独胆推荐：5\n双胆推荐：5、7\n杀号：0、9\n复式参考：5 7 / 1 3 6 / 2 4 8",
      disclaimer: "仅供参考，购彩有风险，理性购彩。",
    },
    {
      key: "demo-fc3d-002",
      categoryCode: "fc3d",
      title: "【组三组六】福彩3D 形态预测",
      subtitle: "基于近 30 期形态走势的精准预判",
      issue_no: "2026002",
      price: 12.0,
      paid_content: "形态预测：组六\n推荐号码：2 4 7\n备选号码：1 3 8",
      disclaimer: "仅供参考，购彩有风险，理性购彩。",
    },
    {
      key: "demo-lhc-001",
      categoryCode: "lhc",
      title: "【生肖分析】六合彩 本期生肖参考",
      subtitle: "本期主推生肖 + 备选号码",
      issue_no: "2026003",
      price: 28.0,
      paid_content: "主推生肖：龙\n备选生肖：蛇、鸡\n推荐号码：05 17 29 41",
      disclaimer: "仅供参考，购彩有风险，理性购彩。",
    },
    {
      key: "demo-fc-001",
      categoryCode: "fc",
      title: "【足彩周末】竞彩 5 场精选推荐",
      subtitle: "本周末 5 场重点赛事胜平负推荐",
      issue_no: "2026004",
      price: 38.0,
      paid_content: "曼城 vs 阿森纳：让球胜\n皇马 vs 巴萨：平\n拜仁 vs 多特：主胜\n国米 vs AC米兰：客胜\n巴黎 vs 里昂：主胜",
      disclaimer: "仅供参考，理性投注。",
    },
  ];

  for (const sp of seedProducts) {
    const cat = cats.find((c) => c.code === sp.categoryCode) ?? cats[0];
    // 用 (merchant_id, issue_no, title) 简单去重
    const { data: exist } = await admin
      .from("products").select("id")
      .eq("merchant_id", merchantRow.id)
      .eq("title", sp.title)
      .maybeSingle();
    if (exist) continue;

    const { data: inserted } = await admin.from("products").insert({
      merchant_id: merchantRow.id,
      category_id: cat.id,
      title: sp.title,
      subtitle: sp.subtitle,
      issue_no: sp.issue_no,
      price: sp.price,
      paid_content: sp.paid_content,
      disclaimer: sp.disclaimer,
      status: "published",
      is_recommended: true,
      result: "pending",
      publish_at: new Date().toISOString(),
    }).select("id").single();

    if (inserted) {
      // 添加一条历史开奖记录
      await admin.from("product_history").insert({
        product_id: inserted.id,
        issue_no: `prev-${sp.issue_no}`,
        content: "上期推荐：3 5 8",
        result: "win",
      });
    }
  }
}

async function ensureBuyerOrders(
  admin: any,
  ids: Record<DemoRole, string>,
) {
  // 检查 buyer 是否已有订单（避免重复刷数据）
  const { count } = await admin
    .from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", ids.buyer);
  if ((count ?? 0) > 0) return;

  // 读取「钱包余额购买」开关
  const { data: setting } = await admin
    .from("app_settings").select("value").eq("key", "wallet_purchase_enabled").maybeSingle();
  const walletEnabled = setting?.value === true;

  // 仅当开关开启时才给买家充值体验金
  if (walletEnabled) {
    const { data: buyerWallet } = await admin
      .from("wallets").select("balance, total_recharge").eq("user_id", ids.buyer).maybeSingle();
    if (buyerWallet) {
      const rechargeAmount = 200;
      const newBalance = Number(buyerWallet.balance) + rechargeAmount;
      await admin.from("wallets").update({
        balance: newBalance,
        total_recharge: Number(buyerWallet.total_recharge) + rechargeAmount,
        updated_at: new Date().toISOString(),
      }).eq("user_id", ids.buyer);
      await admin.from("wallet_transactions").insert({
        user_id: ids.buyer,
        type: "recharge",
        amount: rechargeAmount,
        balance_after: newBalance,
        description: "Demo 初始体验金",
      });
    }
  }

  const { data: merchantRow } = await admin
    .from("merchants").select("id").eq("user_id", ids.merchant).maybeSingle();
  if (!merchantRow) return;
  const { data: products } = await admin
    .from("products").select("id, title, price")
    .eq("merchant_id", merchantRow.id).eq("status", "published").limit(2);
  if (!products || products.length === 0) return;

  const { data: cfg } = await admin
    .from("commission_config").select("l1_rate, l2_rate, platform_rate").limit(1).maybeSingle();
  const l1Rate = Number(cfg?.l1_rate ?? 0.1);
  const platformRate = Number(cfg?.platform_rate ?? 0.15);

  for (const p of products) {
    const price = Number(p.price);
    const l1Amount = Math.round(price * l1Rate * 100) / 100;
    const platformAmount = Math.round(price * platformRate * 100) / 100;
    const merchantAmount = Math.max(0, price - l1Amount - platformAmount);

    const { data: agentProfile } = await admin
      .from("profiles").select("id").eq("user_id", ids.agent).maybeSingle();

    const { data: order } = await admin.from("orders").insert({
      buyer_id: ids.buyer,
      product_id: p.id,
      merchant_id: merchantRow.id,
      amount: price,
      agent_l1_id: agentProfile?.id ?? null,
      status: "paid",
      paid_at: new Date().toISOString(),
    }).select("id").single();
    if (!order) continue;

    // 仅当开关开启时扣买家钱包
    if (walletEnabled) {
      const { data: bw } = await admin.from("wallets").select("balance").eq("user_id", ids.buyer).single();
      const buyerAfter = Number(bw!.balance) - price;
      await admin.from("wallets").update({ balance: buyerAfter, updated_at: new Date().toISOString() })
        .eq("user_id", ids.buyer);
      await admin.from("wallet_transactions").insert({
        user_id: ids.buyer, type: "purchase", amount: -price, balance_after: buyerAfter,
        reference_id: order.id, description: `购买：${p.title}`,
      });
    }

    // 商家入账（始终）
    const { data: mw } = await admin.from("wallets").select("balance").eq("user_id", ids.merchant).single();
    const merchantAfter = Number(mw!.balance) + merchantAmount;
    await admin.from("wallets").update({ balance: merchantAfter, updated_at: new Date().toISOString() })
      .eq("user_id", ids.merchant);
    await admin.from("wallet_transactions").insert({
      user_id: ids.merchant, type: "commission", amount: merchantAmount, balance_after: merchantAfter,
      reference_id: order.id, description: `商品销售：${p.title}`,
    });
    await admin.from("merchants").update({ total_sales: price }).eq("id", merchantRow.id);
    await admin.from("products").update({ sales_count: 1 }).eq("id", p.id);

    // 一级代理分成（始终）
    if (agentProfile && l1Amount > 0) {
      const { data: aw } = await admin.from("wallets").select("balance, total_commission").eq("user_id", ids.agent).single();
      const agentAfter = Number(aw!.balance) + l1Amount;
      await admin.from("wallets").update({
        balance: agentAfter,
        total_commission: Number(aw!.total_commission) + l1Amount,
        updated_at: new Date().toISOString(),
      }).eq("user_id", ids.agent);
      await admin.from("wallet_transactions").insert({
        user_id: ids.agent, type: "commission", amount: l1Amount, balance_after: agentAfter,
        reference_id: order.id, description: `一级分成：${p.title}`,
      });
      await admin.from("commission_records").insert({
        order_id: order.id, beneficiary_id: ids.agent, level: 1, amount: l1Amount, rate: l1Rate,
      });
    }
  }
}
