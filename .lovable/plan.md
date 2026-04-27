## 背景与现状

目前数据表 `products` 既保存商品元信息（标题、彩种、价格、推荐、商家），又保存"当期内容"（issue_no / paid_content / publish_at / reveal_at / result）。每一期都需要重新建一条 product，导致：

- 商家要重复填标题/价格/分类
- 历史期数靠 `product_history` 手工维护
- 没法批量管理（批量公开、批量定结果、批量发布下一期）
- 定时公开依赖人工改 status / result

## 设计目标

把"商品系列（series）"与"每一期（issue）"在概念与操作上拆开：
- 一个**商品系列**：标题、彩种、价格、推荐、免责声明、商家 — 长期不变。
- 多个**期号**：期号、付费内容、发布时间、公开时间、结果 — 每期一条。

商家工作流变为：建一次系列 → 反复"加新一期 / 改某期 / 批量公开 / 批量判中"。

## 数据模型调整（不破坏现有数据）

### 新表 `product_issues`（一期一条）
```
id              uuid pk
product_id      uuid  → products.id  （系列）
issue_no        text  not null
paid_content    text
publish_at      timestamptz default now()  -- 此期对买家可见的时间
reveal_at       timestamptz                -- 答案/结果公开的时间（可选定时）
result          product_result default 'pending'   -- pending/won/lost
result_note     text
status          product_status default 'published' -- published/unpublished/draft
sales_count     integer default 0
created_at / updated_at
unique (product_id, issue_no)
```
索引：`(product_id, publish_at desc)`、`(reveal_at) where reveal_at is not null and result='pending'`。

### `products` 角色弱化为"系列"
保留：title / subtitle / category_id / merchant_id / price / is_recommended / disclaimer / status。
现有的 issue_no / paid_content / publish_at / reveal_at / result / result_note 字段保留（兼容老数据），但新流程统一改用 `product_issues`。

### 数据迁移
一次性把现有 products 的当期字段 + product_history 全部回填到 product_issues：
- 每条 product → 写一条 product_issues（取自身 issue_no/paid_content/publish_at/...）
- 每条 product_history → 写一条 product_issues（取 issue_no/content/publish_at/result）

后续 `product_history` 仅作只读归档，新写入全部走 product_issues。

### purchase_product 调整
订单仍然挂在系列（products.id）+ 买家维度，但增加 `orders.issue_id`（可空，老订单为 null），表示"这一笔买的是哪一期"。前端购买时传当前展示的 issue_id；销量计入对应 issue 的 sales_count，并仍累加 product 的 sales_count 用于排行。

### 定时公开（可选自动化）
新增 `pg_cron` 任务每分钟扫描：`reveal_at <= now() AND result='pending' AND status='published'` 的 issue，仅触发"到点解锁"逻辑（实际上前端已经按 reveal_at 控制可见性，所以这里**主要由前端按时间判断**即可，不一定要 cron）。结果判定（中/未中）必须由商家手动确认，不自动判。

## 商家端操作设计（核心交付物）

### 页面 1：`/merchant/products` —— 系列列表（改造）
卡片只展示系列级信息：标题 / 彩种 / 价格 / 最新一期号 / 最新一期状态徽章（待公开/已公开-中/已公开-未中）。
卡片操作：`管理期数` `编辑系列` `上/下架`。

### 页面 2：`/merchant/products/new` —— 新建系列（瘦身）
只填系列字段（标题/副标题/分类/价格/推荐/免责声明）。提交后引导跳转到"添加首期"。

### 页面 3：`/merchant/products/$productId/issues` —— 期数管理（新增，最重要）
顶部：系列标题、`+ 添加新一期`、`批量操作` 按钮。

表格/列表（移动端用卡片列表），每行一期：
```
☐  期号 2026115     发布: 11-12 20:00     公开: 11-13 21:30
   状态: 已公开  结果: ⏳待判定 / ✅中奖 / ❌未中
   [编辑]  [复制为下一期]  [立即公开]  [判中]  [判未中]  [删除]
```
顶部多选后出现批量操作条：
- 批量公开（把选中项 status=published 且 reveal_at=now()）
- 批量判中 / 批量判未中
- 批量下架 / 批量删除
- 批量改公开时间（弹日期选择器，统一覆盖 reveal_at）

支持"复制为下一期"：把当前期的 paid_content 作为草稿，期号自动 +1，发布/公开时间各 +1 周期（按彩种节奏，默认 +1 天），方便快速建下一期。

### 页面 4：`/merchant/products/$productId/issues/new` 与 `.../$issueId/edit`
表单只关注一期：期号、发布时间、公开时间、付费内容、（可选）结果。

### 页面 5：`/merchant/products/$productId/issues/bulk-import` —— 批量添加
一次性贴入多期。两种输入方式：
1. **文本粘贴**：每行一期，约定分隔符
   ```
   2026115 | 2026-11-12 20:00 | 2026-11-13 21:30 | 三肖：龙虎兔
   2026116 | 2026-11-13 20:00 | 2026-11-14 21:30 | 三肖：蛇马羊
   ```
2. **CSV 上传**：`issue_no, publish_at, reveal_at, paid_content`
解析后先在页面里以可编辑表格预览（每行可单独修改 / 删除），确认无误再点"全部提交"。

### 页面 6：买家详情页（小调整）
`/product/$productId` 默认展示"最新一期"（`product_issues` 按 publish_at desc 取第一条 publish_at <= now()），往期记录列表改为查 `product_issues` 而非 `product_history`。订单按 issue 判断是否已解锁。

## 操作总览（商家视角速览）

| 场景 | 路径 |
|---|---|
| 新建一个预测系列 | 商品列表 → 新增系列 |
| 当天发新一期 | 系列列表 → 管理期数 → +新一期（或在最新期上"复制为下一期"） |
| 一次发一周的预告 | 管理期数 → 批量添加 → 粘贴 7 行 → 预览 → 全部提交 |
| 修改某期内容 | 管理期数 → 编辑 |
| 开奖后公开答案 | 管理期数 → 勾选今日开奖的几期 → 批量公开 |
| 标记中奖结果 | 管理期数 → 勾选 → 批量判中 / 批量判未中 |
| 下架某期不再可买 | 管理期数 → 单条下架 或 批量下架 |

## 技术细节

- 迁移：使用 migration 工具创建 `product_issues` 表 + 索引 + RLS（商家自管自己系列下的期，admin 全权，published 期 select 公开）。
- 数据回填：用 insert 工具将 `products` 当期字段与 `product_history` 行迁入 `product_issues`。
- 修改 `purchase_product` SQL 函数：增加 `_issue_id` 入参，向 `orders` 写 `issue_id`，对应 `product_issues.sales_count` +1。
- `orders` 增加 `issue_id uuid` 列（可空）。
- 前端新增路由：`merchant.products.$productId.issues.tsx`、`merchant.products.$productId.issues.new.tsx`、`merchant.products.$productId.issues.$issueId.edit.tsx`、`merchant.products.$productId.issues.bulk-import.tsx`。
- 现有 `merchant.products.new.tsx` 移除"期号/付费内容/发布时间/公开时间"字段。
- 现有 `merchant.products.index.tsx` 新增"管理期数"入口；状态徽章改读最新一期。
- `product.$productId.tsx` 改为按最新一期渲染；购买按钮带上 issue_id。
- 给 demo 商家追加 5~10 期 demo 数据，覆盖 已公开-中 / 已公开-未中 / 待公开 / 草稿 等所有状态，方便点查。

## 不在本次范围

- 自动判中（依赖外部开奖数据源），仍由商家人工点"判中/判未中"。
- 多商家共用同一系列。
- 期数评论 / 退款。
