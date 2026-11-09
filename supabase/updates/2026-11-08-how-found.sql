-- "How did you find me?" on the booking form.
-- Saves the answer on the client (first answer wins) so the owner app can show
-- which channels (Instagram, friends, Google, flyers...) bring in new clients.
-- Safe to run more than once.
alter table public.clients add column if not exists heard_from text;
alter table public.clients drop constraint if exists clients_heard_from_check;
alter table public.clients add constraint clients_heard_from_check
  check (heard_from is null or heard_from in ('instagram', 'friend', 'snapchat', 'tiktok', 'google', 'flyer', 'booksy', 'other'));
alter table public.clients add column if not exists heard_from_at timestamptz;

-- Called right after a booking, with that booking's private link token, so only
-- the person who just booked can answer for that client.
create or replace function public.set_heard_from(p_token uuid, p_heard_from text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_src text := lower(btrim(coalesce(p_heard_from, '')));
begin
  if v_src not in ('instagram', 'friend', 'snapchat', 'tiktok', 'google', 'flyer', 'booksy', 'other') then
    return json_build_object('ok', false);
  end if;
  update public.clients c set heard_from = v_src, heard_from_at = now()
  from public.appointments a
  where a.manage_token = p_token and a.client_id = c.id
    and a.created_at > now() - interval '1 hour'
    and c.heard_from is null;
  return json_build_object('ok', true);
end $$;
grant execute on function public.set_heard_from(uuid, text) to anon, authenticated;

select 'how-found ready' as status,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'heard_from') as column_ok;
