-- 1) 商家保存时：自动按平台抽成推导 l1_max_rate
CREATE OR REPLACE FUNCTION public.validate_merchant_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg RECORD;
  v_effective_platform NUMERIC;
BEGIN
  SELECT platform_rate INTO v_cfg
    FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF NEW.platform_rate IS NOT NULL AND (NEW.platform_rate < 0 OR NEW.platform_rate > 1) THEN
    RAISE EXCEPTION '平台抽成需在 0-1 之间';
  END IF;

  v_effective_platform := COALESCE(NEW.platform_rate, v_cfg.platform_rate, 0);

  -- 上限 = 1 - 平台抽成（自动同步，忽略调用方传入的值）
  NEW.l1_max_rate := GREATEST(0, 1 - v_effective_platform);

  IF NEW.l1_rate IS NULL OR NEW.l1_rate < 0 THEN
    RAISE EXCEPTION '一级分成比例不能为空或为负';
  END IF;
  IF NEW.l1_rate > NEW.l1_max_rate THEN
    -- 自动截断到新上限，避免修改平台抽成后历史值阻塞保存
    NEW.l1_rate := NEW.l1_max_rate;
  END IF;

  NEW.l2_enabled := false;
  NEW.l2_rate := 0;

  RETURN NEW;
END;
$function$;

-- 2) 平台默认抽成变化时：同步所有未单独设置抽成的商家上限
CREATE OR REPLACE FUNCTION public.sync_merchants_max_on_platform_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.platform_rate IS DISTINCT FROM OLD.platform_rate THEN
    UPDATE public.merchants
       SET l1_max_rate = GREATEST(0, 1 - NEW.platform_rate),
           l1_rate = LEAST(l1_rate, GREATEST(0, 1 - NEW.platform_rate)),
           updated_at = now()
     WHERE platform_rate IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_merchants_max_on_platform_change ON public.commission_config;
CREATE TRIGGER trg_sync_merchants_max_on_platform_change
  AFTER UPDATE ON public.commission_config
  FOR EACH ROW EXECUTE FUNCTION public.sync_merchants_max_on_platform_change();

-- 3) 一次性回填现有商家
UPDATE public.merchants m
   SET l1_max_rate = GREATEST(0, 1 - COALESCE(m.platform_rate, c.platform_rate, 0)),
       l1_rate = LEAST(m.l1_rate, GREATEST(0, 1 - COALESCE(m.platform_rate, c.platform_rate, 0))),
       updated_at = now()
  FROM (SELECT platform_rate FROM public.commission_config ORDER BY updated_at DESC LIMIT 1) c;