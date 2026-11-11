-- Lopezcuts: reminder email the day before an appointment.
-- Run this whole file once in Supabase → SQL Editor. Safe to run again.
--
-- How it works: once an hour the database checks for appointments that start in the
-- next 12 to 24 hours. If there are any, it calls the notify-owner function, which
-- emails each client who gave an email. Every appointment time is reminded once only.
-- Bookings made less than about a day ahead skip the reminder (they just got the
-- confirmation email). Turn all client emails off with settings.email_clients = false.

create table if not exists public.email_reminders (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  starts_at      timestamptz not null,
  claimed_at     timestamptz not null default now(),
  primary key (appointment_id, starts_at)
);
alter table public.email_reminders enable row level security;
revoke all on public.email_reminders from anon, authenticated;

-- Which appointments are due a reminder right now.
create or replace function public.due_email_reminders()
returns table (appointment_id uuid, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.starts_at
    from appointments a
    join clients c on c.id = a.client_id
   where a.status in ('booked', 'confirmed')
     and a.starts_at >  now() + interval '12 hours'
     and a.starts_at <= now() + interval '24 hours'
     and a.created_at < now() - interval '3 hours'
     and c.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and coalesce((select s.email_clients from settings s where s.id = 1), true)
     and not exists (select 1 from email_reminders r where r.appointment_id = a.id and r.starts_at = a.starts_at);
$$;

-- Called by the notify-owner function: marks the due ones as taken so no one is emailed twice.
create or replace function public.claim_email_reminders()
returns setof uuid
language sql security definer set search_path = public as $$
  insert into email_reminders (appointment_id, starts_at)
  select d.appointment_id, d.starts_at from due_email_reminders() d
  on conflict do nothing
  returning appointment_id;
$$;

-- Called every hour: wakes the notify-owner function only when something is due.
-- It reuses the address and key of the notify-owner webhook that already exists on appointments.
create or replace function public.send_email_reminders()
returns text
language plpgsql security definer set search_path = public as $$
declare v_args text[];
begin
  if not exists (select 1 from due_email_reminders()) then return 'nothing due'; end if;
  select string_to_array(encode(t.tgargs, 'escape'), '\000') into v_args
    from pg_trigger t
   where t.tgrelid = 'public.appointments'::regclass and not t.tgisinternal
     and encode(t.tgargs, 'escape') like '%/functions/v1/notify-owner%'
   limit 1;
  if v_args is null then return 'notify-owner webhook not found'; end if;
  perform net.http_post(url := v_args[1], headers := v_args[3]::jsonb, body := '{"cron":"reminders"}'::jsonb);
  return 'called';
end $$;

revoke all on function public.due_email_reminders()   from public, anon, authenticated;
revoke all on function public.claim_email_reminders() from public, anon, authenticated;
revoke all on function public.send_email_reminders()  from public, anon, authenticated;
grant execute on function public.claim_email_reminders() to service_role;

-- The hourly schedule.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('lopezcuts-email-reminders') where exists (select 1 from cron.job where jobname = 'lopezcuts-email-reminders');
  perform cron.schedule('lopezcuts-email-reminders', '7 * * * *', 'select public.send_email_reminders()');
exception when others then
  raise notice 'Could not set the hourly schedule: %', sqlerrm;
end $$;

-- Check: both should say true
select exists (select 1 from pg_proc where proname = 'claim_email_reminders') as reminders_ready,
       coalesce((select true from pg_namespace where nspname = 'cron')
                and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cron' and p.proname = 'schedule'), false) as schedule_ready;
