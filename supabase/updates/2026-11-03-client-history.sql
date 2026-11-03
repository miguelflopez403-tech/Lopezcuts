-- =====================================================================
--  Update for the LIVE database: client history (run once; safe to repeat)
--  Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
--
--  1. Each client can carry their Booksy visit count and last Booksy visit.
--  2. Visit counts and last visit cover a client's whole history
--     (before, the dashboard only looked back about 13 months).
--  3. Clients with Booksy visits count as returning when they book.
-- =====================================================================

alter table public.clients add column if not exists prior_visits int not null default 0 check (prior_visits >= 0);
alter table public.clients add column if not exists prior_last_visit date;

create or replace view public.client_stats with (security_invoker = true) as
select c.id as client_id,
       (count(a.id) filter (where a.status = 'completed') + c.prior_visits)::int as visits,
       greatest(max(a.starts_at) filter (where a.status = 'completed'),
                (c.prior_last_visit + time '18:00') at time zone 'UTC') as last_visit,
       min(a.starts_at) filter (where a.status in ('booked', 'confirmed') and a.starts_at > now()) as next_visit,
       (count(a.id) filter (where a.status = 'no_show'))::int as no_shows,
       (count(a.id) filter (where a.status = 'cancelled'))::int as cancels,
       coalesce((select sum(p.amount + p.tip) from public.payments p
                 where p.client_id = c.id
                    or p.appointment_id in (select x.id from public.appointments x where x.client_id = c.id)), 0) as spend,
       coalesce((select sum(p.tip) from public.payments p
                 where p.client_id = c.id
                    or p.appointment_id in (select x.id from public.appointments x where x.client_id = c.id)), 0) as tips
from public.clients c
left join public.appointments a on a.client_id = c.id
group by c.id;
revoke all on public.client_stats from anon;
grant select on public.client_stats to authenticated;

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
  if not s.booking_open then raise exception 'Online booking is paused right now. Please text % to book.', s.phone; end if;
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
    if v_client.blocked then raise exception 'Online booking isn''t available for this number. Please text % to book.', s.phone; end if;
    if v_email is not null and v_client.email is null then
      update public.clients set email = v_email where id = v_client.id;
    end if;
  end if;

  select count(*) into v_active from public.appointments
  where client_id = v_client.id and status in ('booked', 'confirmed') and starts_at > now();
  if v_active >= s.max_active_bookings then
    raise exception 'You already have % upcoming bookings. Text % if you need another.', v_active, s.phone;
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

create or replace function public.staff_book(
  p_client_id uuid, p_name text, p_phone text, p_email text, p_service_id uuid, p_addon_ids uuid[],
  p_staff_id uuid, p_starts_at timestamptz, p_price numeric default null, p_note text default '',
  p_force boolean default false, p_source text default 'manual')
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_client uuid := p_client_id;
  v_phone  text := public.norm_phone(p_phone);
  svc      public.services%rowtype;
  v_add_price numeric := 0; v_add_dur int := 0; v_addons uuid[];
  v_new boolean; v_dur int; v_id uuid; s public.settings%rowtype;
begin
  if not public.is_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not public.is_admin() and p_staff_id is distinct from public.my_staff_id() then
    raise exception 'You can only book on your own calendar.' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;
  select * into svc from public.services where id = p_service_id;
  if not found then raise exception 'Please choose a service.'; end if;
  select coalesce(array_agg(id), '{}'), coalesce(sum(price), 0), coalesce(sum(duration_min), 0)
    into v_addons, v_add_price, v_add_dur
  from public.services where id = any (coalesce(p_addon_ids, '{}')) and is_addon;
  v_dur := svc.duration_min + v_add_dur;

  if v_client is null then
    if v_phone is not null then select id into v_client from public.clients where phone = v_phone; end if;
    if v_client is null then
      if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'Please enter the client''s name.'; end if;
      insert into public.clients (full_name, phone, email, source)
      values (btrim(p_name), v_phone, nullif(lower(btrim(coalesce(p_email, ''))), ''), p_source)
      returning id into v_client;
    end if;
  end if;

  if not (p_force and public.is_admin()) and p_source <> 'walk_in' and not exists (
    select 1 from public.get_available_slots_staff(p_staff_id, (p_starts_at at time zone s.timezone)::date, v_dur) t
    where t = p_starts_at) then
    raise exception 'That time is outside working hours or already taken.';
  end if;

  v_new := not exists (select 1 from public.clients where id = v_client and prior_visits > 0)
           and not exists (select 1 from public.appointments where client_id = v_client and status = 'completed');
  insert into public.appointments (client_id, staff_id, service_id, addon_ids, starts_at, ends_at, price,
                                   new_client, source, internal_note)
  values (v_client, p_staff_id, svc.id, v_addons, p_starts_at, p_starts_at + make_interval(mins => v_dur),
          coalesce(p_price, case when v_new and svc.new_client_price is not null then svc.new_client_price else svc.price end + v_add_price),
          v_new, p_source, coalesce(p_note, ''))
  returning id into v_id;
  return v_id;
exception
  when exclusion_violation then raise exception 'That overlaps another booking.';
end $$;

-- Check: should show ready = true twice
select proname, prosrc like '%prior_visits%' as ready from pg_proc
where proname in ('book_appointment', 'staff_book');
