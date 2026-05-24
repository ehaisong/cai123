
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('archive-revealed-products') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'archive-revealed-products'
);

SELECT cron.schedule(
  'archive-revealed-products',
  '5 16 * * *',
  $$ SELECT public.archive_revealed_products(); $$
);
