# 商家独立 + 客户按商家分别归属代理 改造规划

## 一、需求要点（重新对齐）

1. 每个商家是一个独立店铺，账号体系全站共用。
2. 商家有两类二维码：**招代理码**、**招客户码**（=店铺推广码）。
3. 代理扫商家招代理码 → 加入该商家成为代理（一个用户可同时是多个商家的代理）。
4. 客户扫**代理的客户码**或**商家的客户码**进入店铺：
   - 若是该商家的新客户 → 在该商家下绑定到那个代理（或商家本身）；
   - 该绑定**仅在该商家范围内生效**；同一客户在另一个商家可绑定到完全不同的代理。
5. 绑定后，客户在该商家的消费返佣归该商家下绑定的代理。
6. 代理后台可在自己已加入的多个商家间切换；切换后看到的是**该商家下**自己的招客户码、客户列表、收益。
7. 所有对外二维码统一指向中转站 `wx.lovclaw.com`，再 302 到目标页（已实现）。
8. 客户**不显式"绑定商家"**——客户的"当前店铺"由进入路径 / 上次访问决定；只有"在某商家下属于哪个代理"这条关系是持久化的。

---

## 二、当前实现与目标的差距

| 方面 | 当前 | 目标 |
| --- | --- | --- |
| 代理-上线关系 | `agent_relations` 全局一行：`upline_id` + `bound_merchant_id` 各一份 | 需要 (user, merchant) 维度，每个商家下独立的 upline |
| 代理多商家 | `agent_merchant_bindings` 已支持代理多商家 + 活跃商家切换 | 保留，但活跃商家应改为"按商家上下文"判断而不是全局唯一 |
| 客户绑定 | `bind_referrer` 写入全局 `upline_id`，第二次扫别人码也不会覆盖 | 应按"客户 × 商家"维度首次写入；不同商家互不影响 |
| 分佣计算 | `purchase_product` / `_fulfill_product_purchase` / `purchase_package` 用全局 `upline_id` | 改为按订单的 `merchant_id` 查 (buyer, merchant) 维度的 upline |
| 商家代理列表 | `merchant_agents_with_stats` 用 `bound_merchant_id=该商家` | 改为查 `agent_merchant_bindings` 中该商家的代理 |
| 商家客户列表 / 代理详情 | 通过 `agent_relations.upline_id` 反查 | 改为按 (merchant, upline) 维度查 |
| 二维码 ref 编码 | `M_<merchantId>` / 代理 `user_code` | 代理码必须能解析出"代理 + 目标商家"两段信息（一个代理在不同商家有不同码） |
| 代理后台"我的商家" | 已有 `agent_.merchants.tsx` 切换全局 `bound_merchant_id` | 改为切换"当前活跃商家"上下文，并按商家展示对应招客户码 / 客户 / 收益 |

核心结论：**`agent_relations` 一行一用户的模型撑不住"同一客户在不同商家归属不同代理"，必须新建 (user, merchant) 维度的关系表。**

---

## 三、数据库改动

### 3.1 新表：`shop_memberships`（核心）

每行表示「用户 U 在商家 M 下的关系」。

```text
shop_memberships
  id              uuid pk
  user_id         uuid       -- 用户
  merchant_id     uuid       -- 所在商家
  is_agent        bool       -- 在该商家是否是代理
  agent_code      text       -- 在该商家的代理码（用于生成 ref）
  upline_user_id  uuid null  -- 在该商家下的上线代理（NULL = 直属商家）
  l1_rate         numeric null
  joined_at       timestamptz
  unique(user_id, merchant_id)
  index(merchant_id, upline_user_id)
  index(merchant_id, is_agent)
```

- "客户在某商家归属哪个代理"= `upline_user_id`
- "代理是哪些商家的代理" = `is_agent=true` 的所有行（替代现有 `agent_merchant_bindings`，可保留迁移）
- "首次进入即绑定，之后不变"= `INSERT … ON CONFLICT DO NOTHING`

### 3.2 旧表处理

- `agent_relations`：保留只读用于历史数据迁移；新逻辑不再读写其 `upline_id` / `bound_merchant_id`。
- `agent_merchant_bindings`：被 `shop_memberships(is_agent=true)` 取代，迁移后下线。
- `profiles.referrer_id` / `referred_merchant_id`：仅作历史快照，不再用于分佣。
- `orders.agent_l1_id`：保留为历史值；新订单写入仍可填，但来源改为 `shop_memberships`。

### 3.3 新增 / 改造的函数

- `bind_shop_referrer(_merchant_id uuid, _ref text)` — 替代现 `bind_referrer`：
  - 解析 `_ref` 出 `upline_user_id`（或 `M_*` 表示无代理上线）；
  - `INSERT INTO shop_memberships(user_id, merchant_id, upline_user_id, is_agent=false) ON CONFLICT (user_id, merchant_id) DO NOTHING`（**首次写入即终身有效**）。
- `apply_agent_for_merchant` / `become_agent_for_merchant` / `review_agent_application`：改为读写 `shop_memberships`，将该用户在该商家的行设为 `is_agent=true`，分配 `agent_code`。
- `resolve_ref_to_merchant(_ref)`：现实现兼容；对代理码格式扩展为可携带 merchant 信息（见 §4）。
- `merchant_agents_with_stats` / `merchant_agent_detail` / `merchant_set_agent_rate` / `merchant_send_message` / `merchant_broadcast`：从 `shop_memberships` 读"本店代理 / 客户"。
- `purchase_product` / `_fulfill_product_purchase` / `purchase_package`：
  - 拿到 `v_effective_merchant_id` 之后，用 `(buyer, effective_merchant)` 查 `shop_memberships.upline_user_id` → 决定 L1 上线；
  - 若 buyer 在该商家无 membership：兜底插入一行（无 upline）。
- 新增 `set_active_shop(_merchant_id)` / `get_my_shops()`：为代理后台切换商家提供 RPC（也可用前端 localStorage + 当前 RLS 直接查 `shop_memberships`）。

### 3.4 数据迁移脚本（一次性）

1. 把 `agent_merchant_bindings` 全部行 → `shop_memberships(is_agent=true, agent_code=profiles.user_code)`。
2. 把 `agent_relations` 中 `upline_id` + `bound_merchant_id` 都不为空、且 `is_agent=false` 的行 →
   `shop_memberships(merchant_id=bound_merchant_id, upline_user_id=upline)`。
3. 由 `orders` 历史数据补齐：每个 (buyer, merchant) 取最早一笔订单的 `agent_l1_id` 作为 `upline_user_id` 兜底。

---

## 四、二维码 / ref 编码改造

要让"代理 A 在商家 M1 的招客户码"和"代理 A 在商家 M2 的招客户码"指向不同上线归属。

- **新 ref 格式**：`A_<agentUserCode>_M_<merchantId>`（兼容老格式）。
  - `M_<merchantId>` 仍代表"商家自己的招客户码"（无代理上线）。
  - 旧的纯 `<userCode>`（无 merchant）：仅用于平台层级的代理招代理（保留兼容）。
- 中转站 URL 不变：`https://wx.lovclaw.com/r?ref=...&to=/shop/<merchantId>`，目的页不变。
- `resolve_ref_to_merchant` 升级为同时返回 `(merchant_id, upline_user_id)`，前端拿到后调用 `bind_shop_referrer`。

### 二维码生成位置

| 页面 | 当前 | 改后 |
| --- | --- | --- |
| `merchant.qrcode.tsx`（商家招客户码） | `ref=M_<mid>` | 不变 |
| `merchant.agent-recruit.tsx`（商家招代理码） | `ref=M_<mid>&to=/apply-agent/<mid>` | 不变 |
| `agent_.share.tsx`（代理推广码） | `ref=<userCode>` 全局一份 | 改为"按商家分别生成"：列出"我加入的商家"，每个商家给一个 `ref=A_<code>_M_<mid>` 的码 |
| 代理后台首页 / 切换商家 | `bound_merchant_id` 全局唯一 | 改为前端 `currentShopId` + `shop_memberships` 列表 |

---

## 五、前端改造点

1. **`/`（`src/routes/index.tsx`）**：
   - 解析 `?ref=...` → `resolve_ref_to_merchant` 拿 `(merchantId, uplineUserId)`；
   - 已登录则调 `bind_shop_referrer(merchantId, ref)`；未登录则把 ref 暂存 `pending_referrer`，登录后由 auth-context 重放（与现机制相同）；
   - "默认店铺 / 上次店铺"逻辑保持。
2. **`shop.$merchantId.tsx`**：客户进入时若已登录但 (user, merchant) 无 membership，触发一次 `bind_shop_referrer(merchantId, 'M_<merchantId>')`（无上线）。
3. **代理后台**：
   - `agent_.merchants.tsx`：列出 `shop_memberships(is_agent=true)`；切换"当前活跃商家"改为写 `localStorage('active_shop_id')`，不再 update DB。
   - `agent_.share.tsx`：读取当前 active shop，生成 `ref=A_<code>_M_<mid>`。
   - `agent_.invitees.tsx`：按 active shop 过滤"我在这家店带的客户"。
   - `agent.tsx`（代理首页收益）：按 active shop 汇总。
4. **商家后台**：
   - 代理列表 / 客户列表 / 给代理改分成 / 群发：调用改造后的 RPC，自动按"当前商家"返回数据，无需前端传 merchant id。
5. **`apply-agent.$merchantId.tsx`**：保持，提交后写入 `agent_applications`，审核通过由 `review_agent_application` 把 `shop_memberships(merchant_id=该商家).is_agent` 置 true。
6. **`auth-context.tsx`**：登录后重放 `pending_referrer` 时，需要同时知道目标 merchant；改为存 `{ ref, merchantId }` 对象（或在 `?ref=...` 同时带 `m=<mid>`）。

---

## 六、分佣链路改造（重要）

现 `purchase_product` 取上线：
```
SELECT upline_id FROM agent_relations WHERE user_id = buyer
```
改为：
```
SELECT upline_user_id FROM shop_memberships
 WHERE user_id = buyer AND merchant_id = v_effective_merchant_id
```
- 若 buyer 在该商家无 membership：视为无上线（佣金全归商家），并补插一行 `upline_user_id=NULL`。
- L1 比例仍按 `merchants.l1_rate` / `shop_memberships.l1_rate` / `merchants.l1_max_rate` 计算。
- `commission_records` 写入逻辑不变，但 `beneficiary_id` 为 `upline_user_id`。

---

## 七、迁移与上线节奏（建议 3 周，2 个工程师）

**Phase 1（3 天）— DB 基建 + 双写**
- 建 `shop_memberships`、写 `bind_shop_referrer`；
- 老 `bind_referrer` 改为同时写新表（双写）；
- 一次性迁移历史数据；上线观察 1–2 天。

**Phase 2（5–7 天）— 读路径切到新表**
- 改 `purchase_product` / `_fulfill_product_purchase` / `purchase_package`；
- 改商家后台 RPC（`merchant_agents_with_stats` 等）；
- 改 `apply_agent_for_merchant` / `become_agent_for_merchant` / `review_agent_application`；
- 灰度对比 commission 结果与旧表是否一致。

**Phase 3（5 天）— 前端改造 + 新 ref 格式**
- 代理后台按商家切换 + 按商家生成代理码；
- 客户首页/店铺页改用 `bind_shop_referrer`；
- 旧 `agent_relations` / `agent_merchant_bindings` 转为只读，下线写路径。

---

## 八、风险与注意

- **首次绑定语义**：明确"客户首次进入该商家时归属确定，之后再扫别的代理码也不再变更"——直接靠 `ON CONFLICT DO NOTHING` 实现。
- **代理本人在自己店铺消费**：`upline_user_id` 应跳过 = self（沿用现有 `if v_l1_user is not null` + 校验 `v_l1_user <> _buyer`）。
- **挂靠商家（`merchant_affiliations`）**：`v_effective_merchant_id` 已经是"店铺归属商家"，分佣按 effective merchant 查 membership，与现行 effective 逻辑兼容。
- **历史订单**：不重算佣金；只影响新订单。
- **微信屏蔽**：所有二维码继续指向 `wx.lovclaw.com` 中转站，目的页域名变更无需重新生成二维码。
- **RLS**：`shop_memberships` 需要 select 策略：本人；该商家的 owner（`merchants.user_id = auth.uid()`）；admin。

---

## 九、明确不做的事

- 不做"商家自带独立域名 / 多租户域名分发"（与上一轮方案不同，本轮聚焦关系隔离即可满足"独立店铺 + 客户按商家归属代理"）。
- 不动 `auth.users` / 手机号唯一性 / 微信登录链路。
- `sms-send` / `wechat-exchange` / `pay-notify` 全部保持。
