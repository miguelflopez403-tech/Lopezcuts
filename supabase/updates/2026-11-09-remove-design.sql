-- Remove the "Design" add-on (not offered for now).
-- Deletes it if no booking ever used it; otherwise turns it off and keeps it for history.
-- Safe to run more than once.
delete from public.services s
where s.is_addon and s.name ilike 'design'
  and not exists (select 1 from public.appointments a where s.id = any (a.addon_ids));
update public.services set active = false, bookable = false
where is_addon and name ilike 'design';

select 'design removed' as status,
       (select count(*) from public.services where name ilike 'design' and active) as still_active;
