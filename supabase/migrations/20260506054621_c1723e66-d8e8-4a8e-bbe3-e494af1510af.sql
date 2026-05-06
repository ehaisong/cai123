
create or replace function public.resolve_ref_to_merchant(_ref text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _ref is null or length(_ref) = 0 then null
    when _ref like 'M_%' then (
      select m.id from public.merchants m
      where m.id::text = substring(_ref from 3) and m.status = 'approved'
    )
    else (
      select m.id
      from public.profiles p
      join public.agent_relations ar on ar.user_id = p.user_id
      join public.merchants m on m.id = ar.bound_merchant_id
      where p.user_code = _ref and ar.is_agent = true and m.status = 'approved'
      limit 1
    )
  end;
$$;

grant execute on function public.resolve_ref_to_merchant(text) to anon, authenticated;
