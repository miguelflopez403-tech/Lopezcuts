-- Safety pass, 2026-11-11. Safe to run more than once.
--
-- 1. Your phone number no longer shows in booking error messages on the public
--    site (booking paused, too many bookings, too late to cancel). They point
--    to Instagram instead, like the rest of the site.
-- 2. Extra locks on the database helpers (see the notes below).

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
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right.'; end if;
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
                                   price, new_client, source, client_message, created_by)
  values (v_client.id, p_staff_id, svc.id, v_addons, p_starts_at, p_starts_at + make_interval(mins => v_dur),
          v_price, v_new, 'online', coalesce(p_note, ''), null)
  returning * into v_appt;

  return json_build_object(
    'token', v_appt.manage_token, 'starts_at', v_appt.starts_at, 'ends_at', v_appt.ends_at,
    'price', v_price, 'new_client', v_new, 'service', svc.name, 'addons', v_add_names,
    'staff', (select display_name from public.staff where id = p_staff_id), 'status', v_appt.status);
exception
  when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
end $$;

create or replace function public.cancel_booking(p_token uuid, p_reason text default '') returns json
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; s public.settings%rowtype;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where manage_token = p_token for update;
  if not found then raise exception 'We couldn''t find that booking.'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'This booking can''t be cancelled anymore.'; end if;
  if a.starts_at <= now() + make_interval(hours => s.cancel_cutoff_hours) then
    raise exception 'It''s too close to your appointment to cancel online. Please reply to Miguel''s text or DM @lopezcuts.dmv on Instagram.';
  end if;
  update public.appointments
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client', cancel_reason = left(coalesce(p_reason, ''), 300)
   where id = a.id;
  return public.get_booking(p_token);
end $$;

-- Extra locks. None of these change how the site works.
-- 1. Pin where each helper looks things up, so nothing can be swapped in underneath it.
alter function public.mfa_required() set search_path = public;
alter function public.is_owner() set search_path = public;
alter function public.is_admin() set search_path = public;
alter function public.is_staff() set search_path = public;
alter function public.norm_phone(text) set search_path = public;
alter function public.client_ip() set search_path = public;
-- 2. Dashboard-only actions already check who is signed in. This also stops
--    visitors who aren't signed in from calling them at all.
revoke execute on function public.staff_book(uuid, text, text, text, uuid, uuid[], uuid, timestamptz, numeric, text, boolean, text) from public, anon;
revoke execute on function public.get_available_slots_staff(uuid, date, int) from public, anon;
revoke execute on function public.complete_appointment(uuid, numeric, numeric, public.pay_method, text) from public, anon;
revoke execute on function public.reopen_appointment(uuid) from public, anon;
grant execute on function public.staff_book(uuid, text, text, text, uuid, uuid[], uuid, timestamptz, numeric, text, boolean, text) to authenticated;
grant execute on function public.get_available_slots_staff(uuid, date, int) to authenticated;
grant execute on function public.complete_appointment(uuid, numeric, numeric, public.pay_method, text) to authenticated;
grant execute on function public.reopen_appointment(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Check: both should say true
select position('s.phone' in pg_get_functiondef('public.book_appointment(text,text,text,uuid,uuid[],uuid,timestamptz,text)'::regprocedure)) = 0 as phone_hidden,
       not has_function_privilege('anon', 'public.reopen_appointment(uuid)', 'execute') as dashboard_actions_locked;
