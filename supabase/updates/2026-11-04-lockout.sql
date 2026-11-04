-- Break-in protection for the owner dashboard + a security report.
-- * 3 failed sign-ins (wrong password or wrong 2-step code) from the same internet address
--   within an hour locks that address out for 1 hour. While locked, the database shows it
--   nothing, even with the right password and code.
-- * Each lockout, and any wrong 2-step code after a correct password, alerts you by
--   notification and email (through the notify-owner function; see NOTIFICATIONS-SETUP.md).
-- Safe to run more than once. The last result is your security report.

create table if not exists public.security_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ip          text not null default '',
  email       text not null default '',
  stage       text not null default 'password' check (stage in ('password', 'code')),
  user_agent  text not null default '',
  notified_at timestamptz
);
create index if not exists security_events_ip_at on public.security_events (ip, at desc);
alter table public.security_events enable row level security;
revoke all on public.security_events from anon, authenticated;
drop policy if exists security_events_owner_read on public.security_events;
create policy security_events_owner_read on public.security_events for select using (public.is_owner());
grant select on public.security_events to authenticated;

-- The visitor's internet address, as seen by Supabase
create or replace function public.client_ip() returns text
language sql stable as $$
  select coalesce(nullif(btrim(split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for',
             current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''), ',', 1)), ''), '')
$$;

-- When this address is locked until (null = not locked)
create or replace function public.lock_until(p_ip text default null) returns timestamptz
language sql stable security definer set search_path = public as $$
  with f as (
    select at from public.security_events
     where ip = coalesce(p_ip, public.client_ip()) and ip <> '' and at > now() - interval '1 hour'
     order by at desc limit 3)
  select case when count(*) >= 3 then min(at) + interval '1 hour' end from f
$$;

create or replace function public.ip_locked() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.lock_until() > now(), false) $$;

-- The sign-in page calls this after a failed try. Returns when the lock ends, if locked.
create or replace function public.report_failed_login(p_email text default '', p_stage text default 'password')
returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_ip text := public.client_ip(); v_ua text;
begin
  v_ua := left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 200);
  -- cap the log at 20 entries per address per hour so it can't be flooded
  if (select count(*) from public.security_events where ip = v_ip and at > now() - interval '1 hour') < 20 then
    insert into public.security_events (ip, email, stage, user_agent)
    values (v_ip, left(lower(btrim(coalesce(p_email, ''))), 120), case when p_stage = 'code' then 'code' else 'password' end, v_ua);
  end if;
  return json_build_object('locked_until', public.lock_until(v_ip));
end $$;

create or replace function public.login_lock_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('locked_until', public.lock_until())
$$;
grant execute on function public.report_failed_login(text, text) to anon, authenticated;
grant execute on function public.login_lock_status() to anon, authenticated;
revoke execute on function public.lock_until(text) from public, anon, authenticated;

-- A locked address sees nothing, even when signed in
create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role = any (roles)
      and (
        p.role = 'employee'
        or not public.mfa_required()
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
  ) and not public.ip_locked();
$$;

notify pgrst, 'reload schema';

-- ---------------- Security report ----------------
-- Every row should say ok. Anything else, send Claude a screenshot.
with t as (
  select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p'))
select 'Row Level Security on every table' as "check",
       case when bool_and(relrowsecurity) then 'ok' else 'FIX: off for ' || string_agg(relname, ', ') filter (where not relrowsecurity) end as result
  from t
union all
select '2-step code required for owner/manager', case when public.mfa_required() then 'ok' else 'FIX: turned off' end
union all
select 'People who can sign in',
       coalesce(string_agg(email || ' (' || role || case when active then '' else ', switched off' end || ')', ', '), 'none')
  from public.profiles
union all
select 'Invites not used yet',
       coalesce((select string_agg(email || ' (' || role || ')', ', ') from public.staff_invites where accepted_at is null), 'none — ok')
union all
select 'Owner has an authenticator set up',
       case when exists (select 1 from auth.mfa_factors f join public.profiles p on p.id = f.user_id
                          where p.role = 'owner' and f.status = 'verified') then 'ok' else 'FIX: no verified authenticator' end
union all
select 'Lockout after 3 failed tries', case when position('ip_locked' in pg_get_functiondef('public.has_role(public.app_role[])'::regprocedure)) > 0 then 'ok' else 'FIX' end
union all
select 'Failed sign-ins in the last 7 days',
       (select count(*)::text from public.security_events where at > now() - interval '7 days');
