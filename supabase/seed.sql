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
  ('Touch-up', 'Small fixes after your appointment. Always free. Text to set it up.', false, 15, 0.00, null, false, false, 20)
) v(name, description, is_addon, duration_min, price, new_client_price, first_visit_only, bookable, sort)
where not exists (select 1 from public.services);

-- Budget categories (set your limits in the dashboard)
insert into public.budgets (category, monthly_limit) values
  ('Supplies', 0), ('Tools & equipment', 0), ('Marketing', 0), ('Software & fees', 0)
on conflict (category) do nothing;

-- Real Booksy reviews, word for word (all 34, with their real dates)
insert into public.reviews (rating, body, display_name, label, source, status, created_at)
select 5, b, n, '', 'booksy', 'published', d::timestamptz
from (values
  ('Wiley St. G.', '', '2026-10-27 12:00 America/Denver'),
  ('Morgan N.', '', '2026-09-28 12:00 America/Denver'),
  ('Max S.', 'If you need a haircut this your guy', '2026-09-24 12:00 America/Denver'),
  ('Jason B.', 'Best hair cut i’ve received in a minute', '2026-09-08 12:00 America/Denver'),
  ('Will K.', 'Absolute class service', '2026-09-06 12:00 America/Denver'),
  ('Jonah L.', 'Dudes nice with it', '2026-09-06 12:00 America/Denver'),
  ('Evan M.', 'Fire cut w barber', '2026-04-13 12:00 America/Denver'),
  ('Sam P.', '5⭐️', '2026-03-22 12:00 America/Denver'),
  ('Tate M.', 'good cut', '2026-03-16 12:00 America/Denver'),
  ('Justin D.', 'Fire cuts', '2026-03-15 12:00 America/Denver'),
  ('Kaiden', 'great cut', '2026-03-02 12:00 America/Denver'),
  ('Stone H.', 'Fire', '2026-03-02 12:00 America/Denver'),
  ('Devin V.', 'The goat', '2026-03-02 12:00 America/Denver'),
  ('Mark', 'Awesome cut at a great price', '2026-03-02 12:00 America/Denver'),
  ('Ethan M.', 'Great cuts', '2026-03-02 12:00 America/Denver'),
  ('Jeremy B.', 'Great barber. Definitely will be getting more cuts in the future. He always provides exactly what I ask for.', '2026-03-02 12:00 America/Denver'),
  ('Zach J.', 'Goat', '2026-02-22 12:00 America/Denver'),
  ('Morgan N.', 'he does haircuts', '2026-02-05 12:00 America/Denver'),
  ('Nick S.', '🐐', '2026-01-14 12:00 America/Denver'),
  ('Jacob L.', 'Good cut', '2026-01-11 12:00 America/Denver'),
  ('Jake T.', '🔥🔥🔥🔥🔥🔥🔥', '2026-01-09 12:00 America/Denver'),
  ('Wills F.', 'wonderful', '2026-01-04 12:00 America/Denver'),
  ('Michael W.', 'Great cut', '2025-12-23 12:00 America/Denver'),
  ('Cole D.', 'Bangin', '2025-12-20 12:00 America/Denver'),
  ('Gio B.', 'Fire', '2025-12-04 12:00 America/Denver'),
  ('Charlie M.', 'Cuts fire', '2025-11-17 12:00 America/Denver'),
  ('Owen J.', 'Talented asf', '2025-10-09 12:00 America/Denver'),
  ('Peyton I.', 'Awesome barber. Def recommend. Dude knows what he’s doing', '2025-10-03 12:00 America/Denver'),
  ('Aidan L.', 'perfect cut', '2025-10-03 12:00 America/Denver'),
  ('Maclan G.', 'Fire', '2025-10-02 12:00 America/Denver'),
  ('Jack', 'Great haircut', '2025-09-17 12:00 America/Denver'),
  ('Ethan', 'Blessed me with a fire haircut and overall just a good dude to talk with', '2025-09-14 12:00 America/Denver'),
  ('Will P.', 'fire', '2025-09-13 12:00 America/Denver'),
  ('William B.', 'Best service', '2025-08-09 12:00 America/Denver')
) v(n, b, d)
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
