-- Email alerts for new bookings and client cancellations (sent by the notify-owner function).
-- Safe to run more than once.
alter table public.settings add column if not exists notify_email   text not null default 'miguel@lopezcuts.com';
alter table public.settings add column if not exists email_bookings boolean not null default true;
alter table public.settings add column if not exists email_cancels  boolean not null default true;

select notify_email, email_bookings, email_cancels from public.settings where id = 1;  -- should show your email, true, true
