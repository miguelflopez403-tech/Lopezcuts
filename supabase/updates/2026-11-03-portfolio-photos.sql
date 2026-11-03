-- Miguel's edited Booksy photos, grouped into portfolio boxes (the box name is the category).
-- The first photo in each box is its cover. Safe to run more than once.
-- Old placeholder tiles (no photo) are hidden, not deleted. Delete them in Dashboard -> Portfolio if you like.
update public.portfolio_items set published = false where image_url is null;

insert into public.portfolio_items (title, category, description, image_url, published, sort)
select v.c, v.c, '', v.u, true, v.s
from (values
  ('Taper Fade', '/assets/img/portfolio/super-clean-taper-fade.jpg', 100),
  ('Taper Fade', '/assets/img/portfolio/batu-taper.jpg', 101),
  ('Taper Fade', '/assets/img/portfolio/chris-taper-and-beard-2.jpg', 102),
  ('Taper Fade', '/assets/img/portfolio/chris-taper-and-beard.jpg', 103),
  ('Taper Fade', '/assets/img/portfolio/clean-taper-fade.jpg', 104),
  ('Taper Fade', '/assets/img/portfolio/low-fade.jpg', 105),
  ('Taper Fade', '/assets/img/portfolio/rakan-taper-fade.jpg', 106),
  ('Taper Fade', '/assets/img/portfolio/takumi-taper-fade.jpg', 107),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-3.jpg', 108),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-4.jpg', 109),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-axel.jpg', 110),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-buzz-cut.jpg', 111),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-danny.jpg', 112),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-jeremey.jpg', 113),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-miles.jpg', 114),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-nolan.jpg', 115),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-seby.jpg', 116),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-takumi.jpg', 117),
  ('Taper Fade', '/assets/img/portfolio/taper-fade-zach.jpg', 118),
  ('Taper Fade', '/assets/img/portfolio/taper-fade.jpg', 119),
  ('Taper Fade', '/assets/img/portfolio/taper-fade1.jpg', 120),
  ('Taper Fade', '/assets/img/portfolio/taper-ty.jpg', 121),
  ('Taper Fade', '/assets/img/portfolio/taper-will.jpg', 122),
  ('Taper Fade', '/assets/img/portfolio/wiley-taper.jpg', 123),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-seby.jpg', 200),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-aj.jpg', 201),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-aj-better.jpg', 202),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-cyrus.jpg', 203),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-kyler.jpg', 204),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-luke.jpg', 205),
  ('Burst Fade', '/assets/img/portfolio/burst-fade-pattock.jpg', 206),
  ('Burst Fade', '/assets/img/portfolio/miguel-burst-fade.jpg', 207),
  ('Burst Fade', '/assets/img/portfolio/seby-burst-fade.jpg', 208),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-james.jpg', 301),
  ('Scissor Work', '/assets/img/portfolio/hink-scissor-work.jpg', 300),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-2.jpg', 302),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-4.jpg', 303),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-boden.jpg', 304),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-greyson.jpg', 305),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-lucas-2.jpg', 306),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-lucas-3.jpg', 307),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-lucas.jpg', 308),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-patrick.jpg', 309),
  ('Scissor Work', '/assets/img/portfolio/scissor-work-will.jpg', 310),
  ('Scissor Work', '/assets/img/portfolio/scissor-work.jpg', 311),
  ('Modern Mullet', '/assets/img/portfolio/modern-mullet-noah.jpg', 400),
  ('Modern Mullet', '/assets/img/portfolio/modern-mullet-jek.jpg', 401),
  ('Modern Mullet', '/assets/img/portfolio/modern-mullet.jpg', 402),
  ('Modern Mullet', '/assets/img/portfolio/mullet-luca.jpg', 403),
  ('Modern Mullet', '/assets/img/portfolio/rakan-modern-mullet.jpg', 404),
  ('Modern Mullet', '/assets/img/portfolio/will-booth-modern-mullet.jpg', 405),
  ('Burst Mullet', '/assets/img/portfolio/burst-mullet-gio.jpg', 500),
  ('Burst Mullet', '/assets/img/portfolio/burst-mullet-bender.jpg', 501),
  ('Burst Mullet', '/assets/img/portfolio/burst-mullet-cyrus.jpg', 502),
  ('Burst Mullet', '/assets/img/portfolio/burst-mullet.jpg', 503),
  ('Mod Cut', '/assets/img/portfolio/mod-cut-gus.jpg', 600),
  ('Mod Cut', '/assets/img/portfolio/mod-cut.jpg', 601)
) v(c, u, s)
where not exists (select 1 from public.portfolio_items p where p.image_url = v.u);

select category as box, count(*) as photos from public.portfolio_items
 where published and image_url like '/assets/img/portfolio/%' group by category order by min(sort);

-- Hink is the Scissor Work cover (also fixes it if this file already ran before that change)
update public.portfolio_items set sort = 300 where image_url = '/assets/img/portfolio/hink-scissor-work.jpg';
update public.portfolio_items set sort = 301 where image_url = '/assets/img/portfolio/scissor-work-james.jpg';
