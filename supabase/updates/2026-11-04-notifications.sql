-- Phone notifications for the owner app (new bookings, client cancellations).
-- Safe to run more than once. See NOTIFICATIONS-SETUP.md for the rest of the setup.

-- Each phone that turned notifications on
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  endpoint        text not null unique check (endpoint like 'https://%'),
  p256dh          text not null,
  auth            text not null,
  device          text not null default '',
  notify_bookings boolean not null default true,
  notify_cancels  boolean not null default true,
  last_ok_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own_read on public.push_subscriptions;
create policy push_own_read on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_own_upd on public.push_subscriptions;
create policy push_own_upd on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_own_del on public.push_subscriptions;
create policy push_own_del on public.push_subscriptions for delete using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon;
revoke insert on public.push_subscriptions from authenticated;
revoke update on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant update (notify_bookings, notify_cancels, device) on public.push_subscriptions to authenticated;

-- The sending keys. Only the notify-owner function (service role) can read them.
create table if not exists public.push_keys (
  id          int primary key check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;

-- One notification per appointment per event, even if the webhook retries
create table if not exists public.push_sent (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  kind           text not null,
  sent_at        timestamptz not null default now(),
  primary key (appointment_id, kind)
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- Save this phone (signed-in team members only)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text default '')
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 1000 then raise exception 'That phone didn''t give a valid notification address.'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(coalesce(p_device, ''), 60))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('push_subscriptions', 'push_keys', 'push_sent')) = 3 as notifications_ready;  -- should say true
