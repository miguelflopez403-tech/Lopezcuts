-- Master portfolio + homepage picks.
-- Every published photo shows on the Full portfolio page (/portfolio).
-- Only photos with on_homepage = true show in the homepage carousel.
-- Existing photos stay on the homepage, so nothing changes until you pick.
-- Safe to run more than once.
alter table public.portfolio_items add column if not exists on_homepage boolean not null default true;

select 'homepage photos ready' as status,
       (select count(*) from public.portfolio_items where on_homepage) as on_homepage,
       (select count(*) from public.portfolio_items) as total;
