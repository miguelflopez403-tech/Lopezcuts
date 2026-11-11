-- Find my appointment: a client types their mobile number and first name on the
-- website and sees the date and time of their upcoming cuts.
--
-- Privacy:
--  * Both the phone number AND the first name on file have to match.
--  * It only shows the date, time, service and barber. No booking link, so
--    nobody can confirm or cancel someone else's cut with it.
--  * "Wrong name" and "no such number" look exactly the same, so it can't be
--    used to check whether someone is a client.
--  * Wrong tries are limited: 8 per internet address and 5 per phone number
--    per hour. Old tries are deleted after a day.
--
-- Safe to run more than once. Run it in Supabase -> SQL Editor.

create table if not exists public.lookup_attempts (
  id     bigserial primary key,
  ip     text not null default '',
  phone  text not null default '',
  ok     boolean not null default false,
  at     timestamptz not null default now()
);
create index if not exists lookup_attempts_at_idx on public.lookup_attempts (at);
alter table public.lookup_attempts enable row level security;
revoke all on public.lookup_attempts from anon, authenticated;

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

-- Check: should say ready = true
select exists (select 1 from pg_proc where proname = 'find_appointment') as ready;
