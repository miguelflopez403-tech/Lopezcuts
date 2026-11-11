-- Reschedule in one step + client confirmation emails. Safe to run more than once.
-- Run this AFTER 2026-11-03-auto-texts.sql (it updates the texts trigger).
--
-- 1. Clients can move their own booking to another open time from their
--    booking link, up to the same cutoff as cancelling (6 hours by default).
-- 2. A switch for client confirmation emails (Settings can turn it off later).

alter table public.settings add column if not exists email_clients boolean not null default true;

-- What the client sees on their private booking link (now also says whether
-- it can be moved, and what the picker needs to show open times).
create or replace function public.get_booking(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'first_name', split_part(c.full_name, ' ', 1),
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'price', a.price,
    'service', sv.name, 'staff', st.display_name,
    'staff_id', a.staff_id,
    'duration_min', (extract(epoch from (a.ends_at - a.starts_at)) / 60)::int,
    'addons', (select coalesce(array_agg(x.name), '{}') from public.services x where x.id = any (a.addon_ids)),
    'can_cancel', a.status in ('booked', 'confirmed')
                  and a.starts_at > now() + make_interval(hours => s.cancel_cutoff_hours),
    'can_reschedule', a.status in ('booked', 'confirmed')
                  and a.starts_at > now() + make_interval(hours => s.cancel_cutoff_hours),
    'can_confirm', a.status = 'booked' and a.starts_at > now(),
    'can_review', a.status = 'completed' and a.completed_at > now() - interval '60 days'
                  and not exists (select 1 from public.reviews r where r.appointment_id = a.id),
    'reviewed', exists (select 1 from public.reviews r where r.appointment_id = a.id))
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.staff st on st.id = a.staff_id
  left join public.services sv on sv.id = a.service_id
  cross join public.settings s
  where a.manage_token = p_token and s.id = 1;
$$;

-- Move a booking to another open time. Only works with the private booking
-- link, only for upcoming bookings, and only into a time that is really open.
create or replace function public.reschedule_booking(p_token uuid, p_starts_at timestamptz) returns json
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; s public.settings%rowtype; v_dur int;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where manage_token = p_token for update;
  if not found then raise exception 'We couldn''t find that booking.'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'This booking can''t be changed anymore.'; end if;
  if a.starts_at <= now() + make_interval(hours => s.cancel_cutoff_hours) then
    raise exception 'It''s too close to your appointment to change it online. Please reply to Miguel''s text or DM @lopezcuts.dmv on Instagram.';
  end if;
  if p_starts_at is null or p_starts_at = a.starts_at then raise exception 'Please pick a different time.'; end if;
  v_dur := (extract(epoch from (a.ends_at - a.starts_at)) / 60)::int;
  if not exists (
    select 1 from public.get_available_slots(a.staff_id, (p_starts_at at time zone s.timezone)::date, v_dur) t
    where t = p_starts_at) then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
  end if;
  -- tells the texts trigger the client moved it (so no "Miguel moved your appointment" text)
  perform set_config('lopezcuts.moved_by', 'client', true);
  update public.appointments
     set starts_at = p_starts_at, ends_at = p_starts_at + make_interval(mins => v_dur), reminder_sent_at = null
   where id = a.id;
  return public.get_booking(p_token);
exception
  when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
end $$;
revoke execute on function public.reschedule_booking(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking(uuid, timestamptz) to anon, authenticated;

-- Same trigger as before, except a move the client made themselves doesn't
-- queue the "Miguel moved your appointment" text.
create or replace function public.appointments_texts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('booked', 'confirmed') and new.starts_at > now() then perform public.queue_sms('booked', new.id); end if;
  elsif new.status = 'cancelled' and old.status in ('booked', 'confirmed') and coalesce(new.cancelled_by, 'shop') = 'shop' and new.starts_at > now() then
    perform public.queue_sms('cancelled', new.id);
  elsif new.status in ('booked', 'confirmed') and old.status in ('booked', 'confirmed') and new.starts_at <> old.starts_at and new.starts_at > now()
        and coalesce(current_setting('lopezcuts.moved_by', true), '') <> 'client' then
    perform public.queue_sms('rescheduled', new.id);
  end if;
  return null;
end $$;

notify pgrst, 'reload schema';

-- Check: both should say true
select exists (select 1 from pg_proc where proname = 'reschedule_booking') as reschedule_ready,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'email_clients') as client_emails_ready;
