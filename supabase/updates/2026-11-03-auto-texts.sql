-- =====================================================================
--  Update for the LIVE database: automatic texts (safe to run again)
--  Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
--  Nothing is sent until you switch texts on in the dashboard
--  (Settings -> Texts) and connect Twilio. See TEXTS-SETUP.md.
-- =====================================================================

-- =====================================================================
--  AUTOMATIC TEXTS (off until Settings → Texts is switched on and a
--  Twilio account is connected to the send-text Edge Function).
--  Appointments drop a message into sms_outbox; the Edge Function sends
--  it through Twilio and records the result. Only owner/manager can read
--  the log. Visitors and employees can't read or write it.
-- =====================================================================
alter table public.settings add column if not exists sms_enabled boolean not null default false;
alter table public.settings add column if not exists sms_followup_hour int not null default 11 check (sms_followup_hour between 6 and 21);
alter table public.settings add column if not exists site_url text not null default 'https://www.lopezcuts.com';

create table if not exists public.sms_outbox (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments (id) on delete cascade,
  client_id       uuid references public.clients (id) on delete set null,
  kind            text not null check (kind in ('booked', 'rescheduled', 'cancelled', 'followup')),
  to_phone        text not null,
  body            text not null,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists sms_outbox_created_idx on public.sms_outbox (created_at desc);
alter table public.sms_outbox enable row level security;
drop policy if exists sms_outbox_admin_read on public.sms_outbox;
create policy sms_outbox_admin_read on public.sms_outbox for select to authenticated using (public.is_admin());
revoke all on public.sms_outbox from anon;
revoke insert, update, delete on public.sms_outbox from authenticated;

-- Builds the words of each text. Edit the wording here.
create or replace function public.sms_body(p_kind text, p_appt uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  s public.settings%rowtype; a public.appointments%rowtype; c public.clients%rowtype;
  v_first text; v_when text; v_svc text; v_link text; v_site text; v_visits int;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where id = p_appt;
  select * into c from public.clients where id = a.client_id;
  v_first := split_part(trim(c.full_name), ' ', 1);
  v_when := to_char(a.starts_at at time zone s.timezone, 'FMDay, FMMon FMDD "at" FMHH12:MI AM');
  v_svc := coalesce((select name from public.services where id = a.service_id), 'haircut');
  v_site := rtrim(s.site_url, '/');
  v_link := v_site || '/#manage-' || a.manage_token;
  if p_kind = 'booked' then
    return format(E'Hi %s! Your booking with %s went through: %s (%s).\nMiguel will text you the day of your appointment.\nNeed to change it? %s\nReply STOP to opt out.',
                  v_first, s.business_name, v_when, v_svc, v_link);
  elsif p_kind = 'rescheduled' then
    return format(E'Hi %s, Miguel moved your %s appointment to %s.\nIf that time doesn''t work, change it here: %s or text %s.',
                  v_first, s.business_name, v_when, v_link, s.phone);
  elsif p_kind = 'cancelled' then
    return format(E'Hi %s, sorry! Miguel had to cancel your %s appointment on %s.%s\nBook a new time here: %s',
                  v_first, s.business_name, v_when,
                  case when coalesce(a.cancel_reason, '') <> '' then E'\nNote: ' || a.cancel_reason else '' end, v_site);
  else
    v_visits := c.prior_visits + (select count(*) from public.appointments where client_id = c.id and status = 'completed');
    if a.new_client or v_visits <= 1 then
      return format(E'Thanks for coming in, %s! Hope you love the cut.\nReady for the next one? Book anytime: %s\nIf you have a minute, a quick review helps me a lot: %s\nKnow someone who needs a cut? Send them %s (first cuts are $25).',
                    v_first, v_site, v_link, v_site);
    end if;
    return format(E'Thanks for coming in, %s! Book your next cut anytime: %s\nA quick review helps a lot: %s\nAnd send your friends my way: %s',
                  v_first, v_site, v_link, v_site);
  end if;
end $$;
revoke execute on function public.sms_body(text, uuid) from public, anon, authenticated;

create or replace function public.queue_sms(p_kind text, p_appt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text; v_client uuid;
begin
  if not coalesce((select sms_enabled from public.settings where id = 1), false) then return; end if;
  select c.phone, c.id into v_phone, v_client from public.appointments a join public.clients c on c.id = a.client_id where a.id = p_appt;
  if v_phone is null or length(v_phone) < 11 then return; end if;
  insert into public.sms_outbox (appointment_id, client_id, kind, to_phone, body)
  values (p_appt, v_client, p_kind, '+' || v_phone, public.sms_body(p_kind, p_appt));
exception when others then
  raise warning 'Text not queued: %', sqlerrm;  -- a text problem must never block a booking
end $$;
revoke execute on function public.queue_sms(text, uuid) from public, anon, authenticated;

create or replace function public.appointments_texts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('booked', 'confirmed') and new.starts_at > now() then perform public.queue_sms('booked', new.id); end if;
  elsif new.status = 'cancelled' and old.status in ('booked', 'confirmed') and coalesce(new.cancelled_by, 'shop') = 'shop' and new.starts_at > now() then
    perform public.queue_sms('cancelled', new.id);
  elsif new.status in ('booked', 'confirmed') and old.status in ('booked', 'confirmed') and new.starts_at <> old.starts_at and new.starts_at > now() then
    perform public.queue_sms('rescheduled', new.id);
  end if;
  return null;
end $$;
drop trigger if exists appointments_texts on public.appointments;
create trigger appointments_texts after insert or update of status, starts_at on public.appointments
  for each row execute function public.appointments_texts();

-- Day-after thank-you texts. Runs every hour; sends at the hour set in
-- Settings (local time) for yesterday's finished visits that haven't
-- had a thank-you yet and haven't left a review.
create or replace function public.queue_followups()
returns int language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; r record; n int := 0; v_today date;
begin
  select * into s from public.settings where id = 1;
  if not s.sms_enabled then return 0; end if;
  if extract(hour from now() at time zone s.timezone) <> s.sms_followup_hour then return 0; end if;
  v_today := (now() at time zone s.timezone)::date;
  for r in
    select a.id from public.appointments a
    where a.status = 'completed' and a.followup_sent_at is null
      and (a.starts_at at time zone s.timezone)::date = v_today - 1
      and not exists (select 1 from public.reviews rv where rv.appointment_id = a.id)
  loop
    perform public.queue_sms('followup', r.id);
    update public.appointments set followup_sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_followups() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('lopezcuts-followups') where exists (select 1 from cron.job where jobname = 'lopezcuts-followups');
  perform cron.schedule('lopezcuts-followups', '2 * * * *', 'select public.queue_followups()');
exception when others then
  raise notice 'Cron is not on yet: in Supabase open Integrations → Cron, enable it, then run this file again.';
end $$;

-- Check: should say texts_ready = true
select exists (select 1 from pg_proc where proname = 'queue_followups') as texts_ready;
