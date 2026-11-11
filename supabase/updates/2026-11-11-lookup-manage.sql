-- Lopezcuts: change or cancel straight from "My appointment".
-- Run this whole file once in Supabase → SQL Editor. Safe to run again.
--
-- The lookup (mobile number + first name) now also hands back each upcoming appointment's
-- private booking key, so the client can tap "Change or cancel" right there.
-- The same limits still apply: 8 wrong tries per internet address and 5 per phone number an hour.

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
    select a.starts_at, a.ends_at, a.status, a.price, a.manage_token as token,
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


notify pgrst, 'reload schema';

-- Check: should say ready = true
select pg_get_functiondef('public.find_appointment(text, text)'::regprocedure) like '%manage_token as token%' as ready;
