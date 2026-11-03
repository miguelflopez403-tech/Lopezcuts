-- =====================================================================
--  Update for the LIVE database (run once, after re-running schema.sql)
--  Supabase → SQL Editor → New query → paste this whole file → Run.
--  Safe to run more than once.
--
--  1. Three haircut options like Booksy: First Time $25, Returning $30,
--     Hometown $25 (all 40 min).
--  2. Two more Booksy reviews word for word (Sam, Tate).
-- =====================================================================

-- 1. Haircut options -----------------------------------------------------
-- The old single "Haircut" becomes "Returning Client Haircut" so past
-- appointments keep their service.
update public.services
set name = 'Returning Client Haircut',
    description = 'Welcome back. Fade, taper, lineup or scissor cut, up to 40 minutes.',
    price = 30, new_client_price = null, first_visit_only = false, bookable = true, active = true, sort = 1
where name = 'Haircut' and not is_addon;

insert into public.services (name, description, is_addon, duration_min, price, first_visit_only, bookable, sort)
select 'First Time Haircut', 'Your first cut with Miguel. Fade, taper, lineup or scissor cut, up to 40 minutes.', false, 40, 25, true, true, 0
where not exists (select 1 from public.services where name = 'First Time Haircut');

insert into public.services (name, description, is_addon, duration_min, price, first_visit_only, bookable, sort)
select 'Hometown Haircut', 'For clients back home in the DMV (DC / Virginia). Book a day Miguel is in town.', false, 40, 25, false, true, 2
where not exists (select 1 from public.services where name = 'Hometown Haircut');

update public.services
set description = 'For clients back home in the DMV (DC / Virginia). Book a day Miguel is in town.',
    price = 25, duration_min = 40, bookable = true, active = true, sort = 2
where name = 'Hometown Haircut';

-- 2. More Booksy reviews (only ones with written text) -----------------
insert into public.reviews (rating, body, display_name, label, source, status, created_at)
select 5, v.b, v.n, 'Returning Client', 'booksy', 'published', now() - (v.i || ' days')::interval
from (values (7, '5⭐️', 'Sam'), (8, 'good cut', 'Tate')) v(i, b, n)
where not exists (select 1 from public.reviews r where r.source = 'booksy' and r.display_name = v.n and r.body = v.b);

-- Check: should list First Time $25, Returning $30, Hometown $25
select name, price, first_visit_only, bookable from public.services where not is_addon order by sort;
