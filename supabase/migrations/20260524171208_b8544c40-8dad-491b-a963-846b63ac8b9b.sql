
-- =========================
-- 1. page_visits
-- =========================
CREATE TABLE IF NOT EXISTS public.page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  merchant_id uuid,
  path text,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_visits_created_at ON public.page_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_merchant ON public.page_visits(merchant_id, created_at DESC);

ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY pv_insert_any ON public.page_visits FOR INSERT TO authenticated, anon
  WITH CHECK (true);
CREATE POLICY pv_admin_all ON public.page_visits FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY pv_select_merchant ON public.page_visits FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = page_visits.merchant_id AND m.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.record_visit(_merchant_id uuid, _path text, _session_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.page_visits(user_id, merchant_id, path, session_id)
  VALUES (auth.uid(), _merchant_id, _path, _session_id);
END $$;

CREATE OR REPLACE FUNCTION public.shop_visit_stats(_merchant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today_start timestamptz := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_online int;
  v_today int;
  v_followers int;
BEGIN
  -- 仅商家本人或管理员可查
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=_merchant_id AND m.user_id=auth.uid())) THEN
    RAISE EXCEPTION '无权查看';
  END IF;
  SELECT count(DISTINCT COALESCE(session_id, user_id::text)) INTO v_online
    FROM public.page_visits
   WHERE merchant_id=_merchant_id AND created_at >= now() - interval '5 minutes';
  SELECT count(*) INTO v_today
    FROM public.page_visits
   WHERE merchant_id=_merchant_id AND created_at >= v_today_start;
  SELECT count(*) INTO v_followers
    FROM public.shop_memberships WHERE merchant_id=_merchant_id;
  RETURN jsonb_build_object('online', v_online, 'today', v_today, 'followers', v_followers);
END $$;

CREATE OR REPLACE FUNCTION public.platform_visit_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today_start timestamptz := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_online int;
  v_today int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION '仅管理员可查';
  END IF;
  SELECT count(DISTINCT COALESCE(session_id, user_id::text)) INTO v_online
    FROM public.page_visits WHERE created_at >= now() - interval '5 minutes';
  SELECT count(*) INTO v_today
    FROM public.page_visits WHERE created_at >= v_today_start;
  RETURN jsonb_build_object('online', v_online, 'today', v_today);
END $$;

CREATE OR REPLACE FUNCTION public.shop_followers(_merchant_id uuid, _limit int DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb; BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=_merchant_id AND m.user_id=auth.uid())) THEN
    RAISE EXCEPTION '无权查看';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v
  FROM (
    SELECT sm.user_id,
           p.nickname,
           p.avatar_url,
           p.user_code,
           sm.joined_at,
           sm.is_agent
      FROM public.shop_memberships sm
      LEFT JOIN public.profiles p ON p.user_id = sm.user_id
     WHERE sm.merchant_id = _merchant_id
     ORDER BY sm.joined_at DESC
     LIMIT GREATEST(_limit,1)
  ) t;
  RETURN v;
END $$;

-- =========================
-- 2. author_daily_stats
-- =========================
CREATE TABLE IF NOT EXISTS public.author_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  date date NOT NULL,
  views int NOT NULL DEFAULT 0,
  purchases int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(author_id, date)
);
CREATE INDEX IF NOT EXISTS idx_ads_author_date ON public.author_daily_stats(author_id, date DESC);

ALTER TABLE public.author_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY ads_admin_all ON public.author_daily_stats FOR ALL
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY ads_select_merchant ON public.author_daily_stats FOR SELECT
  USING (EXISTS(SELECT 1 FROM public.authors a JOIN public.merchants m ON m.id=a.merchant_id
                WHERE a.id=author_daily_stats.author_id AND m.user_id=auth.uid()));

-- 去重表（按 author × user × date 只算一次浏览）
CREATE TABLE IF NOT EXISTS public.author_view_dedup (
  author_id uuid NOT NULL,
  user_id uuid NOT NULL,
  date date NOT NULL,
  PRIMARY KEY (author_id, user_id, date)
);
ALTER TABLE public.author_view_dedup ENABLE ROW LEVEL SECURITY;
-- 无对外策略，仅 SECURITY DEFINER 函数访问

CREATE OR REPLACE FUNCTION public.bump_author_view(_author_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_date date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_inserted boolean := false;
BEGIN
  IF _author_id IS NULL OR v_uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.author_view_dedup(author_id, user_id, date)
    VALUES (_author_id, v_uid, v_date)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted THEN
    INSERT INTO public.author_daily_stats(author_id, date, views, purchases)
      VALUES (_author_id, v_date, 1, 0)
      ON CONFLICT (author_id, date) DO UPDATE SET views = author_daily_stats.views + 1, updated_at = now();
  END IF;
END $$;

-- 订单付款后累加 purchases
CREATE OR REPLACE FUNCTION public.tr_order_paid_author_purchase_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_author uuid; v_date date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT author_id INTO v_author FROM public.products WHERE id = NEW.product_id;
    IF v_author IS NOT NULL THEN
      INSERT INTO public.author_daily_stats(author_id, date, views, purchases)
        VALUES (v_author, v_date, 0, 1)
        ON CONFLICT (author_id, date) DO UPDATE SET purchases = author_daily_stats.purchases + 1, updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_order_paid_author_purchase ON public.orders;
CREATE TRIGGER tr_order_paid_author_purchase
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tr_order_paid_author_purchase_fn();

-- 商家作者列表统计
CREATE OR REPLACE FUNCTION public.merchant_author_stats(_merchant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
  v_today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=_merchant_id AND m.user_id=auth.uid())) THEN
    RAISE EXCEPTION '无权查看';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v
  FROM (
    SELECT a.id, a.name, a.sort,
           COALESCE((SELECT views FROM public.author_daily_stats s WHERE s.author_id=a.id AND s.date=v_today),0) AS today_views,
           COALESCE((SELECT purchases FROM public.author_daily_stats s WHERE s.author_id=a.id AND s.date=v_today),0) AS today_purchases,
           COALESCE((SELECT sum(views) FROM public.author_daily_stats s WHERE s.author_id=a.id),0) AS total_views,
           COALESCE((SELECT sum(purchases) FROM public.author_daily_stats s WHERE s.author_id=a.id),0) AS total_purchases
      FROM public.authors a
     WHERE a.merchant_id = _merchant_id
     ORDER BY a.sort DESC, a.created_at DESC
  ) t;
  RETURN v;
END $$;

-- =========================
-- 3. merchant_finance：在订单流水中追加 issue_no、author_name
-- =========================
CREATE OR REPLACE FUNCTION public.merchant_finance(_from timestamp with time zone DEFAULT NULL,
                                                   _to timestamp with time zone DEFAULT NULL,
                                                   _limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_default_rate numeric;
  v_today_start timestamptz;
  v_yest_start timestamptz;
  v_month_start timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_summary jsonb;
  v_orders jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT COALESCE(platform_rate, 0) INTO v_default_rate FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;
  v_default_rate := COALESCE(v_default_rate, 0);
  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_yest_start  := v_today_start - interval '1 day';
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_from := COALESCE(_from, '1970-01-01'::timestamptz);
  v_to   := COALESCE(_to,   now() + interval '1 day');

  WITH my_merchants AS (
    SELECT id, COALESCE(platform_rate, v_default_rate) AS p_rate
      FROM public.merchants WHERE user_id = v_uid
  ),
  base AS (
    SELECT o.id, o.amount, o.paid_at, o.merchant_id, o.buyer_id, o.product_id,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, mm.p_rate), 2)) AS plat_fee,
           COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr WHERE cr.order_id = o.id), 0) AS agent_fee
      FROM public.orders o JOIN my_merchants mm ON mm.id = o.merchant_id
     WHERE o.status = 'paid'
  )
  SELECT jsonb_build_object(
    'today_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_today_start), 0),
    'today_gmv',        COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_today_start), 0),
    'today_orders',     COALESCE((SELECT count(*) FROM base WHERE paid_at >= v_today_start), 0),
    'yesterday_income', COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_yest_start AND paid_at < v_today_start), 0),
    'month_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_month_start), 0),
    'month_gmv',        COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_month_start), 0),
    'total_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base), 0),
    'total_gmv',        COALESCE((SELECT sum(amount) FROM base), 0),
    'total_orders',     COALESCE((SELECT count(*) FROM base), 0),
    'total_platform',   COALESCE((SELECT sum(plat_fee) FROM base), 0),
    'total_agent',      COALESCE((SELECT sum(agent_fee) FROM base), 0),
    'range_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_gmv',        COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_orders',     COALESCE((SELECT count(*) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0)
  ) INTO v_summary;

  WITH my_merchants AS (
    SELECT id, COALESCE(platform_rate, v_default_rate) AS p_rate
      FROM public.merchants WHERE user_id = v_uid
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_orders
  FROM (
    SELECT o.id AS order_id, o.amount,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, mm.p_rate), 2)) AS platform_fee,
           COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr WHERE cr.order_id = o.id), 0) AS agent_fee,
           o.amount - COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, mm.p_rate), 2))
             - COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr WHERE cr.order_id = o.id), 0) AS merchant_income,
           o.paid_at, o.buyer_id,
           bp.nickname AS buyer_nickname, bp.user_code AS buyer_code,
           p.title AS product_title, p.issue_no AS product_issue_no,
           au.name AS author_name
      FROM public.orders o
      JOIN my_merchants mm ON mm.id = o.merchant_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.products p ON p.id = o.product_id
      LEFT JOIN public.authors au ON au.id = p.author_id
     WHERE o.status = 'paid' AND o.paid_at >= v_from AND o.paid_at < v_to
     ORDER BY o.paid_at DESC LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN jsonb_build_object('summary', v_summary, 'orders', v_orders);
END $$;

-- =========================
-- 4. 红黑归档：写入 product_history，原商品下架
-- =========================
CREATE OR REPLACE FUNCTION public.archive_revealed_products()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, issue_no, paid_content, publish_at, result
      FROM public.products
     WHERE is_public = true
       AND result IN ('won','lost')
       AND (publish_at AT TIME ZONE 'Asia/Shanghai')::date < v_today
  LOOP
    INSERT INTO public.product_history(product_id, issue_no, content, publish_at, result)
      VALUES (r.id, COALESCE(r.issue_no,''), COALESCE(r.paid_content,''), r.publish_at, r.result);
    UPDATE public.products
       SET is_public = false, sort = 0, status = 'unpublished', updated_at = now()
     WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
