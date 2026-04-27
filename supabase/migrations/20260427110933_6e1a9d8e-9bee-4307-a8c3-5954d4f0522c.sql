-- 为 Demo 演示店铺的 4 个商品追加覆盖各状态的演示期数
-- 状态覆盖：草稿 / 已下架 / 未来发布(待公开) / 已发布待判定 / 已中 / 已未中

DO $$
DECLARE
  p1 UUID := '97606bfa-ac22-48dd-83fd-e97825eac989'; -- 福彩3D 独胆精选
  p2 UUID := 'd40c99d7-0bc7-464b-8954-ce0d8d578fce'; -- 福彩3D 组三组六
  p3 UUID := 'abcf92de-6988-4f26-b788-5144eb4f88bd'; -- 六合彩 生肖分析
  p4 UUID := 'ee7f2789-180b-4bab-8c1e-166b4740e551'; -- 竞彩 足彩周末
BEGIN

-- ============ 福彩3D 独胆精选 ============
INSERT INTO public.product_issues (product_id, issue_no, paid_content, publish_at, reveal_at, status, result, result_note, sales_count) VALUES
  (p1, '2024095', E'独胆参考：5\n双胆参考：5、8\n杀号：0、3', now() - interval '6 days', now() - interval '5 days', 'published', 'won', '开奖 583，独胆 5 命中', 28),
  (p1, '2024096', E'独胆参考：2\n双胆参考：2、7\n杀号：4、9', now() - interval '5 days', now() - interval '4 days', 'published', 'lost', '开奖 469，独胆未中', 22),
  (p1, '2024097', E'独胆参考：8\n双胆参考：8、1\n杀号：3、6', now() - interval '4 days', now() - interval '3 days', 'published', 'won', '开奖 812，独胆 8 命中', 31),
  (p1, '2024098', E'独胆参考：3\n双胆参考：3、6\n杀号：0、7', now() - interval '2 days', now() - interval '1 day', 'published', 'pending', NULL, 18),
  (p1, '2024099', E'独胆参考：4\n双胆参考：4、9\n杀号：1、8', now() + interval '6 hours', now() + interval '1 day', 'published', 'pending', NULL, 0),
  (p1, '2024100', E'独胆参考：（待发布）\n本期为草稿', now() + interval '2 days', now() + interval '3 days', 'draft', 'pending', NULL, 0),
  (p1, '2024089', E'历史下架内容', now() - interval '15 days', now() - interval '14 days', 'unpublished', 'won', '已下架旧期', 5);

-- ============ 福彩3D 组三组六 ============
INSERT INTO public.product_issues (product_id, issue_no, paid_content, publish_at, reveal_at, status, result, result_note, sales_count) VALUES
  (p2, '2024095', E'形态预测：组六\n推荐组合：1、5、8 / 2、4、7', now() - interval '6 days', now() - interval '5 days', 'published', 'won', '开奖 158，组六命中', 19),
  (p2, '2024096', E'形态预测：组三\n推荐组合：33X、77X', now() - interval '5 days', now() - interval '4 days', 'published', 'lost', '开奖 469 为组六', 14),
  (p2, '2024097', E'形态预测：组六\n推荐组合：0、3、6 / 2、5、9', now() - interval '3 days', now() - interval '2 days', 'published', 'pending', NULL, 16),
  (p2, '2024098', E'形态预测：组三\n推荐组合：22X、88X', now() + interval '12 hours', now() + interval '1 day 12 hours', 'published', 'pending', NULL, 0),
  (p2, '2024099', E'形态预测：（编辑中）', now() + interval '3 days', now() + interval '4 days', 'draft', 'pending', NULL, 0);

-- ============ 六合彩 生肖参考 ============
INSERT INTO public.product_issues (product_id, issue_no, paid_content, publish_at, reveal_at, status, result, result_note, sales_count) VALUES
  (p3, '2024050', E'本期主推生肖：龙、虎\n备选：兔、蛇', now() - interval '8 days', now() - interval '6 days', 'published', 'won', '开龙', 42),
  (p3, '2024051', E'本期主推生肖：猴、鸡\n备选：狗、马', now() - interval '5 days', now() - interval '3 days', 'published', 'lost', '开猪', 35),
  (p3, '2024052', E'本期主推生肖：牛、羊\n备选：鼠、猪', now() - interval '2 days', now() + interval '1 day', 'published', 'pending', NULL, 24),
  (p3, '2024053', E'本期主推生肖：（待公开）', now() + interval '1 day', now() + interval '4 days', 'published', 'pending', NULL, 0),
  (p3, '2024054', E'草稿，资料整理中', now() + interval '4 days', now() + interval '7 days', 'draft', 'pending', NULL, 0),
  (p3, '2024048', E'下架旧期内容', now() - interval '20 days', now() - interval '18 days', 'unpublished', 'lost', '已下架', 3);

-- ============ 竞彩 周末精选 ============
INSERT INTO public.product_issues (product_id, issue_no, paid_content, publish_at, reveal_at, status, result, result_note, sales_count) VALUES
  (p4, 'W42', E'周六 5 场推荐：\n1. 曼城 -1 让胜\n2. 拜仁 主胜\n3. 国米 平/胜\n4. 巴萨 主胜\n5. 巴黎 -1 让胜', now() - interval '10 days', now() - interval '8 days', 'published', 'won', '5 中 4', 56),
  (p4, 'W43', E'周末 5 场推荐：\n1. 阿森纳 主胜\n2. 利物浦 让平\n3. 多特 客胜\n4. 皇马 -1\n5. 那不勒斯 主胜', now() - interval '4 days', now() - interval '2 days', 'published', 'lost', '5 中 2', 38),
  (p4, 'W44', E'本周末 5 场推荐已更新，购买后查看', now() - interval '1 day', now() + interval '2 days', 'published', 'pending', NULL, 27),
  (p4, 'W45', E'下周末预测（待公开）', now() + interval '5 days', now() + interval '7 days', 'published', 'pending', NULL, 0),
  (p4, 'W46', E'草稿，赛程整理中', now() + interval '10 days', now() + interval '12 days', 'draft', 'pending', NULL, 0);

END $$;
