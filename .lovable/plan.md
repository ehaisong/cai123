## 目标

1. 复用现有 demo 商家（merchants.id `b36f6413-…`），把它绑定到手机号 **15120857030**、密码 **123456**，可用「手机号+密码」登录管理店铺。
2. 商家登录页除「手机验证码」外，新增「手机号+密码」登录子模式。
3. 把该商家设为 `app_settings.default_shop_id`（无推广链接的访客自动落到该店）。
4. 批量插入 **24 条** DEMO 商品 + 对应 `product_issues`，覆盖截图中全部分类（3D / P3 / P5 / 球赛 / 其他·快乐8）。

## 实施步骤

### 1. 新增一次性 Edge Function：`seed-demo-merchant`
作用：用 service_role 完成账号 + 商家信息初始化，可重复执行（幂等）。
- `auth.admin.updateUserById('725b6638-…', { phone: '15120857030', phone_confirm: true, password: '123456' })`
- `merchants` upsert：`shop_name='DEMO 测试店铺'`、`shop_description='平台演示店铺，用于功能测试'`、`status='approved'`、`is_disabled=false`
- 确保 `user_roles(user_id, 'merchant')` 存在
- 写入 `app_settings.default_shop_id = "b36f6413-…"`

部署后由前端/我手动调用一次即可。

### 2. 登录页：增加「手机号+密码」登录
修改 `src/routes/auth.login.tsx` 的 `StaffPanel`：
- 顶部加一个小切换：`验证码登录` / `密码登录`（无新设计 token，沿用现有圆角输入 + 主色按钮）。
- 密码模式：手机号 + 密码两个输入 + "登录" 按钮。
- 调用 `supabase.auth.signInWithPassword({ phone: '86' + phone 或裸号 phone, password })`。考虑到 `bootstrap_admin_role` 与现有 `find_user_by_phone` 都做了归一化处理，这里登录直接用裸 11 位手机号；若失败则回退尝试 `+86` 前缀。
- 校验：`/^1\d{10}$/`、密码 ≥ 6 位。
- 成功后走现有 `routeAfterLogin()`。

### 3. 批量种子商品（数据插入 — insert 工具，不是 schema migration）

针对 `merchant_id = b36f6413-…` 写入 24 条 `products` + 对应 `product_issues`。
分类分布（覆盖店铺页 Tab 3D / P3 / P5 / 球赛 / 其他）：

| 分类（types）        | 数量 | 期号样式            | category_id 取值  |
|---------------------|------|---------------------|-------------------|
| ['3D']              | 6    | 2026111… 2026116    | fc3d              |
| ['P3']              | 5    | 2026111… 2026115    | fc3d              |
| ['P5']              | 4    | 2026111… 2026114    | fc3d              |
| ['3D','P3']         | 2    | 2026111…            | fc3d              |
| ['P3','P5']         | 1    | 2026111             | fc3d              |
| ['球赛']            | 4    | 0419 / 0420 …      | fc                |
| ['其他'] (快乐8)    | 4    | 104 / 103 / 102 / 101| lhc              |
| **合计**            | 26   |                     |                   |

每条字段统一：
- `kind='single'`、`status='published'`、`publish_at=now() - 随机 0–10 天`
- `paid_content`：贴近截图，例如  
  `111期【白斩鸡】福+体通用单挑一注直组包含三码全定位复试🔥不断更 已更新\n108期【567】体开656✅\n109期【159】福开195✅\n110期【379】福开379✅\n111期【420】`
- `intro`：简短简介 + "本站资料仅供参考"
- `price`：3D/P3/P5 大多数 0 豆（演示免费），少量 6/8/10；球赛 58/68/88；快乐8 0/8
- 部分置 `is_recommended=true`（前 3 条）、`streak=3..6` + `tags=['3连红'…]`
- `no_win_refund=true` 给球赛和带"不中退款"的资料
- `is_presale=true` 给 1 条（截图里的"预售/还研究"）
- `has_self_issue=true` 全部为 true，并对每条同步插入 1 条 `product_issues`：`status='published'`、`publish_at=publish_at`、`paid_content=products.paid_content`

### 4. 验证步骤
1. 调用 seed function → 检查 `auth.users.phone` 已写入。
2. 退出登录访问 `/` → 应自动进入 DEMO 商家店铺。
3. 在「商家登录 → 密码登录」用 `15120857030 / 123456` 登录 → 跳到 `/merchant`，可见 26 条商品。
4. 店铺页切换全部/3D/P3/P5/球赛/其他 → 每个 Tab 都有内容。

## 涉及文件

- 新增：`supabase/functions/seed-demo-merchant/index.ts`
- 修改：`src/routes/auth.login.tsx`（StaffPanel 增加密码模式子 Tab）
- 数据：通过 insert SQL 批量写入 `app_settings` / `products` / `product_issues`（不改 schema）

不改动现有 `sms-send` / `sms-verify` / 路由跳转逻辑。
