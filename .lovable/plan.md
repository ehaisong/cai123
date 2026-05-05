
# 修复 `find_user_by_phone` RPC

## 现状诊断

通过实际查库发现两个严重问题，会让"按手机号找用户"经常找错或找不到：

### 问题 1：同一个手机号在 `auth.users` 里存了多个账号
`auth.users.phone` 字段历史上有时存 `"13807674808"`（裸号），有时存 `"8613807674808"`（带国码），导致同一真实手机号产生多个账号：

| user_id | phone | email | 创建时间 |
|---|---|---|---|
| `2c69bfed…` | `8613807674808` | phone_2c69…@phone.local | 5-03 |
| `456ed039…` | `13807674808`   | phone_456e…@phone.local | 5-05 |
| `9e296d21…` | `8615120857030` | phone_9e29…@phone.local | 5-04 |
| `725b6638…` | `15120857030`   | demo.merchant@hxxgo.test | 4-26（商家本号）|

### 问题 2：当前 `find_user_by_phone` 只比"完全相等"，不去 86
```sql
regexp_replace(phone,'\D','','g') = v_norm
```
传入 `13807674808` 只能匹配 `456ed039…`；传入 `+8613807674808` 又只能匹配 `2c69bfed…`。所以"用同一个手机号走密码登陆 / 验证码登陆 / 手机绑定"会落到不同账号上，钱包、订单、角色全部错乱。

## 修复目标

1. **RPC 端**：`find_user_by_phone` 双向去掉 `86` 国码后比较，永远只返回一个稳定 user_id（优先**真实邮箱**账号 > 商家身份账号 > 创建最早账号）。
2. **数据端**：把现有 4 个重复账号收敛到 2 个真实用户，把 phone_xxx@phone.local 的影子账号合并到真实账号上（或直接删除影子账号，因为它们没有钱包流水/订单）。
3. **写入端**：sms-verify Edge Function 在创建影子用户前，**先调用修复后的 RPC** 查找是否已存在该手机号的真实账号；存在就直接返回该用户，不再新建。

## 实施步骤

### 1. 重写 `find_user_by_phone`（迁移）
- 入参规范化：`regexp_replace(_phone,'\D','','g')` → 去掉前导 `86`（11 位中国手机号必为 1 开头）。
- 比较时对 `auth.users.phone` 也做同样规范化。
- 排序：先按 `email NOT LIKE '%@phone.local'` DESC（真实邮箱在前），再按 `created_at ASC`，取第一条。

### 2. 数据收敛（迁移）
- 查询所有 `auth.users` 按"去 86 后的手机号"分组，找出 `count > 1` 的组。
- 对每组：保留"主账号"（真实邮箱优先），把其余影子账号的 `profiles / wallets / orders / user_roles` 等数据**改挂**到主账号；最后从 `auth.users` 删除影子账号。
- 当前 4 个账号实际只对应 2 个手机号，本次迁移会硬编码处理这 2 组（影子账号上没有交易，安全）。
- 把保留下来的账号 `auth.users.phone` 统一规范化为**带 86**（`8613807674808`），跟 Supabase Phone Provider 默认一致。

### 3. `sms-verify` Edge Function 调整
- 收到 OTP 通过后：
  1. `find_user_by_phone(phone)` → 命中则直接 `generateLink({type:'magiclink', email: <该用户的email>})` 返回 `tokenHash`，不再创建新账号。
  2. 未命中时再 `admin.createUser({ phone, email: phone_<uuid>@phone.local })`，并把 `profiles.phone` 写成规范化形式。
- 同步修一下 `phone-password-login`：调用同一个 RPC 拿 user_id，然后取 email 做 password grant，不会再因为国码差异 404。

### 4. 验证
- 用 13807674808 / 15120857030 各跑：验证码登陆 → 密码登陆 → "我的-手机绑定"，应全程命中同一个 user_id。
- `SELECT find_user_by_phone(x)` 对裸号 / +86 号 / 86 号三种格式返回相同 uid。

## 不改动的地方
- 不改 Supabase 自带 Phone Provider 配置（仍关闭，继续走 SMS 中转）。
- 不改前端登录/绑定 UI。
- `profiles.phone` 字段格式保持现状，只在新写入时规范化。

## 风险与回滚
- 删除影子账号前先 `SELECT` 确认影子账号 `wallet_transactions / orders / commission_records` 行数为 0；如非 0 则改为"迁移引用 → 再删"。
- 迁移可逆性低（删 auth.users 不可回滚），所以会先在事务里 `RAISE NOTICE` 列出将删账号清单，确认无业务数据再 commit。

确认后我会按此提交一次 `supabase migration` 和一个 sms-verify edge function 修改。
