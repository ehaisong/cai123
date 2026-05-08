
create table if not exists public.payment_logs (
  id uuid primary key default gen_random_uuid(),
  order_no text,
  user_id uuid,
  source text not null, -- 'frontend' | 'gateway-notify'
  stage text not null,  -- create_request / create_response / jsapi_invoke / jsapi_result / oauth_redirect / oauth_resume / error / notify_received / notify_processed
  level text not null default 'info', -- info | warn | error
  message text,
  payload jsonb not null default '{}'::jsonb,
  user_agent text,
  ip text,
  created_at timestamp with time zone not null default now()
);

create index if not exists payment_logs_order_no_idx on public.payment_logs (order_no, created_at desc);
create index if not exists payment_logs_user_idx on public.payment_logs (user_id, created_at desc);
create index if not exists payment_logs_created_idx on public.payment_logs (created_at desc);

alter table public.payment_logs enable row level security;

drop policy if exists "pl_admin_all" on public.payment_logs;
create policy "pl_admin_all" on public.payment_logs
  for all using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "pl_insert_self" on public.payment_logs;
create policy "pl_insert_self" on public.payment_logs
  for insert
  with check (user_id is null or auth.uid() = user_id);

drop policy if exists "pl_select_self" on public.payment_logs;
create policy "pl_select_self" on public.payment_logs
  for select
  using (auth.uid() = user_id or has_role(auth.uid(), 'admin'::app_role));
