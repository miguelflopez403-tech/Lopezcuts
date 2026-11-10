-- New Booksy review (Nov 9, 2026), word for word. Brings Booksy to 35 reviews, 5.0.
-- Safe to run more than once.
insert into public.reviews (rating, body, display_name, label, source, status, created_at)
select 5, 'Miguel is the man, hella cool dude and gives great cuts', 'Ryan K.', '', 'booksy', 'published', '2026-11-09 12:00 America/Denver'::timestamptz
 where not exists (select 1 from public.reviews where source = 'booksy' and display_name = 'Ryan K.'
                     and body = 'Miguel is the man, hella cool dude and gives great cuts');

update public.settings set booksy_review_count = 35, booksy_rating = 5 where id = 1;

select count(*) as booksy_reviews from public.reviews where source = 'booksy';  -- should say 35
