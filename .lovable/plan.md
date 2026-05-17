## 方案 A 步骤一缺漏检查

代码搜索结果：
- `agent_merchant_bindings`、`profiles.referrer_id`、`profiles.referred_merchant_id` 已无任何业务代码引用 ✅
- `agent_relations` 仍有 **20+ 处读** 和 **4 处写**

**关键缺漏（P0，必须立刻修，目前是 bug）**

`agent_relations` 现在是由 `shop_memberships` 触发器生成的派生表，对它的任何直接写入都会在下一次 SM 变更时被覆盖；而且单店 `l1_rate` 等字段的"真源"已经是 SM。但前端仍有 4 处直接写 AR：

| 文件 | 行 | 现状写入 | 应改为 |
|---|---|---|---|
| `src/routes/pc.customers.tsx` | 137 | `agent_relations.update({upline_id:null})` | `shop_memberships.update({upline_user_id:null})`（按 user_id+merchant_id） |
| `src/routes/pc.users_.agent.$userId.tsx` | 58 | 同上 | 同上 |
| `src/routes/pc.users_.buyer.$userId.tsx` | 48 | 同上 | 同上 |
| `src/routes/pc.users_.merchant.$merchantId.tsx` | 74 | `agent_relations.update({l1_rate})` | `shop_memberships.update({l1_rate})` |

注意：AR 是"每用户一行"的全局派生视图；SM 是"每(用户,店铺)一行"。所以解绑客户、改分成都需要 **指定 merchant_id**——这恰恰是新模型期望的行为（多店时只解绑/调整当前店）。

---

## 分批迁移计划

### Batch 1：修写入（P0，本批必须做完）
- `pc.customers.tsx`、`pc.users_.agent.$userId.tsx`、`pc.users_.buyer.$userId.tsx`：解绑改为 `shop_memberships` 按 (user_id, merchant_id) 更新 `upline_user_id=null`，需要先确定"在哪个店解绑"
  - 客户详情/代理详情页：使用该客户所在的 `bound_merchant_id` 作为 merchant_id
  - PC 客户列表：每行已知归属店铺
- `pc.users_.merchant.$merchantId.tsx` 改比例：直接 `shop_memberships.update({l1_rate})` where user_id+merchant_id=本店

验收：执行解绑/改比例后，触发器自动同步 AR，刷新无回滚。

### Batch 2：H5 代理中心读迁移（P1）
- `src/routes/agent.tsx`：当前读 AR 取代理身份/绑定店铺 → 改读 SM（`is_agent=true`，可能多行，按当前激活店选一行；或汇总）
- `src/routes/agent_.invitees.tsx`：下级列表 `upline_id=profile.id` → 改 SM `upline_user_id=auth.user.id`（少一次 profiles 查询）
- `src/routes/agent_.share.tsx`：取 agent_code/bound_merchant → 直接 SM 按当前激活店
- `src/routes/merchants.tsx`：取 bound_merchant_id → SM 列出所有 `is_agent=true` 的店
- `src/routes/merchant.messages.tsx`：商家给旗下代理推送 → SM where merchant_id+is_agent

验收：代理中心、邀请列表、分享码、店铺列表四个入口数据一致。

### Batch 3：店铺落地/客户绑定读迁移（P1）
- `src/routes/shop.$merchantId.tsx`：进店时检查/写入绑定关系（如果还有写入路径，确保只写 SM）

### Batch 4：管理端/PC 列表读迁移（已完成 ✅）
全部迁至 `shop_memberships`：
- `admin.agents.tsx`、`admin.kyc.tsx`
- `pc.agents.tsx`、`pc.customers.tsx`（reads + 过滤器）、`pc.index.tsx`（代理总数去重）、`pc.users.tsx`（含商家展开/代理子表）、`pc.users_.merchant.$merchantId.tsx`、`pc.users_.agent.$userId.tsx`

注意：
- `pc.customers.tsx` 的 `agentId` URL 参数语义从 `profile.id` 改为 `user_id`；`pc.agents.tsx` 已同步更新跳转。
- 代理列表（pc.agents / admin.agents）从「每用户一行」变为「每 (用户, 店铺) 一行」，更准确反映多店身份；列表 key 使用 `user_id::merchant_id`。
- 客户数按 (代理 user_id, merchant_id) 统计。

### Batch 5：派生表淘汰（下一步可执行）
全部读已迁完，可以安全：
- 删除 `agent_relations` 表及触发器 `trg_sync_agent_relations_sm`
- 重新生成 `src/integrations/supabase/types.ts`

---

## 技术备注

- `shop_memberships` 字段：`user_id, merchant_id, upline_user_id, is_agent, agent_code, l1_rate, joined_at` — 完全覆盖 AR 的语义，且 upline 直接用 auth user_id（无需 profiles 跳板）。
- "当前激活店"概念：H5 代理中心若用户在多个店都是代理，需要约定一个选择规则（如最近加入 / URL 参数 / 用户切换）。本次以"最早加入的店"或"任取一行"做最小实现，后续按需求加切换器。
- RLS 已就绪：SM 现有 `sm_select_self`、`sm_select_merchant_owner`、`sm_admin_all`，覆盖所有读路径。

---

## 本次建议执行范围

只做 **Batch 1**（修 P0 写入 bug）。Batch 2–4 在你确认 Batch 1 测试通过后再分批推进。Batch 5 在所有读都迁完后再做。

