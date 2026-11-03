-- All 34 Booksy reviews, word for word, with their real dates. Safe to run more than once.
-- Reviews already on the site (the first 8) get their full name initial and real date;
-- the rest are added. Reviews with no text count toward the rating but aren't shown as cards.
with v(nm, b, d) as (values
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
), upd as (
  update public.reviews r set display_name = v.nm, created_at = v.d::timestamptz
    from v
   where r.source = 'booksy' and r.body = v.b
     and split_part(r.display_name, ' ', 1) = split_part(v.nm, ' ', 1)
  returning r.id
)
insert into public.reviews (rating, body, display_name, label, source, status, created_at)
select 5, v.b, v.nm, '', 'booksy', 'published', v.d::timestamptz
  from v
 where not exists (select 1 from public.reviews r where r.source = 'booksy' and r.body = v.b
                     and split_part(r.display_name, ' ', 1) = split_part(v.nm, ' ', 1));

update public.settings set booksy_review_count = 34, booksy_rating = 5 where id = 1;

select count(*) as booksy_reviews from public.reviews where source = 'booksy';  -- should say 34
