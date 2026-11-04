-- Open reviews: anyone can leave a review from the website without a booking link.
-- Every open review waits for the owner's approval before it shows on the site.
-- If the phone number matches a client with a finished visit, it's marked as a verified client.
create or replace function public.submit_open_review(p_rating int, p_body text, p_display_name text, p_phone text default '')
returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_name text := left(btrim(coalesce(p_display_name, '')), 40);
        v_body text := btrim(coalesce(p_body, ''));
        v_phone text := public.norm_phone(p_phone);
        v_client uuid; v_label text := 'Client';
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Please choose 1 to 5 stars.'; end if;
  if length(v_name) < 2 then raise exception 'Please add your name.'; end if;
  if length(v_body) > 1000 then raise exception 'Please keep your review under 1,000 characters.'; end if;
  if v_body ~* '(https?://|www\.)' then raise exception 'Please leave links out of your review.'; end if;
  -- spam guards: no repeats, and a cap on how many unapproved open reviews can pile up
  if exists (select 1 from public.reviews where appointment_id is null and source = 'site'
             and lower(display_name) = lower(v_name) and created_at > now() - interval '1 day') then
    raise exception 'Thanks! We already got a review from you today.';
  end if;
  if (select count(*) from public.reviews where appointment_id is null and source = 'site' and status = 'pending'
      and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Lots of reviews coming in right now. Please try again in a bit.';
  end if;
  if v_phone is not null then
    select c.id into v_client from public.clients c where c.phone = v_phone
      and exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'completed');
    if v_client is not null then
      if exists (select 1 from public.reviews where client_id = v_client and created_at > now() - interval '7 days') then
        raise exception 'Thanks! You already left a review this week.';
      end if;
      v_label := 'Verified Client';
    end if;
  end if;
  insert into public.reviews (appointment_id, client_id, rating, body, display_name, label, source, status)
  values (null, v_client, p_rating, v_body, v_name, v_label, 'site', 'pending');
  return json_build_object('ok', true);
end $$;

select 'open reviews ready' as status;
