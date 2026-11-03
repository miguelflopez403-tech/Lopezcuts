-- =====================================================================
--  LOPEZ CUTS  ·  Starting data
--  Run AFTER schema.sql.
--
--  >>> BEFORE YOU RUN: the owner invite on the last lines is miguel@lopezcuts.com; change it only if you sign in with
--  >>> a different email. That email becomes the owner.
--  >>> No other email can create an account until you invite it.
-- =====================================================================

insert into public.settings (id) values (1) on conflict (id) do nothing;
-- Same rules as Booksy: 40-min start times, book 12 h to 3 months ahead, cancel up to 6 h before, avoid gaps.
update public.settings set slot_interval_min = 40, min_notice_min = 720, booking_window_days = 90,
  cancel_cutoff_hours = 6, avoid_gaps = true where id = 1;

-- Miguel's chair
insert into public.staff (id, display_name, title, bio, sort)
values ('00000000-0000-4000-8000-000000000001', 'Miguel Lopez', 'Founder & Barber',
        'Cutting since 14. Fades, tapers, lineups and curly hair. Roots in the DMV, now in Salt Lake City.', 0)
on conflict (id) do nothing;

-- Working hours. These are a starting guess. Change them any time in
-- the dashboard under Settings → Hours. 0 = Sunday ... 6 = Saturday.
insert into public.working_hours (staff_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', d, t1, t2
-- Miguel's weekly hours from his Booksy calendar (Nov 2026). Thursday and Saturday closed.
from (values (0, time '13:20', time '17:20'), (1, '15:20', '17:20'), (2, '13:00', '15:40'),
             (3, '17:00', '19:40'), (5, '13:00', '15:40')) v(d, t1, t2)
where not exists (select 1 from public.working_hours);

-- Services and prices (same three haircut options as Booksy)
insert into public.services (name, description, is_addon, duration_min, price, new_client_price, first_visit_only, bookable, sort)
select * from (values
  ('First Time Haircut', 'Your first cut with Miguel. Fade, taper, lineup or scissor cut, up to 40 minutes.', false, 40, 25.00, null::numeric, true, true, 0),
  ('Returning Client Haircut', 'Welcome back. Fade, taper, lineup or scissor cut, up to 40 minutes.', false, 40, 30.00, null, false, true, 1),
  ('Hometown Haircut', 'For clients back home in the DMV (DC / Virginia). Book a day Miguel is in town.', false, 40, 25.00, null, false, true, 2),
  ('Beard', 'Shape-up and lineup on the beard.', true, 0, 5.00, null, false, true, 10),
  ('Design', 'Part, line or custom design.', true, 0, 5.00, null, false, true, 11),
  ('Touch-up', 'Small fixes after your appointment. Always free. Text to set it up.', false, 15, 0.00, null, false, false, 20)
) v(name, description, is_addon, duration_min, price, new_client_price, first_visit_only, bookable, sort)
where not exists (select 1 from public.services);

-- Budget categories (set your limits in the dashboard)
insert into public.budgets (category, monthly_limit) values
  ('Supplies', 0), ('Tools & equipment', 0), ('Marketing', 0), ('Software & fees', 0)
on conflict (category) do nothing;

-- Real Booksy reviews, word for word
insert into public.reviews (rating, body, display_name, label, source, status, created_at)
select 5, b, n, l, 'booksy', 'published', now() - (i || ' days')::interval
from (values
  (1, 'If you need a haircut this your guy', 'Max', 'Returning Client'),
  (2, 'Best hair cut i’ve received in a minute', 'Jason', 'First Time Client'),
  (3, 'Absolute class service', 'Will', 'Returning Client'),
  (4, 'Dudes nice with it', 'Jonah', 'First Time Client'),
  (5, 'Fire cut w barber', 'Evan', 'First Time Client'),
  (6, 'Fire cuts', 'Justin', 'Returning Client'),
  (7, '5⭐️', 'Sam', 'Returning Client'),
  (8, 'good cut', 'Tate', 'Returning Client')
) v(i, b, n, l)
where not exists (select 1 from public.reviews where source = 'booksy');

-- Portfolio placeholders. Upload real photos in the dashboard under
-- Portfolio and these tiles switch to your photos.
insert into public.portfolio_items (title, category, description, sort)
select * from (values
  ('Mid skin fade', 'Fades', 'Placeholder until real photos are added', 0),
  ('Low taper with curls', 'Curly', 'Placeholder until real photos are added', 1),
  ('Crisp lineup', 'Lineups', 'Placeholder until real photos are added', 2),
  ('Burst fade', 'Fades', 'Placeholder until real photos are added', 3),
  ('Beard shape-up', 'Beards', 'Placeholder until real photos are added', 4),
  ('Part design', 'Designs', 'Placeholder until real photos are added', 5),
  ('High taper', 'Tapers', 'Placeholder until real photos are added', 6),
  ('Curly top, drop fade', 'Curly', 'Placeholder until real photos are added', 7),
  ('Freestyle design', 'Designs', 'Placeholder until real photos are added', 8),
  ('Fresh cut', 'Fades', 'Placeholder until real photos are added', 9),
  ('Clean up', 'Fades', 'Placeholder until real photos are added', 10)
) v(title, category, description, sort)
where not exists (select 1 from public.portfolio_items);

-- >>> YOUR OWNER LOGIN. Change the email, keep the quotes. <<<
insert into public.staff_invites (email, role, staff_id, full_name)
values (lower('miguel@lopezcuts.com'), 'owner', '00000000-0000-4000-8000-000000000001', 'Miguel Lopez')
on conflict (email) do update set role = 'owner';
