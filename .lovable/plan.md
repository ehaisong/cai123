## 功能概述

在商家后台增加"挂靠"功能：商家 A 可申请挂靠到商家 B，审核通过后，A 的店铺会即时同步显示 B 的商品；买家在 A 的店铺下单时，订单归属 A，销售收入归 A。

## UI 设计（参考截图）

新增页面 `/merchant/affiliations`（挂靠服务）：

- 顶部红色 PageHeader「挂靠服务」
- 搜索商家输入框（按店铺名搜索可挂靠商家）+ 备注文本框 + 红色「提交申请」按钮
- 4 个 Tab（与截图一致）：
  1. **申请记录** — 我提交的申请（待审核 / 已通过 / 已拒绝），可撤销待审核项
  2. **已挂靠商家** — 我已挂靠的其他商家列表，可「取消挂靠」
  3. **审核挂靠申请** — 别人申请挂靠到我，可「通过 / 拒绝」
  4. **挂靠我的商家** — 已挂靠到我名下的商家列表，可「解除」
- Tab 内空态使用现有的暂无数据样式

入口：在 `src/routes/merchant.index.tsx` 的功能宫格中新增一个「挂靠商家」按钮（图标 Link2 / Network），跳转到 `/merchant/affiliations`。

## 数据库改动

新增表 `merchant_affiliations`：
- `affiliate_merchant_id`（申请方/挂靠方，商品销售归此商家）
- `host_merchant_id`（被挂靠方，商品来源）
- `status`：`pending` / `approved` / `rejected` / `cancelled`
- `note`（申请备注）
- `reviewed_at`、`reviewed_by`
- 唯一约束：`(affiliate_merchant_id, host_merchant_id)`（同一对挂靠关系唯一活动记录，已取消/拒绝可重新申请）

RLS 策略：
- 双方商家可以查看与自己相关的记录
- 申请方可创建 / 取消自己的 pending 申请
- 被挂靠方可审核（通过 / 拒绝）发给自己的申请
- 双方均可解除已通过的关系
- 管理员可查看全部

新增 SECURITY DEFINER 函数：
- `apply_affiliation(_host_merchant_id)` — 当前用户的商家身份申请挂靠
- `review_affiliation(_id, _approve)` — 被挂靠方审核
- `cancel_affiliation(_id)` — 双方任一方解除/撤销

## 商品同步逻辑

挂靠是"展示层"的同步，不复制商品数据：

- 修改 `shop.$merchantId.tsx` 商品查询：除查询本店 `merchant_id = X` 的商品外，再查询所有 `host_merchant_id` 在该商家的 approved 挂靠列表中的 host 商家的 `published` 商品，合并展示，并在卡片上标「挂靠」小标签以区分。
- 商品详情页 `product.$productId.tsx` 保留商品原始 merchant 信息显示（来源），但**下单时把 `orders.merchant_id` 写为"当前店铺商家"而不是商品原 merchant**，确保收入归挂靠方。
- 订单创建逻辑需要传入"店铺上下文 merchantId"。在商品详情页通过 query string `?from=<shopMerchantId>` 携带，下单 RPC / insert 时使用此值。若无 from 参数则默认使用商品原 merchant。
- 分成（commission）继续按订单 merchant 的代理关系结算，符合"销售收入归本商家"的语义。

## 技术细节

- 新增路由文件：`src/routes/merchant.affiliations.tsx`（受 `RouteGuard roles={['merchant']}` 保护）
- 新增 `merchant-bottom-nav` 不变；功能宫格新增入口
- 商品卡片在合并列表时携带 `source_merchant_id`，用于判断是否显示「挂靠」标签
- 商品详情入口改造：从店铺进入时附带 `?from=<merchantId>`，下单使用该 from 作为订单 merchant
- 现有 RLS：products 表只允许 published 商品被公开读取，无需改动；orders 表 merchant_id 写入挂靠方需要确认 RLS 允许（通常允许买家创建订单并指定任意 merchant_id，需复核策略）

## 实施步骤

1. 创建 `merchant_affiliations` 表 + RLS + RPC 函数（migration）
2. 新增 `src/routes/merchant.affiliations.tsx`（4 个 Tab 的挂靠管理页）
3. 在 `src/routes/merchant.index.tsx` 功能宫格添加「挂靠商家」入口
4. 修改 `src/routes/shop.$merchantId.tsx` 合并展示挂靠商品，标识来源
5. 修改商品详情 / 下单流程，使用 `?from=` 上下文写入 `orders.merchant_id`
6. 复核 orders 的 RLS 与代理分成是否按新归属正常工作

## 待确认

- 挂靠是否需要管理员二次审核？当前方案为仅被挂靠方审核
- 一个商家同时挂靠的上限？默认不限制
- 挂靠商品的价格是否允许挂靠方覆盖？默认沿用原价（实现最简单，符合"即时同步"）