## 需求拆解

### 1. 在线/日访问量统计 + 商家客户关注列表
**新建表**：
- `page_visits`：记录每次页面访问（`user_id`、`merchant_id`、`path`、`session_id`、`created_at`）。RLS：仅 admin/对应商家可查；任何登录用户可插入。
- 通过 `session_id`（前端 sessionStorage 生成）+ 最近 5 分钟活跃判断"当前在线"。

**展示**：
- 平台首页 / 管理后台：加"当前在线 X 人 / 今日访问 Y 次"卡片。
- 商家后台首页（`merchant.index.tsx`）：显示"本店当前在线 / 今日访问 / 累计关注客户数"，并加"客户关注列表"页（复用现有 `shop_memberships` 中本店 user，关联 `profiles` 取微信昵称/avatar）。

### 2. 商品详情显示作者名 + 商家财务显示商品名
- `src/routes/product.$productId.tsx`：query 里把 `authors(name)` 也 select 出来，标题旁加 `作者：xxx`。
- `src/routes/merchant.finance.tsx`（商家财务订单列表）：订单 join `products(title, authors(name))`，把商品名/作者名直接渲染到每行。

### 3. 作者维度每日访问/购买统计
**新建表** `author_daily_stats`：(`author_id`, `date`, `views`, `purchases`)，唯一键 (author_id, date)。
- 浏览：商品详情页 mount 时调 RPC `bump_author_view(author_id)`，按当日 upsert +1。
- 购买：在订单支付成功后（`pay-notify` 或 trigger）按 `products.author_id` 累加 `purchases`。
- 商家"作者管理"页（`merchant.authors.tsx`）每行加"今日浏览/今日购买/累计"小数据。点击作者进入详情显示按天列表（最近 30 天）。

### 4. 红黑公开逻辑修正 + 次日自动归档历史
**当前状态**：代码已实现"公开后 status=unpublished, is_public=true 仍在店铺显示"。需要验证一次客户端实际是否生效，并补齐：

a) **公开仍可见**：保留现状（shop 查询已用 `status.eq.published,is_public.eq.true`），确认商品详情页对 `is_public=true` 时即使未购买也能看付费内容。

b) **次日自动归档**：
- 加 pg_cron 每日 00:05 调用一个 SQL 函数 `archive_revealed_products()`：
  - 找出 `result in ('won','lost') AND is_public=true AND publish_at < today` 的商品；
  - 把它写入 `product_history`（已有该表）；
  - 把原商品标记为已归档（新增 `archived_at` 字段或直接 `status='archived'` 且 `is_public=false`），从店铺首页消失。
- 这样"今天公开看红黑、明天新料一出旧的就进历史"。

---

## 待确认的关键问题

由于改动较大，且第 3、4 项有几种实现方式，先确认以下几点再动手：

1. **"当前在线"如何判定**？建议 = 最近 5 分钟有 page_visits 心跳的不重复用户。是否接受？（替代：用 Supabase Realtime presence，更精准但每客户端常驻一个 channel）

2. **作者每日统计的浏览**：每次进商品详情就 +1（含同一用户多次刷新），还是按 (author_id, user_id, date) 去重？

3. **红黑归档触发时机**：固定每天 0 点（北京时间）批量归档全部已揭晓的"公开"商品？还是按每条商品自己的 `reveal_at + 24h` 归档？

4. **关注列表的"关注"定义**：等于"进入过本店、写入了 shop_memberships 的客户"，对吗？还是要单独做一个"收藏/关注"按钮？

回答这 4 个问题后我会一次性下迁移 + 改代码。
