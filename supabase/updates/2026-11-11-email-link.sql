-- Lopezcuts: email required when booking + "Email me my link" in My appointment.
-- Run this whole file once in Supabase → SQL Editor. Safe to run again.

-- 1. Each online booking keeps the email typed for THAT booking. Its confirmation, reminder
--    and booking link only ever go to that address, so nobody can redirect another
--    client's emails by booking with their phone number.
alter table public.appointments add column if not exists contact_email text;

-- 2. Booking online now needs an email.
create or replace function public.book_appointment(
  p_name text, p_phone text, p_email text, p_service_id uuid, p_addon_ids uuid[],
  p_staff_id uuid, p_starts_at timestamptz, p_note text default '')
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s          public.settings%rowtype;
  svc        public.services%rowtype;
  v_phone    text := public.norm_phone(p_phone);
  v_email    text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name     text := btrim(coalesce(p_name, ''));
  v_client   public.clients%rowtype;
  v_addons   uuid[];
  v_add_names text[];
  v_add_price numeric := 0;
  v_add_dur  int := 0;
  v_dur      int;
  v_new      boolean;
  v_price    numeric;
  v_active   int;
  v_appt     public.appointments%rowtype;
begin
  select * into s from public.settings where id = 1;
  if not s.booking_open then raise exception 'Online booking is paused right now. Please DM @lopezcuts.dmv on Instagram to book.'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if v_phone is null then raise exception 'Please enter a valid phone number.'; end if;
  if v_email is null then raise exception 'Please enter your email so we can send your confirmation.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'That email address doesn''t look right.'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Please keep your note under 500 characters.'; end if;

  select * into svc from public.services where id = p_service_id and active and bookable and not is_addon;
  if not found then raise exception 'Please choose a service.'; end if;

  select coalesce(array_agg(id order by sort), '{}'), coalesce(array_agg(name order by sort), '{}'),
         coalesce(sum(price), 0), coalesce(sum(duration_min), 0)
    into v_addons, v_add_names, v_add_price, v_add_dur
  from public.services where id = any (coalesce(p_addon_ids, '{}')) and active and is_addon;

  v_dur := svc.duration_min + v_add_dur;

  if not exists (
    select 1 from public.get_available_slots(p_staff_id, (p_starts_at at time zone s.timezone)::date, v_dur) t
    where t = p_starts_at) then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
  end if;

  select * into v_client from public.clients where phone = v_phone for update;
  if not found then
    insert into public.clients (full_name, phone, email, source, created_by)
    values (v_name, v_phone, v_email, 'online', null) returning * into v_client;
  else
    if v_client.blocked then raise exception 'Online booking isn''t available for this number. Please DM @lopezcuts.dmv on Instagram to book.'; end if;
    if v_email is not null and v_client.email is null then
      update public.clients set email = v_email where id = v_client.id;
    end if;
  end if;

  select count(*) into v_active from public.appointments
  where client_id = v_client.id and status in ('booked', 'confirmed') and starts_at > now();
  if v_active >= s.max_active_bookings then
    raise exception 'You already have % upcoming bookings. DM @lopezcuts.dmv on Instagram if you need another.', v_active;
  end if;

  v_new := v_client.prior_visits = 0
           and not exists (select 1 from public.appointments where client_id = v_client.id and status = 'completed');
  if svc.first_visit_only and not v_new then
    raise exception 'Welcome back! That option is for first visits. Please pick the returning client haircut.';
  end if;
  v_price := case when v_new and svc.new_client_price is not null then svc.new_client_price else svc.price end + v_add_price;

  insert into public.appointments (client_id, staff_id, service_id, addon_ids, starts_at, ends_at,
                                   price, new_client, source, client_message, created_by, contact_email)
  values (v_client.id, p_staff_id, svc.id, v_addons, p_starts_at, p_starts_at + make_interval(mins => v_dur),
          v_price, v_new, 'online', coalesce(p_note, ''), null, v_email)
  returning * into v_appt;

  return json_build_object(
    'token', v_appt.manage_token, 'starts_at', v_appt.starts_at, 'ends_at', v_appt.ends_at,
    'price', v_price, 'new_client', v_new, 'service', svc.name, 'addons', v_add_names,
    'staff', (select display_name from public.staff where id = p_staff_id), 'status', v_appt.status);
exception
  when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
end $$;

-- 3. The lookup stays view-only. It also says whether a booking link can be emailed.
create or replace function public.find_appointment(p_phone text, p_first_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ip    text := public.client_ip();
  v_phone text := public.norm_phone(p_phone);
  v_first text := lower(regexp_replace(split_part(btrim(coalesce(p_first_name, '')), ' ', 1), '[^[:alpha:]]', '', 'g'));
  v_client public.clients%rowtype;
  v_list json;
begin
  if v_phone is null then raise exception 'Please enter the mobile number you booked with.'; end if;
  if length(v_first) < 1 then raise exception 'Please enter your first name.'; end if;

  delete from public.lookup_attempts where at < now() - interval '1 day';
  if (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and ip = v_ip and v_ip <> '') >= 8
     or (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and phone = v_phone) >= 5 then
    raise exception 'Too many tries. Please wait an hour, or DM @lopezcuts.dmv on Instagram.';
  end if;

  select * into v_client from public.clients c
   where c.phone = v_phone
     and lower(regexp_replace(split_part(btrim(c.full_name), ' ', 1), '[^[:alpha:]]', '', 'g')) = v_first;

  if not found then
    insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, false);
    return json_build_object('found', false, 'appointments', '[]'::json);
  end if;

  insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, true);
  select coalesce(json_agg(x order by x.starts_at), '[]'::json) into v_list from (
    select a.starts_at, a.ends_at, a.status, a.price,
           (coalesce(a.contact_email, v_client.email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') as can_email,
           sv.name as service, st.display_name as staff,
           (select coalesce(array_agg(z.name), '{}') from public.services z where z.id = any (a.addon_ids)) as addons
      from public.appointments a
      join public.staff st on st.id = a.staff_id
      left join public.services sv on sv.id = a.service_id
     where a.client_id = v_client.id and a.status in ('booked', 'confirmed') and a.ends_at > now()
     order by a.starts_at
     limit 5) x;

  return json_build_object('found', true, 'first_name', split_part(btrim(v_client.full_name), ' ', 1), 'appointments', v_list);
end $$;
revoke execute on function public.find_appointment(text, text) from public;
grant execute on function public.find_appointment(text, text) to anon, authenticated;


-- 4. Reminders use the booking's own email first.
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
     and coalesce(a.contact_email, c.email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and coalesce((select s.email_clients from settings s where s.id = 1), true)
     and not exists (select 1 from email_reminders r where r.appointment_id = a.id and r.starts_at = a.starts_at);
$$;


-- 5. "Email me my link": the lookup screen can ask for the private booking link to be
--    emailed. It is only ever sent to the email already on the booking.
create table if not exists public.link_requests (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
alter table public.link_requests enable row level security;
revoke all on public.link_requests from anon, authenticated;

create or replace function public.request_booking_link(p_phone text, p_first_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ip    text := public.client_ip();
  v_phone text := public.norm_phone(p_phone);
  v_first text := lower(regexp_replace(split_part(btrim(coalesce(p_first_name, '')), ' ', 1), '[^[:alpha:]]', '', 'g'));
  v_client public.clients%rowtype;
  v_args  text[];
begin
  if v_phone is null then raise exception 'Please enter the mobile number you booked with.'; end if;
  if length(v_first) < 1 then raise exception 'Please enter your first name.'; end if;
  if (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and ip = v_ip and v_ip <> '') >= 8
     or (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and phone = v_phone) >= 5 then
    raise exception 'Too many tries. Please wait an hour, or DM @lopezcuts.dmv on Instagram.';
  end if;

  select * into v_client from public.clients c
   where c.phone = v_phone
     and lower(regexp_replace(split_part(btrim(c.full_name), ' ', 1), '[^[:alpha:]]', '', 'g')) = v_first;
  if not found then
    insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, false);
    return json_build_object('sent', false);
  end if;

  if not exists (select 1 from public.appointments a
                  where a.client_id = v_client.id and a.status in ('booked', 'confirmed') and a.ends_at > now()
                    and coalesce(a.contact_email, v_client.email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return json_build_object('sent', false);
  end if;

  delete from public.link_requests where created_at < now() - interval '1 day';
  if (select count(*) from public.link_requests where client_id = v_client.id and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'We already emailed your link. Check your inbox and spam folder, or try again in an hour.';
  end if;
  insert into public.link_requests (client_id) values (v_client.id);

  -- wake the notify-owner function (same address and key as the appointments webhook)
  select string_to_array(encode(t.tgargs, 'escape'), '\000') into v_args
    from pg_trigger t
   where t.tgrelid = 'public.appointments'::regclass and not t.tgisinternal
     and encode(t.tgargs, 'escape') like '%/functions/v1/notify-owner%'
   limit 1;
  if v_args is null then raise exception 'We couldn''t send the email right now. Please DM @lopezcuts.dmv on Instagram.'; end if;
  perform net.http_post(url := v_args[1], headers := v_args[3]::jsonb, body := '{"cron":"links"}'::jsonb);
  return json_build_object('sent', true);
end $$;
revoke execute on function public.request_booking_link(text, text) from public;
grant execute on function public.request_booking_link(text, text) to anon, authenticated;

-- Called by the notify-owner function: hands out each fresh request once.
create or replace function public.claim_link_requests()
returns setof uuid
language sql security definer set search_path = public as $$
  update link_requests set claimed_at = now()
   where claimed_at is null and created_at > now() - interval '15 minutes'
  returning client_id;
$$;
revoke all on function public.claim_link_requests() from public, anon, authenticated;
grant execute on function public.claim_link_requests() to service_role;

notify pgrst, 'reload schema';

-- Check: all three should say true
select exists (select 1 from pg_proc where proname = 'request_booking_link') as link_ready,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name = 'contact_email') as email_ready,
       pg_get_functiondef('public.find_appointment(text, text)'::regprocedure) not like '%manage_token%' as lookup_view_only;
