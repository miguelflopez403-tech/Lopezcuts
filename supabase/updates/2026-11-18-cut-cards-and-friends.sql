-- Cut cards ("same as last time") and bring-a-friend links.
-- Safe to run more than once. Nothing here removes or changes existing data.
--
-- Cut cards: after a visit, the dashboard can save a photo of the cut and notes the
-- client can see (guards, length, products). The client's booking link shows their
-- latest cut with a one-tap "Book this again".
--
-- Bring a friend: every client gets a short code. A friend who books their first cut
-- from lopezcuts.com/?ref=CODE is linked to them. Once that friend's first cut is
-- checked out, the client can earn a credit (Settings: referral_credit),
-- which the dashboard offers at their next checkout. The credit starts at $0 (off):
-- links only track who sent who until a reward is set in Settings.

-- ---------- cut cards ----------
alter table public.appointments add column if not exists cut_notes text not null default '';
alter table public.appointments add column if not exists cut_photo_url text;
alter table public.appointments drop constraint if exists appointments_cut_notes_len;
alter table public.appointments add constraint appointments_cut_notes_len check (length(cut_notes) <= 500);
alter table public.appointments drop constraint if exists appointments_cut_photo_ok;
alter table public.appointments add constraint appointments_cut_photo_ok
  check (cut_photo_url is null or (length(cut_photo_url) <= 600 and cut_photo_url ~ '^(https://|/assets/)'));

-- ---------- bring a friend ----------
alter table public.clients add column if not exists ref_code text;
alter table public.clients add column if not exists referred_by uuid references public.clients (id) on delete set null;
alter table public.clients add column if not exists referred_at timestamptz;
alter table public.clients add column if not exists ref_credits_used int not null default 0;
alter table public.clients drop constraint if exists clients_ref_credits_used_check;
alter table public.clients add constraint clients_ref_credits_used_check check (ref_credits_used >= 0);
alter table public.clients drop constraint if exists clients_not_own_referrer;
alter table public.clients add constraint clients_not_own_referrer check (referred_by is null or referred_by <> id);
create unique index if not exists clients_ref_code_key on public.clients (ref_code);
create index if not exists clients_referred_by_idx on public.clients (referred_by);

alter table public.settings add column if not exists referral_credit numeric(10,2) not null default 0;
alter table public.settings drop constraint if exists settings_referral_credit_check;
alter table public.settings add constraint settings_referral_credit_check check (referral_credit between 0 and 100);

-- 6 letters/numbers, no look-alikes (0/O, 1/I/L)
create or replace function public.new_ref_code() returns text
language plpgsql volatile set search_path = public as $$
declare v text; abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    v := '';
    for i in 1..6 loop v := v || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.clients where ref_code = v);
  end loop;
  return v;
end $$;
revoke execute on function public.new_ref_code() from public, anon, authenticated;

create or replace function public.clients_ref_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ref_code is null then new.ref_code := public.new_ref_code(); end if;
  return new;
end $$;
revoke execute on function public.clients_ref_code() from public, anon, authenticated;
drop trigger if exists clients_ref_code on public.clients;
create trigger clients_ref_code before insert on public.clients for each row execute function public.clients_ref_code();

-- codes for existing clients, one at a time so two can never collide
do $$ declare r record; begin
  for r in select id from public.clients where ref_code is null loop
    update public.clients set ref_code = public.new_ref_code() where id = r.id;
  end loop;
end $$;

-- How many friends a client brought in (first cut checked out) and how many credits are left.
create or replace function public.ref_stats(p_client uuid) returns json
language sql stable security definer set search_path = public as $$
  with f as (
    select count(*)::int as friends from public.clients x
    where x.referred_by = p_client
      and exists (select 1 from public.appointments a where a.client_id = x.id and a.status = 'completed'))
  select json_build_object('friends', f.friends, 'used', c.ref_credits_used,
                           'available', greatest(0, f.friends - c.ref_credits_used),
                           'credit', s.referral_credit)
  from f, public.clients c, public.settings s where c.id = p_client and s.id = 1;
$$;
revoke execute on function public.ref_stats(uuid) from public, anon, authenticated;

-- Called right after a booking with that booking's private token (same pattern as set_heard_from),
-- so only the person who just booked can link themselves to a friend. Only first-timers count.
create or replace function public.set_referral(p_token uuid, p_code text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_ref uuid; c public.clients%rowtype;
begin
  select id into v_ref from public.clients where ref_code = upper(btrim(coalesce(p_code, '')));
  if v_ref is null then return json_build_object('ok', false); end if;
  select cl.* into c from public.appointments a join public.clients cl on cl.id = a.client_id
   where a.manage_token = p_token and a.created_at > now() - interval '1 hour';
  if not found or c.id = v_ref or c.referred_by is not null or c.prior_visits > 0
     or exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'completed')
     or exists (select 1 from public.clients r where r.id = v_ref and r.referred_by = c.id) then
    return json_build_object('ok', false);
  end if;
  update public.clients set referred_by = v_ref, referred_at = now(),
         heard_from = coalesce(heard_from, 'friend'), heard_from_at = coalesce(heard_from_at, now())
   where id = c.id;
  return json_build_object('ok', true);
end $$;
grant execute on function public.set_referral(uuid, text) to anon, authenticated;

-- Dashboard checkout: use one friend credit. Returns the dollar amount taken off (0 if none left).
create or replace function public.use_ref_credit(p_client uuid) returns numeric
language plpgsql volatile security definer set search_path = public as $$
declare st json; v_credit numeric;
begin
  if not (public.is_admin() or (public.is_staff() and exists (
      select 1 from public.appointments a where a.client_id = p_client and a.staff_id = public.my_staff_id()))) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform 1 from public.clients where id = p_client for update;
  st := public.ref_stats(p_client);
  if st is null or (st->>'available')::int < 1 then return 0; end if;
  v_credit := (st->>'credit')::numeric;
  update public.clients set ref_credits_used = ref_credits_used + 1 where id = p_client;
  return v_credit;
end $$;
revoke execute on function public.use_ref_credit(uuid) from public, anon;
grant execute on function public.use_ref_credit(uuid) to authenticated;

-- ---------- the client's booking link now also shows their last cut and friend link ----------
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
    'reviewed', exists (select 1 from public.reviews r where r.appointment_id = a.id),
    'cut', (select json_build_object('date', x.starts_at, 'service', xs.name, 'service_id', x.service_id,
                                     'addon_ids', x.addon_ids, 'notes', x.cut_notes, 'photo', x.cut_photo_url)
              from public.appointments x left join public.services xs on xs.id = x.service_id
             where x.client_id = a.client_id and x.status = 'completed'
               and (x.cut_notes <> '' or x.cut_photo_url is not null)
             order by x.starts_at desc limit 1),
    'ref_code', c.ref_code,
    'friends', public.ref_stats(c.id))
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.staff st on st.id = a.staff_id
  left join public.services sv on sv.id = a.service_id
  cross join public.settings s
  where a.manage_token = p_token and s.id = 1;
$$;
grant execute on function public.get_booking(uuid) to anon, authenticated;

-- ---------- thank-you text (automatic mode; manual mode builds the same text in the dashboard) ----------
create or replace function public.sms_body(p_kind text, p_appt uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  s public.settings%rowtype; a public.appointments%rowtype; c public.clients%rowtype;
  v_first text; v_when text; v_stop text; v_svc text; v_link text; v_site text; v_visits int; v_friend text; v_credit text;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where id = p_appt;
  select * into c from public.clients where id = a.client_id;
  v_first := split_part(trim(c.full_name), ' ', 1);
  v_when := to_char(a.starts_at at time zone s.timezone, 'FMDay, FMMon FMDD "at" FMHH12:MI AM');
  v_svc := coalesce((select name from public.services where id = a.service_id), 'haircut');
  v_site := rtrim(s.site_url, '/');
  v_link := v_site || '/#manage-' || a.manage_token;
  v_stop := case when s.text_mode = 'auto' then E'\nReply STOP to opt out.' else '' end;
  if p_kind = 'booked' then
    return format(E'Hi %s! Your booking with %s went through: %s (%s).\nMiguel will text you the day of your appointment.\nNeed to change it? %s%s',
                  v_first, s.business_name, v_when, v_svc, v_link, v_stop);
  elsif p_kind = 'rescheduled' then
    return format(E'Hi %s, Miguel moved your %s appointment to %s.\nIf that time doesn''t work, change it here: %s or text %s.',
                  v_first, s.business_name, v_when, v_link, s.phone);
  elsif p_kind = 'cancelled' then
    return format(E'Hi %s, sorry! Miguel had to cancel your %s appointment on %s.%s\nBook a new time here: %s',
                  v_first, s.business_name, v_when,
                  case when coalesce(a.cancel_reason, '') <> '' then E'\nNote: ' || a.cancel_reason else '' end, v_site);
  else
    v_visits := c.prior_visits + (select count(*) from public.appointments where client_id = c.id and status = 'completed');
    v_credit := rtrim(rtrim(s.referral_credit::text, '0'), '.');
    v_friend := case when c.ref_code is null then format(E'\nSend your friends my way: %s', v_site)
                     when s.referral_credit > 0 then format(E'\nBring a friend: %s/?ref=%s (you get $%s off when they come in)', v_site, c.ref_code, v_credit)
                     else format(E'\nBring a friend: %s/?ref=%s', v_site, c.ref_code) end;
    if a.new_client or v_visits <= 1 then
      return format(E'Thanks for coming in, %s! Hope you love the cut.\nYour cut and one-tap rebook: %s\nMost cuts look best rebooked in 3 to 4 weeks. A quick review on that link helps me a lot.%s\n- Miguel%s',
                    v_first, v_link, v_friend, v_stop);
    end if;
    return format(E'Thanks again, %s! Rebook the same cut in one tap: %s\nEnjoyed it? A quick review on that link means a lot.%s\n- Miguel%s',
                  v_first, v_link, v_friend, v_stop);
  end if;
end $$;
revoke execute on function public.sms_body(text, uuid) from public, anon, authenticated;

select 'cut cards + friends ready' as status,
       (select count(*) from public.clients where ref_code is null) as clients_without_code,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name in ('cut_notes', 'cut_photo_url')) as cut_columns;
