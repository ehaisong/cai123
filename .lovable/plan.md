## 目标

在现有项目基础上新增一套独立 PC 端管理后台（路径前缀 `/pc`），用于：
1. 按商家维度树状管理用户（商家 → 代理 → 客户），含资料、审核、开关店、解绑、交易/返佣明细
2. 集中管理支付通道（含 3ypay 全部参数、默认通道、手续费、订单流水查看）

不影响现有移动端 H5（/admin、/merchant 等）页面。

---

## 1. 访问入口与权限

- 路径：`/pc/*`，独立 PC 宽屏布局（不复用 `h5-shell`）
- 登录：复用现有 Supabase 手机号 + admin 角色
  - `/pc/login`：手机号 + 密码（沿用 phone-password-login）；或者直接共用现有 `/auth/staff-login` 跳转回 `/pc`
  - 路由守卫：`PcRouteGuard`（参考现有 `RouteGuard`），未登录跳 `/pc/login`，无 admin 角色显示无权限
- 顶部导航：左侧 Sidebar（用户管理 / 支付通道 / 退出），右侧内容区

> 用户已确认：用现有手机号 + admin 角色登录，不新建账号。提示用户：先用 `ehaisong` 对应的手机号登录现有系统，并在 `user_roles` 中赋予 admin 角色（如未赋，可通过现有 admin 后台或 SQL 处理）。

---

## 2. 用户管理（树状）

### 2.1 商家列表页 `/pc/users`
- 表格字段：店铺名、负责人、手机、状态（pending/approved/disabled）、累计销售、旗下代理数、旗下客户数、注册时间
- 顶部 Tab：全部 / 待审核 / 已通过 / 已禁用
- 操作：查看详情、审核通过/驳回（待审核态）、关店/开店（approved/disabled 切换）

### 2.2 商家详情 `/pc/users/merchant/$merchantId`
- 资料面板（含 `merchant_applications` 原始申请资料 + `merchants` 当前资料）
- 三个 Tab：
  - **旗下代理**：列表（昵称/代理码/手机/分成比例/累计佣金/客户数/加入时间），操作：调整 l1_rate、解绑（清空 `agent_relations.bound_merchant_id` + 移除 `agent_merchant_bindings`）、查看代理详情
  - **本店订单**：列表（订单号、商品、买家、金额、代理、状态、时间），可按时间筛选
  - **操作记录**：审核/开关店历史（来自 `merchants.disabled_at/reason` + `merchant_applications.reviewed_at`）

### 2.3 代理详情 `/pc/users/agent/$userId`
- 基本资料、归属商家、推荐人
- Tab：
  - **旗下客户**：来自 `agent_relations.upline_id = profile.id` 的列表，含解绑（清空 upline_id）
  - **返佣明细**：`commission_records` 列表（订单、金额、级别、时间）+ 顶部统计（今日/昨日/本月/总计）
  - **交易订单**：`orders.agent_l1_id = userId`

### 2.4 普通用户详情 `/pc/users/buyer/$userId`
- 资料、归属代理（可解绑）、订单列表、钱包余额/流水

### 2.5 全局用户检索（顶栏）
- 按 昵称/手机号/user_code 搜索，跳转对应详情

### 操作均通过现有 RPC / 表更新：
- 商家审核：复用 `admin.applications` 中的逻辑（`merchants` upsert + `user_roles` insert + `merchant_applications.update`）
- 关店/开店：`merchants.update is_disabled/disabled_reason/disabled_at`
- 调整代理分成：`merchant_set_agent_rate`（admin 直改 `agent_relations.l1_rate`）
- 代理解绑商家：admin 直接 `update agent_relations set bound_merchant_id=null, is_agent=false where user_id=?`，并清 `agent_merchant_bindings`
- 客户解绑代理：`update agent_relations set upline_id=null where user_id=?`

> 上述两个解绑操作目前没有专用 RPC，admin RLS 已允许直接 update（`ar_admin_all`）。

---

## 3. 支付通道管理 `/pc/payments`

### 3.1 数据库改动（migration）
在 `payment_channels` 表新增：
- `fee_rate numeric(6,4) not null default 0`（手续费率 0~1）
- `is_default boolean not null default false`（同一 provider 内仅一个默认；通过部分唯一索引保证）
- `config` JSON 已存在，扩展约定字段存放 3ypay 全部参数：
  ```
  {
    "mch_id": "...",
    "sub_mch_no": "...",
    "app_id": "APP_...",
    "app_channel_no": "AC...",
    "merchant_private_key": "-----BEGIN PRIVATE KEY-----...",
    "platform_public_key": "-----BEGIN PUBLIC KEY-----...",
    "wechat_aut_no": "T...", "wechat_aut_sub_mch_no": "...",
    "alipay_aut_no": "A...", "alipay_aut_sub_mch_no": "...",
    "wechat_appid": "wx...",
    "gateway_base": "https://gw.nrnc.net",
    "notify_url": "https://66cai.site/api/public/pay-notify",
    "return_url": "https://66cai.site/pay/success"
  }
  ```
- 额外新增部分唯一索引：`create unique index payment_channels_default_uniq on payment_channels (provider) where is_default;`

### 3.2 通道列表页
- 表格：名称/code、provider（threeypay/alipay/wechat/test）、是否启用、是否默认、手续费率、排序、备注、更新时间
- 操作：新建、编辑、启用/禁用、设为默认、删除

### 3.3 通道编辑表单
- 通用字段：name、code、provider、is_enabled、is_default、fee_rate、sort_order、remark
- 当 provider = `threeypay` 时显示 3ypay 专用字段（上方 JSON 列出的全部 key），分组为：
  - 基础参数（mch_id / sub_mch_no / app_id / app_channel_no）
  - RSA 密钥（merchant_private_key / platform_public_key，多行 textarea）
  - AUT 通道（微信 / 支付宝 各一组 aut_no + sub_mch_no）
  - 微信 JSAPI（wechat_appid + 授权目录提示）
  - 网关与回调（gateway_base / notify_url / return_url）
- 提交时合并写回 `config` JSON

### 3.4 通道交易明细 `/pc/payments/$channelId/orders`
- 来源：`payment_orders`（按 `metadata->>'channel_id' = $channelId` 或 `pay_type` 筛选；建议在 `pay-create` 落库时把 `channel_id` 写入 metadata，本次一并改造）
- 列表：order_no、用户（关联 profile 昵称/手机）、金额、手续费（amount × fee_rate）、实收、pay_type、状态、trade_no、创建/支付时间
- 顶部统计卡片：订单总数、成功数、总金额、总手续费
- 时间范围筛选 + 导出 CSV（前端生成）

### 3.5 与现有支付逻辑对接
- 现有 `pay-create` / `pay-notify` 在 PC 后台修改 `config` 后立即生效（读 DB）
- 后续接入 3ypay 时，PC 后台会成为唯一参数录入入口

---

## 4. 文件结构

```
src/routes/pc/
  __layout.tsx          // PC Sidebar + 内容区 (createFileRoute('/pc/_layout'))  
                        // 实际写法：src/routes/pc.tsx 作为父 layout，子路由 pc.users.tsx 等
  pc.tsx                // /pc Layout（Sidebar + Outlet + admin 守卫）
  pc.index.tsx          // /pc 概览（统计卡片：用户总数、商家数、代理数、近 7 天订单/支付）
  pc.login.tsx          // /pc/login
  pc.users.tsx          // 商家列表
  pc.users.merchant.$merchantId.tsx
  pc.users.agent.$userId.tsx
  pc.users.buyer.$userId.tsx
  pc.payments.tsx       // 支付通道列表 + 新建/编辑 Drawer
  pc.payments.$channelId.orders.tsx

src/components/pc/
  pc-shell.tsx          // 宽屏布局
  pc-sidebar.tsx
  pc-route-guard.tsx
  pc-data-table.tsx     // 简易封装（基于现有 ui/table）
  payment-channel-form.tsx
```

样式：复用 shadcn/ui + tailwind 语义 token，按 PC ≥1024 设计；不引入新依赖。

---

## 5. 不在本次范围

- 不做 3ypay 实际接入代码（pay-create/pay-notify 重写）——下一步在通道参数录入完成后另起一轮
- 不动现有 `/admin/*` H5 后台
- 不做用户角色层级精细权限（仅 admin 可访问）

---

## 6. 技术要点

- 所有数据读写在前端走 supabase-js + admin RLS（admin 角色已具备全局读写权限）
- PC Layout 不使用 `h5-shell`，使用独立 `pc-shell` 类（顶栏 + 左 Sidebar + 主区）
- 数据表统一用 `@/components/ui/table` + 分页 + 搜索
- 表单用 react-hook-form + zod（项目已有 `ui/form`）

---

## 7. 交付步骤

1. migration：`payment_channels` 新增 `fee_rate`、`is_default` + 唯一索引
2. 新增 `pc-shell` / `pc-sidebar` / `pc-route-guard`
3. `/pc/login`、`/pc`（概览）
4. 用户管理 4 个页面
5. 支付通道列表 + 编辑表单
6. 支付通道订单明细页
7. 在现有 `/auth/staff-login` 登录成功后，若来源为 `/pc`，跳回 `/pc`（小改）

完成后请用户：在 PC 浏览器打开 `https://66cai.site/pc/login`，用 admin 角色手机号登录，即可录入 3ypay 全部参数并查看用户/订单关系。
