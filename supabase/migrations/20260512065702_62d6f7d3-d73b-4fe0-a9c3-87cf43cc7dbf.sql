-- Lift commission caps to 92% across the board
ALTER TABLE public.commission_config ALTER COLUMN l1_max_rate SET DEFAULT 0.92;
UPDATE public.commission_config SET l1_max_rate = 0.92 WHERE l1_max_rate < 0.92;
ALTER TABLE public.merchants ALTER COLUMN l1_max_rate SET DEFAULT 0.92;
UPDATE public.merchants SET l1_max_rate = 0.92 WHERE l1_max_rate < 0.92;