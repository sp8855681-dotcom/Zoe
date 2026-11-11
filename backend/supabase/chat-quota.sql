create table if not exists public.zoe_chat_daily_usage (
  user_id uuid not null,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_date)
);

create table if not exists public.zoe_chat_global_daily_usage (
  usage_date date primary key,
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.zoe_chat_daily_usage enable row level security;
alter table public.zoe_chat_global_daily_usage enable row level security;
revoke all on table public.zoe_chat_daily_usage from anon, authenticated;
revoke all on table public.zoe_chat_global_daily_usage from anon, authenticated;

create or replace function public.consume_zoe_chat_quota(
  p_user_id uuid,
  p_user_daily_limit integer,
  p_global_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date := (now() at time zone 'UTC')::date;
  v_user_count integer;
  v_global_count integer;
begin
  if p_user_id is null
    or p_user_daily_limit < 1
    or p_global_daily_limit < 1 then
    raise exception 'Invalid chat quota parameters.';
  end if;

  insert into public.zoe_chat_global_daily_usage (usage_date, request_count)
  values (v_usage_date, 0)
  on conflict (usage_date) do nothing;

  select request_count
  into v_global_count
  from public.zoe_chat_global_daily_usage
  where usage_date = v_usage_date
  for update;

  if v_global_count >= p_global_daily_limit then
    return jsonb_build_object('allowed', false, 'scope', 'global');
  end if;

  insert into public.zoe_chat_daily_usage (user_id, usage_date, request_count)
  values (p_user_id, v_usage_date, 0)
  on conflict (user_id, usage_date) do nothing;

  select request_count
  into v_user_count
  from public.zoe_chat_daily_usage
  where user_id = p_user_id and usage_date = v_usage_date
  for update;

  if v_user_count >= p_user_daily_limit then
    return jsonb_build_object('allowed', false, 'scope', 'account');
  end if;

  update public.zoe_chat_global_daily_usage
  set request_count = request_count + 1
  where usage_date = v_usage_date;

  update public.zoe_chat_daily_usage
  set request_count = request_count + 1
  where user_id = p_user_id and usage_date = v_usage_date;

  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.consume_zoe_chat_quota(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_zoe_chat_quota(uuid, integer, integer)
  to service_role;
