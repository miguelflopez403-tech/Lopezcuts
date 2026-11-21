-- Nine photos from Nov 20, 2026 (best one or two shots of each cut), added to the Full portfolio page (/portfolio).
-- They start OFF the homepage strip. Flip "On homepage" in Dashboard -> Portfolio if you want any there.
-- Safe to run more than once.
insert into public.portfolio_items (title, category, description, image_url, published, on_homepage, sort)
select v.c, v.c, '', v.u, true, false, v.s
from (values
  ('Taper Fade', '/assets/img/portfolio/textured-taper-blond.jpg', 130),
  ('Taper Fade', '/assets/img/portfolio/textured-taper-blond-2.jpg', 131),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-textured-top.jpg', 132),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-dark-side.jpg', 133),
  ('Taper Fade', '/assets/img/portfolio/textured-fringe-taper.jpg', 134),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-textured.jpg', 210),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-textured-2.jpg', 211),
  ('Modern Mullet', '/assets/img/portfolio/modern-mullet-layered.jpg', 410),
  ('Modern Mullet', '/assets/img/portfolio/modern-mullet-layered-2.jpg', 411)
) v(c, u, s)
where not exists (select 1 from public.portfolio_items p where p.image_url = v.u);

select 'new photos added' as status,
       (select count(*) from public.portfolio_items where image_url in (
         '/assets/img/portfolio/textured-taper-blond.jpg','/assets/img/portfolio/textured-taper-blond-2.jpg','/assets/img/portfolio/taper-fade-textured-top.jpg',
         '/assets/img/portfolio/taper-fade-dark-side.jpg','/assets/img/portfolio/textured-fringe-taper.jpg',
         '/assets/img/portfolio/burst-fade-textured.jpg','/assets/img/portfolio/burst-fade-textured-2.jpg',
         '/assets/img/portfolio/modern-mullet-layered.jpg','/assets/img/portfolio/modern-mullet-layered-2.jpg')) as should_be_9;
