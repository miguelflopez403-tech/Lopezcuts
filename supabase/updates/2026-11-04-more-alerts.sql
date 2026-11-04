-- Phone-only alerts for bookings you add yourself and for confirmations. Safe to run more than once.
alter table public.push_subscriptions add column if not exists notify_manual   boolean not null default true;
alter table public.push_subscriptions add column if not exists notify_confirms boolean not null default true;
grant update (notify_bookings, notify_cancels, notify_manual, notify_confirms, device) on public.push_subscriptions to authenticated;
notify pgrst, 'reload schema';
select count(*) as devices, bool_and(notify_manual) as manual_on, bool_and(notify_confirms) as confirms_on from public.push_subscriptions;
