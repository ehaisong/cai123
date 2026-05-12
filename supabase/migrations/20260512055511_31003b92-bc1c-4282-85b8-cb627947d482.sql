-- Step 1: 彻底关闭 L2（二级代理）逻辑——从今往后停止，历史数据保留只读

-- 1) 删除遗留的旧版 purchase_product(uuid) 单参数函数（仍含 L2 分支）
DROP FUNCTION IF EXISTS public.purchase_product(uuid);

-- 2) 重写 bind_referrer，不再写 upline_l2_id
CREATE OR REPLACE FUNCTION public.bind_referrer(_agent_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_my RECORD;
  v_target_merchant UUID;
  v_upline RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT * INTO v_my FROM public.agent_relations WHERE user_id = v_uid;

  -- 商家直码：M_<merchant_id>
  IF _agent_code LIKE 'M\_%' ESCAPE '\' THEN
    v_target_merchant := (SUBSTR(_agent_code, 3))::uuid;
    IF v_my.is_agent = true THEN
      RETURN false;
    END IF;
    UPDATE public.agent_relations
       SET bound_merchant_id = v_target_merchant
     WHERE user_id = v_uid;
    RETURN true;
  END IF;

  -- 代理推荐码：profiles.user_code
  SELECT p.id, p.user_id INTO v_upline FROM public.profiles p WHERE p.user_code = _agent_code;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_upline.user_id = v_uid THEN RETURN false; END IF;

  SELECT bound_merchant_id INTO v_target_merchant
    FROM public.agent_relations WHERE user_id = v_upline.user_id;

  IF v_my.is_agent = true THEN
    RETURN false;
  END IF;

  -- 仅当未绑定上线时写入上线（不再写 upline_l2_id）
  IF v_my.upline_id IS NULL THEN
    UPDATE public.agent_relations SET
      upline_id = v_upline.id,
      bound_merchant_id = v_target_merchant
    WHERE user_id = v_uid;
    UPDATE public.profiles SET referrer_id = v_upline.id WHERE user_id = v_uid;
  ELSE
    UPDATE public.agent_relations SET bound_merchant_id = v_target_merchant
     WHERE user_id = v_uid;
  END IF;

  RETURN true;
END;
$function$;

-- 3) 关闭全局 L2 比例（从今往后即使有遗留 upline_l2_id 也按 0 计算）
UPDATE public.commission_config SET l2_rate = 0, l2_max_rate = 0, updated_at = now();

-- 4) 清空所有 agent_relations.upline_l2_id（停止形成新的 L2 链）
UPDATE public.agent_relations SET upline_l2_id = NULL WHERE upline_l2_id IS NOT NULL;