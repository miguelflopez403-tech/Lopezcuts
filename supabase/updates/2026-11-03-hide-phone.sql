-- Keeps your phone number off the public website. The booking site no longer receives it.
-- (Clients still get texts from you, and the number stays in Settings for your own use.) Safe to run more than once.
create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business_name', business_name, 'timezone', timezone, 'instagram', instagram,
    'booking_open', booking_open, 'booking_window_days', booking_window_days,
    'min_notice_min', min_notice_min, 'cancel_cutoff_hours', cancel_cutoff_hours,
    'booksy_rating', booksy_rating, 'booksy_review_count', booksy_review_count)
  from public.settings where id = 1;
$$;

select position('phone' in pg_get_functiondef('public.get_public_settings()'::regprocedure)) = 0 as phone_hidden;  -- should say true
