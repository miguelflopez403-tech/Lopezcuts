-- =====================================================================
--  LOPEZ CUTS  ·  Database schema for Supabase (Postgres 15+)
-- =====================================================================
--  One database behind two parts:
--    1. The public client site (index.html): reads services, staff,
--       published reviews and portfolio; books through safe functions.
--    2. The private owner dashboard (owner/): everything else, behind
--       invite-only login, 2-step verification and row-level security.
--
--  HOW TO RUN: Supabase dashboard → SQL Editor → New query → paste this
--  whole file → Run. Then run seed.sql (after putting YOUR email in it).
--  Safe to re-run: every object is created with "if not exists" or
--  "create or replace".
--
--  SECURITY MODEL (read this once)
--    • Visitors (the "anon" role) can NOT read or write any table that
--      holds client data or money. They can only call the booking
--      functions below, which check every input and return only what
--      that one visitor needs.
--    • Staff accounts are invite-only. A trigger on auth.users refuses
--      to create an account for any email that is not in staff_invites.
--    • Roles: owner > manager > employee.
--        owner     everything, including team, roles and the activity log
--        manager   everything except team/roles and the activity log
--        employee  only their own calendar and their own clients;
--                  never payments, expenses, budgets or revenue
--    • Owners and managers must pass 2-step verification (an
--      authenticator app code) before ANY private row is returned.
--      This is enforced here in the database, not just in the page.
--    • Every change to payments, expenses, budgets, settings, roles and
--      invites is written to audit_log with who did it and when.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('owner', 'manager', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appt_status as enum ('booked', 'confirmed', 'completed', 'no_show', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pay_method as enum ('cash', 'venmo', 'zelle', 'cashapp', 'apple_pay', 'card', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('pending', 'published', 'hidden');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Business settings (exactly one row)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                   int primary key default 1 check (id = 1),
  business_name        text not null default 'Lopezcuts',
  timezone             text not null default 'America/Denver',
  address              text not null default '',          -- private: only sent in confirmation texts
  phone                text not null default '(571) 599-9297',
  instagram            text not null default 'lopezcuts.dmv',
  booking_open         boolean not null default true,     -- pause online booking with one switch
  slot_interval_min    int not null default 40 check (slot_interval_min between 5 and 120),
  buffer_min           int not null default 0  check (buffer_min between 0 and 60),
  min_notice_min       int not null default 720 check (min_notice_min between 0 and 10080),
  booking_window_days  int not null default 90 check (booking_window_days between 1 and 180),
  max_active_bookings  int not null default 2 check (max_active_bookings between 1 and 10),
  cancel_cutoff_hours  int not null default 6 check (cancel_cutoff_hours between 0 and 72),
  avoid_gaps           boolean not null default true,     -- only offer times that don't leave unusable gaps
  booksy_rating        numeric(2,1) not null default 5.0,
  booksy_review_count  int not null default 34,
  updated_at           timestamptz not null default now()
);
alter table public.settings add column if not exists avoid_gaps boolean not null default true;

-- ---------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  display_name   text not null,
  title          text not null default 'Barber',
  bio            text not null default '',
  avatar_url     text,
  color          text not null default '#c9a24a',
  active         boolean not null default true,
  accepts_online boolean not null default true,   -- shows up on the public booking page
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists public.profiles (           -- one row per login
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        public.app_role not null default 'employee',
  staff_id    uuid references public.staff (id) on delete set null,
  active      boolean not null default true,          -- switch off to lock someone out instantly
  created_at  timestamptz not null default now()
);

create table if not exists public.staff_invites (       -- only these emails can ever create an account
  email       text primary key check (email = lower(email)),
  role        public.app_role not null default 'employee',
  staff_id    uuid references public.staff (id) on delete set null,
  full_name   text not null default '',
  invited_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.working_hours (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff (id) on delete cascade,
  weekday     int not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time)
);
create index if not exists working_hours_staff_idx on public.working_hours (staff_id, weekday);

create table if not exists public.time_off (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists time_off_staff_idx on public.time_off (staff_id, starts_at);

-- ---------------------------------------------------------------------
-- Services and add-ons
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text not null default '',
  is_addon          boolean not null default false,
  duration_min      int not null default 40 check (duration_min between 0 and 480),
  price             numeric(10,2) not null check (price >= 0),
  new_client_price  numeric(10,2) check (new_client_price >= 0),  -- e.g. $25 first cut
  bookable          boolean not null default true,   -- false = shown on the price list only
  active            boolean not null default true,
  sort              int not null default 0,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  phone             text unique,            -- digits only, e.g. 15715999297
  email             text,
  birthday          date,
  notes             text not null default '',      -- standing notes: guard sizes, preferences
  tags              text[] not null default '{}',
  marketing_opt_in  boolean not null default false,
  blocked           boolean not null default false, -- blocks online booking
  source            text not null default 'manual', -- online, manual, walk_in, booksy
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists clients_name_idx on public.clients (lower(full_name));

create table if not exists public.client_notes (          -- dated history notes
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  body       text not null check (length(body) between 1 and 2000),
  author_id  uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists client_notes_client_idx on public.client_notes (client_id, created_at desc);

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  staff_id          uuid not null references public.staff (id),
  service_id        uuid references public.services (id) on delete set null,
  addon_ids         uuid[] not null default '{}',
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            public.appt_status not null default 'booked',
  price             numeric(10,2) not null default 0,   -- quoted price incl. add-ons
  new_client        boolean not null default false,
  source            text not null default 'online',     -- online, manual, walk_in, booksy
  client_message    text not null default '',           -- what the client wrote when booking
  internal_note     text not null default '',
  manage_token      uuid not null unique default gen_random_uuid(),  -- the client's private link
  reminder_sent_at  timestamptz,
  confirmed_at      timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancelled_by      text,                                -- client or shop
  cancel_reason     text not null default '',
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  -- No double booking, ever, even if two people tap "Book" at the same instant.
  constraint appointments_no_overlap exclude using gist (
    staff_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('booked', 'confirmed'))
);
create index if not exists appointments_time_idx on public.appointments (starts_at);
create index if not exists appointments_client_idx on public.appointments (client_id, starts_at desc);
create index if not exists appointments_staff_idx on public.appointments (staff_id, starts_at);

-- ---------------------------------------------------------------------
-- Money (owner + manager only)
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments (id) on delete set null,
  client_id       uuid references public.clients (id) on delete set null,
  amount          numeric(10,2) not null check (amount >= 0),
  tip             numeric(10,2) not null default 0 check (tip >= 0),
  method          public.pay_method not null default 'cash',
  note            text not null default '',
  paid_at         timestamptz not null default now(),
  recorded_by     uuid default auth.uid()
);
create index if not exists payments_paid_idx on public.payments (paid_at desc);

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  description text not null,
  category    text not null default 'Supplies',
  amount      numeric(10,2) not null check (amount > 0),
  spent_on    date not null default current_date,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (spent_on desc);

create table if not exists public.budgets (
  category       text primary key,
  monthly_limit  numeric(10,2) not null default 0 check (monthly_limit >= 0)
);

-- ---------------------------------------------------------------------
-- Supplies
-- ---------------------------------------------------------------------
create table if not exists public.inventory (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  unit        text not null default '',
  qty         numeric(10,2) not null default 0 check (qty >= 0),
  per_cut     numeric(10,2) not null default 0 check (per_cut >= 0),
  per_addon   numeric(10,2) not null default 0 check (per_addon >= 0),
  reorder_at  numeric(10,2) not null default 0 check (reorder_at >= 0),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reviews and portfolio (public once published)
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid unique references public.appointments (id) on delete set null,
  client_id       uuid references public.clients (id) on delete set null,
  rating          int not null check (rating between 1 and 5),
  body            text not null default '' check (length(body) <= 1000),
  display_name    text not null default '',
  label           text not null default '',          -- "First Time Client", "Returning Client"
  source          text not null default 'site',      -- site or booksy
  status          public.review_status not null default 'pending',
  reply           text not null default '',
  created_at      timestamptz not null default now()
);

create table if not exists public.portfolio_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'Fades',         -- Fades, Tapers, Lineups, Designs, Beards, Curly
  description text not null default '',
  image_url   text,                                  -- null = show a placeholder tile
  published   boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Activity log (owner only)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid default auth.uid(),
  table_name  text not null,
  action      text not null,
  row_id      text,
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- =====================================================================
--  Helper functions (used by the security rules)
-- =====================================================================

-- Set to false ONLY while testing. When true, owners and managers must
-- verify with their authenticator app before any private data loads.
create or replace function public.mfa_required() returns boolean
language sql immutable as $$ select true $$;

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active
      and p.role = any (roles)
      and (
        p.role = 'employee'
        or not public.mfa_required()
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
  );
$$;

create or replace function public.is_owner() returns boolean
language sql stable as $$ select public.has_role('owner') $$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.has_role('owner', 'manager') $$;

create or replace function public.is_staff() returns boolean
language sql stable as $$ select public.has_role('owner', 'manager', 'employee') $$;

create or replace function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select staff_id from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.norm_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 10 then d := '1' || d; end if;
  if length(d) < 11 or length(d) > 15 then return null; end if;
  return d;
end $$;

-- =====================================================================
--  Invite-only accounts
-- =====================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.staff_invites%rowtype;
begin
  select * into inv from public.staff_invites where email = lower(new.email);
  if not found then
    raise exception 'This email has not been invited to Lopezcuts.' using errcode = '42501';
  end if;
  insert into public.profiles (id, email, full_name, role, staff_id)
  values (new.id, lower(new.email), inv.full_name, inv.role, inv.staff_id)
  on conflict (id) do nothing;
  update public.staff_invites set accepted_at = now() where email = inv.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nobody can change their own role, and the last owner can't be removed.
create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and (select count(*) from public.profiles where role = 'owner' and active) <= 1 then
    raise exception 'You can''t remove the last owner.';
  end if;
  if tg_op = 'UPDATE' and new.id = auth.uid() and (new.role <> old.role or new.active <> old.active) then
    raise exception 'You can''t change your own role or access.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update or delete on public.profiles
  for each row execute function public.guard_profiles();

-- =====================================================================
--  Activity log trigger
-- =====================================================================
create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, action, row_id, old_data, new_data)
  values (tg_table_name, lower(tg_op),
          coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'), (to_jsonb(new) ->> 'email'),
                   (to_jsonb(old) ->> 'email'), (to_jsonb(new) ->> 'category'), (to_jsonb(old) ->> 'category')),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['payments', 'expenses', 'budgets', 'settings', 'profiles', 'staff_invites', 'services'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.write_audit()', t, t);
  end loop;
end $$;

-- =====================================================================
--  Row-level security
-- =====================================================================
alter table public.settings        enable row level security;
alter table public.staff           enable row level security;
alter table public.profiles        enable row level security;
alter table public.staff_invites   enable row level security;
alter table public.working_hours   enable row level security;
alter table public.time_off        enable row level security;
alter table public.services        enable row level security;
alter table public.clients         enable row level security;
alter table public.client_notes    enable row level security;
alter table public.appointments    enable row level security;
alter table public.payments        enable row level security;
alter table public.expenses        enable row level security;
alter table public.budgets         enable row level security;
alter table public.inventory       enable row level security;
alter table public.reviews         enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.audit_log       enable row level security;

-- Defense in depth: visitors get no table access at all to private data.
revoke all on public.settings, public.profiles, public.staff_invites, public.working_hours,
              public.time_off, public.clients, public.client_notes, public.appointments,
              public.payments, public.expenses, public.budgets, public.inventory, public.audit_log
  from anon;

-- helper to (re)create a policy idempotently
create or replace function pg_temp.pol(p_name text, p_table text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format('create policy %I on public.%I for %s %s %s', p_name, p_table, p_cmd,
    case when p_using is null then '' else 'using (' || p_using || ')' end,
    case when p_check is null then '' else 'with check (' || p_check || ')' end);
end $$;

-- settings: staff read, admin edit (visitors use get_public_settings())
select pg_temp.pol('settings_read',   'settings', 'select', 'public.is_staff()');
select pg_temp.pol('settings_update', 'settings', 'update', 'public.is_admin()', 'public.is_admin()');

-- staff: anyone can see active barbers (name, bio, photo). Admin edits.
select pg_temp.pol('staff_public_read', 'staff', 'select', 'active or public.is_staff()');
select pg_temp.pol('staff_admin_ins',   'staff', 'insert', null, 'public.is_admin()');
select pg_temp.pol('staff_admin_upd',   'staff', 'update', 'public.is_admin()', 'public.is_admin()');
select pg_temp.pol('staff_owner_del',   'staff', 'delete', 'public.is_owner()');

-- profiles: you can read your own (so the page knows your role); owner manages all
select pg_temp.pol('profiles_self_read',  'profiles', 'select', 'id = auth.uid() or public.is_owner()');
select pg_temp.pol('profiles_owner_upd',  'profiles', 'update', 'public.is_owner()', 'public.is_owner()');
select pg_temp.pol('profiles_owner_del',  'profiles', 'delete', 'public.is_owner()');

-- invites: owner only
select pg_temp.pol('invites_owner_all', 'staff_invites', 'all', 'public.is_owner()', 'public.is_owner()');

-- hours and time off: staff read; admin, or the barber themself, edits
select pg_temp.pol('hours_read',  'working_hours', 'select', 'public.is_staff()');
select pg_temp.pol('hours_write', 'working_hours', 'all',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())');
select pg_temp.pol('timeoff_read',  'time_off', 'select', 'public.is_staff()');
select pg_temp.pol('timeoff_write', 'time_off', 'all',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())');

-- services: public price list; admin edits
select pg_temp.pol('services_public_read', 'services', 'select', 'active or public.is_staff()');
select pg_temp.pol('services_admin_ins',   'services', 'insert', null, 'public.is_admin()');
select pg_temp.pol('services_admin_upd',   'services', 'update', 'public.is_admin()', 'public.is_admin()');
select pg_temp.pol('services_admin_del',   'services', 'delete', 'public.is_admin()');

-- clients: admin sees all; employees see clients they served or added
select pg_temp.pol('clients_read', 'clients', 'select',
  'public.is_admin() or (public.is_staff() and (created_by = auth.uid() or exists (
     select 1 from public.appointments a where a.client_id = clients.id and a.staff_id = public.my_staff_id())))');
select pg_temp.pol('clients_ins', 'clients', 'insert', null, 'public.is_staff()');
select pg_temp.pol('clients_upd', 'clients', 'update',
  'public.is_admin() or (public.is_staff() and (created_by = auth.uid() or exists (
     select 1 from public.appointments a where a.client_id = clients.id and a.staff_id = public.my_staff_id())))',
  'public.is_staff()');
select pg_temp.pol('clients_del', 'clients', 'delete', 'public.is_owner()');

select pg_temp.pol('cnotes_read', 'client_notes', 'select',
  'exists (select 1 from public.clients c where c.id = client_notes.client_id)');  -- inherits clients rule
select pg_temp.pol('cnotes_ins', 'client_notes', 'insert', null,
  'public.is_staff() and exists (select 1 from public.clients c where c.id = client_notes.client_id)');
select pg_temp.pol('cnotes_del', 'client_notes', 'delete', 'public.is_admin() or author_id = auth.uid()');

-- appointments: admin sees all; employees only their own chair
select pg_temp.pol('appts_read', 'appointments', 'select',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())');
select pg_temp.pol('appts_ins', 'appointments', 'insert', null,
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())');
select pg_temp.pol('appts_upd', 'appointments', 'update',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())',
  'public.is_admin() or (public.is_staff() and staff_id = public.my_staff_id())');
select pg_temp.pol('appts_del', 'appointments', 'delete', 'public.is_admin()');

-- money: owner + manager only. Employees record checkouts through
-- complete_appointment(), which never returns totals.
select pg_temp.pol('payments_admin', 'payments', 'all', 'public.is_admin()', 'public.is_admin()');
select pg_temp.pol('expenses_admin', 'expenses', 'all', 'public.is_admin()', 'public.is_admin()');
select pg_temp.pol('budgets_admin',  'budgets',  'all', 'public.is_admin()', 'public.is_admin()');

-- supplies: staff can see stock levels; admin edits
select pg_temp.pol('inv_read',  'inventory', 'select', 'public.is_staff()');
select pg_temp.pol('inv_write', 'inventory', 'all', 'public.is_admin()', 'public.is_admin()');

-- reviews: published ones are public; staff read all; admin moderates
select pg_temp.pol('reviews_public_read', 'reviews', 'select', 'status = ''published'' or public.is_staff()');
select pg_temp.pol('reviews_admin_ins',   'reviews', 'insert', null, 'public.is_admin()');
select pg_temp.pol('reviews_admin_upd',   'reviews', 'update', 'public.is_admin()', 'public.is_admin()');
select pg_temp.pol('reviews_admin_del',   'reviews', 'delete', 'public.is_admin()');

-- portfolio: published items are public; admin edits
select pg_temp.pol('portfolio_public_read', 'portfolio_items', 'select', 'published or public.is_staff()');
select pg_temp.pol('portfolio_admin_ins',   'portfolio_items', 'insert', null, 'public.is_admin()');
select pg_temp.pol('portfolio_admin_upd',   'portfolio_items', 'update', 'public.is_admin()', 'public.is_admin()');
select pg_temp.pol('portfolio_admin_del',   'portfolio_items', 'delete', 'public.is_admin()');

-- activity log: owner reads; nobody edits or deletes
select pg_temp.pol('audit_owner_read', 'audit_log', 'select', 'public.is_owner()');

-- =====================================================================
--  Public booking functions (the only way visitors touch private data)
-- =====================================================================

create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business_name', business_name, 'timezone', timezone, 'phone', phone, 'instagram', instagram,
    'booking_open', booking_open, 'booking_window_days', booking_window_days,
    'min_notice_min', min_notice_min, 'cancel_cutoff_hours', cancel_cutoff_hours,
    'booksy_rating', booksy_rating, 'booksy_review_count', booksy_review_count)
  from public.settings where id = 1;
$$;

-- Open start times for one barber on one day (business time zone).
-- Start times step every slot_interval_min from opening. With avoid_gaps on (Booksy's
-- "Avoid gaps between services"), times right before/after existing bookings are also
-- offered, and a time is hidden if it would leave a gap too short for the shortest service
-- without sitting right against a booking or the start/end of the day.
create or replace function public.get_available_slots(p_staff_id uuid, p_day date, p_duration int default 40)
returns setof timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  s      public.settings%rowtype;
  dur    interval;
  buf    interval;
  mingap interval;
  d0     timestamptz;
  d1     timestamptz;
begin
  select * into s from public.settings where id = 1;
  if not found or not s.booking_open then return; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active and accepts_online) then return; end if;
  dur := make_interval(mins => greatest(coalesce(p_duration, 40), 5));
  buf := make_interval(mins => s.buffer_min);
  select make_interval(mins => greatest(coalesce(min(duration_min), 40), 5)) into mingap
    from public.services where active and bookable and not is_addon and duration_min > 0;
  d0 := p_day::timestamp at time zone s.timezone;
  d1 := (p_day + 1)::timestamp at time zone s.timezone;

  return query
  with wh as (
    select (p_day + w.start_time) at time zone s.timezone as ws,
           (p_day + w.end_time)   at time zone s.timezone as we
    from public.working_hours w
    where w.staff_id = p_staff_id and w.weekday = extract(dow from p_day)::int
  ), busy as (
    select a.starts_at - buf as bs, a.ends_at + buf as be from public.appointments a
    where a.staff_id = p_staff_id and a.status in ('booked', 'confirmed')
      and a.starts_at < d1 + interval '1 hour' and a.ends_at > d0 - interval '1 hour'
    union all
    select o.starts_at, o.ends_at from public.time_off o
    where o.staff_id = p_staff_id and o.starts_at < d1 and o.ends_at > d0
  ), cand as (
    select g.t, wh.ws, wh.we from wh
    cross join lateral generate_series(wh.ws, wh.we - dur, make_interval(mins => s.slot_interval_min)) g(t)
    union
    select b.be, wh.ws, wh.we from wh join busy b on s.avoid_gaps and b.be >= wh.ws and b.be + dur <= wh.we
    union
    select b.bs - dur, wh.ws, wh.we from wh join busy b on s.avoid_gaps and b.bs - dur >= wh.ws and b.bs <= wh.we
  ), ok as (
    select c.t, c.ws, c.we from cand c
    where c.t >= now() + make_interval(mins => s.min_notice_min)
      and c.t <= now() + make_interval(days => s.booking_window_days)
      and not exists (select 1 from busy b where tstzrange(b.bs, b.be) && tstzrange(c.t, c.t + dur))
  )
  , gaps as (
    select ok.t,
      ok.t - greatest(ok.ws, coalesce((select max(b.be) from busy b where b.be <= ok.t), ok.ws)) as before_gap,
      least(ok.we, coalesce((select min(b.bs) from busy b where b.bs >= ok.t + dur), ok.we)) - (ok.t + dur) as after_gap
    from ok
  )
  -- keep a time if it sits right against a booking/opening/closing on one side,
  -- or if neither side leaves a gap too short to fill
  select distinct g.t from gaps g
  where not s.avoid_gaps
     or g.before_gap = interval '0' or g.after_gap = interval '0'
     or (g.before_gap >= mingap and g.after_gap >= mingap)
  order by 1;
end $$;

-- How many openings each day has, for the date picker.
create or replace function public.get_open_days(p_staff_id uuid, p_from date, p_days int default 14, p_duration int default 40)
returns table (day date, openings int)
language sql stable security definer set search_path = public as $$
  select d::date, (select count(*)::int from public.get_available_slots(p_staff_id, d::date, p_duration))
  from generate_series(p_from, p_from + least(greatest(p_days, 1), 93) - 1, interval '1 day') d;
$$;

create or replace function public.book_appointment(
  p_name text, p_phone text, p_email text, p_service_id uuid, p_addon_ids uuid[],
  p_staff_id uuid, p_starts_at timestamptz, p_note text default '')
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s          public.settings%rowtype;
  svc        public.services%rowtype;
  v_phone    text := public.norm_phone(p_phone);
  v_email    text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name     text := btrim(coalesce(p_name, ''));
  v_client   public.clients%rowtype;
  v_addons   uuid[];
  v_add_names text[];
  v_add_price numeric := 0;
  v_add_dur  int := 0;
  v_dur      int;
  v_new      boolean;
  v_price    numeric;
  v_active   int;
  v_appt     public.appointments%rowtype;
begin
  select * into s from public.settings where id = 1;
  if not s.booking_open then raise exception 'Online booking is paused right now. Please text % to book.', s.phone; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if v_phone is null then raise exception 'Please enter a valid phone number.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right.'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Please keep your note under 500 characters.'; end if;

  select * into svc from public.services where id = p_service_id and active and bookable and not is_addon;
  if not found then raise exception 'Please choose a service.'; end if;

  select coalesce(array_agg(id order by sort), '{}'), coalesce(array_agg(name order by sort), '{}'),
         coalesce(sum(price), 0), coalesce(sum(duration_min), 0)
    into v_addons, v_add_names, v_add_price, v_add_dur
  from public.services where id = any (coalesce(p_addon_ids, '{}')) and active and is_addon;

  v_dur := svc.duration_min + v_add_dur;

  if not exists (
    select 1 from public.get_available_slots(p_staff_id, (p_starts_at at time zone s.timezone)::date, v_dur) t
    where t = p_starts_at) then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
  end if;

  select * into v_client from public.clients where phone = v_phone for update;
  if not found then
    insert into public.clients (full_name, phone, email, source, created_by)
    values (v_name, v_phone, v_email, 'online', null) returning * into v_client;
  else
    if v_client.blocked then raise exception 'Online booking isn''t available for this number. Please text % to book.', s.phone; end if;
    if v_email is not null and v_client.email is null then
      update public.clients set email = v_email where id = v_client.id;
    end if;
  end if;

  select count(*) into v_active from public.appointments
  where client_id = v_client.id and status in ('booked', 'confirmed') and starts_at > now();
  if v_active >= s.max_active_bookings then
    raise exception 'You already have % upcoming bookings. Text % if you need another.', v_active, s.phone;
  end if;

  v_new := not exists (select 1 from public.appointments where client_id = v_client.id and status = 'completed');
  v_price := case when v_new and svc.new_client_price is not null then svc.new_client_price else svc.price end + v_add_price;

  insert into public.appointments (client_id, staff_id, service_id, addon_ids, starts_at, ends_at,
                                   price, new_client, source, client_message, created_by)
  values (v_client.id, p_staff_id, svc.id, v_addons, p_starts_at, p_starts_at + make_interval(mins => v_dur),
          v_price, v_new, 'online', coalesce(p_note, ''), null)
  returning * into v_appt;

  return json_build_object(
    'token', v_appt.manage_token, 'starts_at', v_appt.starts_at, 'ends_at', v_appt.ends_at,
    'price', v_price, 'new_client', v_new, 'service', svc.name, 'addons', v_add_names,
    'staff', (select display_name from public.staff where id = p_staff_id), 'status', v_appt.status);
exception
  when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
end $$;

-- What the client sees on their private booking link.
create or replace function public.get_booking(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'first_name', split_part(c.full_name, ' ', 1),
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'price', a.price,
    'service', sv.name, 'staff', st.display_name,
    'addons', (select coalesce(array_agg(x.name), '{}') from public.services x where x.id = any (a.addon_ids)),
    'can_cancel', a.status in ('booked', 'confirmed')
                  and a.starts_at > now() + make_interval(hours => s.cancel_cutoff_hours),
    'can_confirm', a.status = 'booked' and a.starts_at > now(),
    'can_review', a.status = 'completed' and a.completed_at > now() - interval '60 days'
                  and not exists (select 1 from public.reviews r where r.appointment_id = a.id),
    'reviewed', exists (select 1 from public.reviews r where r.appointment_id = a.id))
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.staff st on st.id = a.staff_id
  left join public.services sv on sv.id = a.service_id
  cross join public.settings s
  where a.manage_token = p_token and s.id = 1;
$$;

create or replace function public.confirm_booking(p_token uuid) returns json
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.appointments set status = 'confirmed', confirmed_at = now()
  where manage_token = p_token and status = 'booked' and starts_at > now();
  return public.get_booking(p_token);
end $$;

create or replace function public.cancel_booking(p_token uuid, p_reason text default '') returns json
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; s public.settings%rowtype;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where manage_token = p_token for update;
  if not found then raise exception 'We couldn''t find that booking.'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'This booking can''t be cancelled anymore.'; end if;
  if a.starts_at <= now() + make_interval(hours => s.cancel_cutoff_hours) then
    raise exception 'It''s too close to your appointment to cancel online. Please text %.', s.phone;
  end if;
  update public.appointments
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client', cancel_reason = left(coalesce(p_reason, ''), 300)
   where id = a.id;
  return public.get_booking(p_token);
end $$;

create or replace function public.submit_review(p_token uuid, p_rating int, p_body text, p_display_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; v_first boolean;
begin
  select * into a from public.appointments where manage_token = p_token;
  if not found or a.status <> 'completed' then raise exception 'Reviews open after your appointment is finished.'; end if;
  if a.completed_at < now() - interval '60 days' then raise exception 'This review link has expired.'; end if;
  if exists (select 1 from public.reviews where appointment_id = a.id) then raise exception 'You already reviewed this visit. Thank you!'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Please choose 1 to 5 stars.'; end if;
  if length(coalesce(p_body, '')) > 1000 then raise exception 'Please keep your review under 1,000 characters.'; end if;
  v_first := a.new_client;
  insert into public.reviews (appointment_id, client_id, rating, body, display_name, label, source, status)
  values (a.id, a.client_id, p_rating, btrim(coalesce(p_body, '')),
          left(btrim(coalesce(nullif(p_display_name, ''), 'Client')), 40),
          case when v_first then 'First Time Client' else 'Returning Client' end, 'site', 'pending');
  return json_build_object('ok', true);
end $$;

-- =====================================================================
--  Staff functions (each one checks the caller's role first)
-- =====================================================================

-- Book from the dashboard: finds or creates the client by phone.
-- p_force lets an owner/manager book outside working hours.
create or replace function public.staff_book(
  p_client_id uuid, p_name text, p_phone text, p_email text, p_service_id uuid, p_addon_ids uuid[],
  p_staff_id uuid, p_starts_at timestamptz, p_price numeric default null, p_note text default '',
  p_force boolean default false, p_source text default 'manual')
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_client uuid := p_client_id;
  v_phone  text := public.norm_phone(p_phone);
  svc      public.services%rowtype;
  v_add_price numeric := 0; v_add_dur int := 0; v_addons uuid[];
  v_new boolean; v_dur int; v_id uuid; s public.settings%rowtype;
begin
  if not public.is_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not public.is_admin() and p_staff_id is distinct from public.my_staff_id() then
    raise exception 'You can only book on your own calendar.' using errcode = '42501';
  end if;
  select * into s from public.settings where id = 1;
  select * into svc from public.services where id = p_service_id;
  if not found then raise exception 'Please choose a service.'; end if;
  select coalesce(array_agg(id), '{}'), coalesce(sum(price), 0), coalesce(sum(duration_min), 0)
    into v_addons, v_add_price, v_add_dur
  from public.services where id = any (coalesce(p_addon_ids, '{}')) and is_addon;
  v_dur := svc.duration_min + v_add_dur;

  if v_client is null then
    if v_phone is not null then select id into v_client from public.clients where phone = v_phone; end if;
    if v_client is null then
      if length(btrim(coalesce(p_name, ''))) < 1 then raise exception 'Please enter the client''s name.'; end if;
      insert into public.clients (full_name, phone, email, source)
      values (btrim(p_name), v_phone, nullif(lower(btrim(coalesce(p_email, ''))), ''), p_source)
      returning id into v_client;
    end if;
  end if;

  if not (p_force and public.is_admin()) and p_source <> 'walk_in' and not exists (
    select 1 from public.get_available_slots_staff(p_staff_id, (p_starts_at at time zone s.timezone)::date, v_dur) t
    where t = p_starts_at) then
    raise exception 'That time is outside working hours or already taken.';
  end if;

  v_new := not exists (select 1 from public.appointments where client_id = v_client and status = 'completed');
  insert into public.appointments (client_id, staff_id, service_id, addon_ids, starts_at, ends_at, price,
                                   new_client, source, internal_note)
  values (v_client, p_staff_id, svc.id, v_addons, p_starts_at, p_starts_at + make_interval(mins => v_dur),
          coalesce(p_price, case when v_new and svc.new_client_price is not null then svc.new_client_price else svc.price end + v_add_price),
          v_new, p_source, coalesce(p_note, ''))
  returning id into v_id;
  return v_id;
exception
  when exclusion_violation then raise exception 'That overlaps another booking.';
end $$;

-- Same as get_available_slots but ignores notice/window limits (staff can book last-minute).
create or replace function public.get_available_slots_staff(p_staff_id uuid, p_day date, p_duration int default 40)
returns setof timestamptz
language plpgsql stable security definer set search_path = public as $$
declare s public.settings%rowtype; dur interval; buf interval;
begin
  if not public.is_staff() then return; end if;
  select * into s from public.settings where id = 1;
  dur := make_interval(mins => greatest(coalesce(p_duration, 40), 5));
  buf := make_interval(mins => s.buffer_min);
  return query
  select g.t
  from public.working_hours wh
  cross join lateral generate_series(
      (p_day + wh.start_time) at time zone s.timezone,
      ((p_day + wh.end_time) at time zone s.timezone) - dur,
      make_interval(mins => s.slot_interval_min)) as g(t)
  where wh.staff_id = p_staff_id and wh.weekday = extract(dow from p_day)::int
    and g.t >= now() - interval '15 minutes'
    and not exists (select 1 from public.appointments a
      where a.staff_id = p_staff_id and a.status in ('booked', 'confirmed')
        and tstzrange(a.starts_at - buf, a.ends_at + buf) && tstzrange(g.t, g.t + dur))
    and not exists (select 1 from public.time_off o
      where o.staff_id = p_staff_id and tstzrange(o.starts_at, o.ends_at) && tstzrange(g.t, g.t + dur))
  order by 1;
end $$;

-- Check out: marks the visit done, records payment + tip, uses up supplies.
create or replace function public.complete_appointment(
  p_id uuid, p_amount numeric, p_tip numeric default 0, p_method public.pay_method default 'cash', p_note text default '')
returns void
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; n_add int;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not (public.is_admin() or (public.is_staff() and a.staff_id = public.my_staff_id())) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if a.status = 'completed' then raise exception 'This visit is already checked out.'; end if;
  if a.status = 'cancelled' then raise exception 'This visit was cancelled.'; end if;
  if coalesce(p_amount, -1) < 0 or coalesce(p_tip, 0) < 0 then raise exception 'Amounts can''t be negative.'; end if;

  update public.appointments set status = 'completed', completed_at = now() where id = p_id;
  insert into public.payments (appointment_id, client_id, amount, tip, method, note)
  values (p_id, a.client_id, p_amount, coalesce(p_tip, 0), p_method, coalesce(p_note, ''));
  n_add := coalesce(array_length(a.addon_ids, 1), 0);
  update public.inventory set qty = greatest(0, qty - per_cut - per_addon * n_add)
   where per_cut > 0 or (per_addon > 0 and n_add > 0);
end $$;

-- Undo a checkout (owner/manager): back to booked, payment removed, supplies restored.
create or replace function public.reopen_appointment(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; n_add int;
begin
  if not public.is_admin() then raise exception 'Only an owner or manager can undo a checkout.' using errcode = '42501'; end if;
  select * into a from public.appointments where id = p_id for update;
  if a.status <> 'completed' then return; end if;
  delete from public.payments where appointment_id = p_id;
  update public.appointments set status = 'confirmed', completed_at = null where id = p_id;
  n_add := coalesce(array_length(a.addon_ids, 1), 0);
  update public.inventory set qty = qty + per_cut + per_addon * n_add
   where per_cut > 0 or (per_addon > 0 and n_add > 0);
end $$;

-- Who can call what
revoke execute on function public.staff_book(uuid, text, text, text, uuid, uuid[], uuid, timestamptz, numeric, text, boolean, text) from anon;
revoke execute on function public.get_available_slots_staff(uuid, date, int) from anon;
revoke execute on function public.complete_appointment(uuid, numeric, numeric, public.pay_method, text) from anon;
revoke execute on function public.reopen_appointment(uuid) from anon;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.write_audit() from anon, authenticated;
revoke execute on function public.guard_profiles() from anon, authenticated;

-- =====================================================================
--  Live updates in the dashboard (new bookings pop up instantly)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.appointments;
exception when others then null; end $$;

-- =====================================================================
--  Photo storage for the portfolio
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "portfolio admin upload" on storage.objects;
create policy "portfolio admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'portfolio' and public.is_admin());
drop policy if exists "portfolio admin update" on storage.objects;
create policy "portfolio admin update" on storage.objects for update to authenticated
  using (bucket_id = 'portfolio' and public.is_admin());
drop policy if exists "portfolio admin delete" on storage.objects;
create policy "portfolio admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'portfolio' and public.is_admin());
