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
  booksy_review_count  int not null default 35,
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
  first_visit_only  boolean not null default false, -- e.g. "First Time Haircut": only for clients with no past visits
  bookable          boolean not null default true,   -- false = shown on the price list only
  active            boolean not null default true,
  sort              int not null default 0,
  created_at        timestamptz not null default now()
);
alter table public.services add column if not exists first_visit_only boolean not null default false;

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
  prior_visits      int not null default 0 check (prior_visits >= 0), -- visits before this site (Booksy)
  prior_last_visit  date,                                             -- last visit before this site
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);
alter table public.clients add column if not exists prior_visits int not null default 0 check (prior_visits >= 0);
alter table public.clients add column if not exists prior_last_visit date;
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
alter table public.appointments add column if not exists followup_sent_at timestamptz;  -- thank-you / review text sent
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
  published   boolean not null default true,         -- shows on the Full portfolio page
  on_homepage boolean not null default true,         -- also shows in the homepage carousel
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
    'business_name', business_name, 'timezone', timezone, 'instagram', instagram,
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
  if not s.booking_open then raise exception 'Online booking is paused right now. Please DM @lopezcuts.dmv on Instagram to book.'; end if;
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
    if v_client.blocked then raise exception 'Online booking isn''t available for this number. Please DM @lopezcuts.dmv on Instagram to book.'; end if;
    if v_email is not null and v_client.email is null then
      update public.clients set email = v_email where id = v_client.id;
    end if;
  end if;

  select count(*) into v_active from public.appointments
  where client_id = v_client.id and status in ('booked', 'confirmed') and starts_at > now();
  if v_active >= s.max_active_bookings then
    raise exception 'You already have % upcoming bookings. DM @lopezcuts.dmv on Instagram if you need another.', v_active;
  end if;

  v_new := v_client.prior_visits = 0
           and not exists (select 1 from public.appointments where client_id = v_client.id and status = 'completed');
  if svc.first_visit_only and not v_new then
    raise exception 'Welcome back! That option is for first visits. Please pick the returning client haircut.';
  end if;
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
    raise exception 'It''s too close to your appointment to cancel online. Please reply to Miguel''s text or DM @lopezcuts.dmv on Instagram.';
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

-- Open reviews: anyone can leave a review from the website without a booking link.
-- Every open review waits for the owner's approval before it shows on the site.
-- If the phone number matches a client with a finished visit, it's marked as a verified client.
create or replace function public.submit_open_review(p_rating int, p_body text, p_display_name text, p_phone text default '')
returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_name text := left(btrim(coalesce(p_display_name, '')), 40);
        v_body text := btrim(coalesce(p_body, ''));
        v_phone text := public.norm_phone(p_phone);
        v_client uuid; v_label text := 'Client';
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Please choose 1 to 5 stars.'; end if;
  if length(v_name) < 2 then raise exception 'Please add your name.'; end if;
  if length(v_body) > 1000 then raise exception 'Please keep your review under 1,000 characters.'; end if;
  if v_body ~* '(https?://|www\.)' then raise exception 'Please leave links out of your review.'; end if;
  -- spam guards: no repeats, and a cap on how many unapproved open reviews can pile up
  if exists (select 1 from public.reviews where appointment_id is null and source = 'site'
             and lower(display_name) = lower(v_name) and created_at > now() - interval '1 day') then
    raise exception 'Thanks! We already got a review from you today.';
  end if;
  if (select count(*) from public.reviews where appointment_id is null and source = 'site' and status = 'pending'
      and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Lots of reviews coming in right now. Please try again in a bit.';
  end if;
  if v_phone is not null then
    select c.id into v_client from public.clients c where c.phone = v_phone
      and exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'completed');
    if v_client is not null then
      if exists (select 1 from public.reviews where client_id = v_client and created_at > now() - interval '7 days') then
        raise exception 'Thanks! You already left a review this week.';
      end if;
      v_label := 'Verified Client';
    end if;
  end if;
  insert into public.reviews (appointment_id, client_id, rating, body, display_name, label, source, status)
  values (null, v_client, p_rating, v_body, v_name, v_label, 'site', 'pending');
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

  v_new := not exists (select 1 from public.clients where id = v_client and prior_visits > 0)
           and not exists (select 1 from public.appointments where client_id = v_client and status = 'completed');
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
--  Client totals over their whole history (dashboard Clients page).
--  security_invoker: the view obeys the same row rules as the tables,
--  so employees only see their own clients and never see money.
-- =====================================================================
create or replace view public.client_stats with (security_invoker = true) as
select c.id as client_id,
       (count(a.id) filter (where a.status = 'completed') + c.prior_visits)::int as visits,
       greatest(max(a.starts_at) filter (where a.status = 'completed'),
                (c.prior_last_visit + time '18:00') at time zone 'UTC') as last_visit,
       min(a.starts_at) filter (where a.status in ('booked', 'confirmed') and a.starts_at > now()) as next_visit,
       (count(a.id) filter (where a.status = 'no_show'))::int as no_shows,
       (count(a.id) filter (where a.status = 'cancelled'))::int as cancels,
       coalesce((select sum(p.amount + p.tip) from public.payments p
                 where p.client_id = c.id
                    or p.appointment_id in (select x.id from public.appointments x where x.client_id = c.id)), 0) as spend,
       coalesce((select sum(p.tip) from public.payments p
                 where p.client_id = c.id
                    or p.appointment_id in (select x.id from public.appointments x where x.client_id = c.id)), 0) as tips
from public.clients c
left join public.appointments a on a.client_id = c.id
group by c.id;
revoke all on public.client_stats from anon;
grant select on public.client_stats to authenticated;

-- =====================================================================
--  CLIENT TEXTS. Manual mode (default): texts wait on the Today page and
--  you send them from your own phone. Auto mode: a Twilio account sends
--  them through the send-text Edge Function.
--  Appointments drop a message into sms_outbox; the Edge Function sends
--  it through Twilio and records the result. Only owner/manager can read
--  the log. Visitors and employees can't read or write it.
-- =====================================================================
-- off = no texts; manual = texts wait on the Today page for you to send from your phone (free);
-- auto = sent by Twilio.
alter table public.settings add column if not exists text_mode text not null default 'manual' check (text_mode in ('off', 'manual', 'auto'));
alter table public.settings add column if not exists sms_followup_hour int not null default 11 check (sms_followup_hour between 6 and 21);
alter table public.settings add column if not exists site_url text not null default 'https://www.lopezcuts.com';

create table if not exists public.sms_outbox (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments (id) on delete cascade,
  client_id       uuid references public.clients (id) on delete set null,
  kind            text not null check (kind in ('booked', 'rescheduled', 'cancelled', 'followup')),
  to_phone        text not null,
  body            text not null,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
alter table public.sms_outbox drop constraint if exists sms_outbox_status_check;
alter table public.sms_outbox add constraint sms_outbox_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'));
create index if not exists sms_outbox_created_idx on public.sms_outbox (created_at desc);
alter table public.sms_outbox enable row level security;
drop policy if exists sms_outbox_admin_read on public.sms_outbox;
create policy sms_outbox_admin_read on public.sms_outbox for select to authenticated using (public.is_admin());
revoke all on public.sms_outbox from anon;
revoke insert, update, delete on public.sms_outbox from authenticated;
-- Owner/manager can mark a text as sent or skipped from the dashboard (nothing else).
grant update (status, sent_at, error) on public.sms_outbox to authenticated;
drop policy if exists sms_outbox_admin_mark on public.sms_outbox;
create policy sms_outbox_admin_mark on public.sms_outbox for update to authenticated using (public.is_admin()) with check (public.is_admin() and status in ('sent', 'skipped'));

-- Builds the words of each text. Edit the wording here.
create or replace function public.sms_body(p_kind text, p_appt uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  s public.settings%rowtype; a public.appointments%rowtype; c public.clients%rowtype;
  v_first text; v_when text; v_stop text; v_svc text; v_link text; v_site text; v_visits int;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where id = p_appt;
  select * into c from public.clients where id = a.client_id;
  v_first := split_part(trim(c.full_name), ' ', 1);
  v_when := to_char(a.starts_at at time zone s.timezone, 'FMDay, FMMon FMDD "at" FMHH12:MI AM');
  v_svc := coalesce((select name from public.services where id = a.service_id), 'haircut');
  v_site := rtrim(s.site_url, '/');
  v_link := v_site || '/#manage-' || a.manage_token;
  v_stop := case when s.text_mode = 'auto' then E'\nReply STOP to opt out.' else '' end;
  if p_kind = 'booked' then
    return format(E'Hi %s! Your booking with %s went through: %s (%s).\nMiguel will text you the day of your appointment.\nNeed to change it? %s%s',
                  v_first, s.business_name, v_when, v_svc, v_link, v_stop);
  elsif p_kind = 'rescheduled' then
    return format(E'Hi %s, Miguel moved your %s appointment to %s.\nIf that time doesn''t work, change it here: %s or text %s.',
                  v_first, s.business_name, v_when, v_link, s.phone);
  elsif p_kind = 'cancelled' then
    return format(E'Hi %s, sorry! Miguel had to cancel your %s appointment on %s.%s\nBook a new time here: %s',
                  v_first, s.business_name, v_when,
                  case when coalesce(a.cancel_reason, '') <> '' then E'\nNote: ' || a.cancel_reason else '' end, v_site);
  else
    v_visits := c.prior_visits + (select count(*) from public.appointments where client_id = c.id and status = 'completed');
    if a.new_client or v_visits <= 1 then
      return format(E'Thanks for coming in, %s! Hope you love the cut.\nReady for the next one? Book anytime: %s\nIf you have a minute, a quick review helps me a lot: %s\nKnow someone who needs a cut? Send them %s (first cuts are $25).',
                    v_first, v_site, v_link, v_site);
    end if;
    return format(E'Thanks for coming in, %s! Book your next cut anytime: %s\nA quick review helps a lot: %s\nAnd send your friends my way: %s',
                  v_first, v_site, v_link, v_site);
  end if;
end $$;
revoke execute on function public.sms_body(text, uuid) from public, anon, authenticated;

create or replace function public.queue_sms(p_kind text, p_appt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text; v_client uuid;
begin
  if coalesce((select text_mode from public.settings where id = 1), 'off') = 'off' then return; end if;
  select c.phone, c.id into v_phone, v_client from public.appointments a join public.clients c on c.id = a.client_id where a.id = p_appt;
  if v_phone is null or length(v_phone) < 11 then return; end if;
  insert into public.sms_outbox (appointment_id, client_id, kind, to_phone, body)
  values (p_appt, v_client, p_kind, '+' || v_phone, public.sms_body(p_kind, p_appt));
exception when others then
  raise warning 'Text not queued: %', sqlerrm;  -- a text problem must never block a booking
end $$;
revoke execute on function public.queue_sms(text, uuid) from public, anon, authenticated;

create or replace function public.appointments_texts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('booked', 'confirmed') and new.starts_at > now() then perform public.queue_sms('booked', new.id); end if;
  elsif new.status = 'cancelled' and old.status in ('booked', 'confirmed') and coalesce(new.cancelled_by, 'shop') = 'shop' and new.starts_at > now() then
    perform public.queue_sms('cancelled', new.id);
  elsif new.status in ('booked', 'confirmed') and old.status in ('booked', 'confirmed') and new.starts_at <> old.starts_at and new.starts_at > now() then
    perform public.queue_sms('rescheduled', new.id);
  end if;
  return null;
end $$;
drop trigger if exists appointments_texts on public.appointments;
create trigger appointments_texts after insert or update of status, starts_at on public.appointments
  for each row execute function public.appointments_texts();

-- Day-after thank-you texts. Runs every hour; sends at the hour set in
-- Settings (local time) for yesterday's finished visits that haven't
-- had a thank-you yet and haven't left a review.
create or replace function public.queue_followups()
returns int language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; r record; n int := 0; v_today date;
begin
  select * into s from public.settings where id = 1;
  if s.text_mode <> 'auto' then return 0; end if;  -- manual mode: thank-yous show on the Today page
  if extract(hour from now() at time zone s.timezone) <> s.sms_followup_hour then return 0; end if;
  v_today := (now() at time zone s.timezone)::date;
  for r in
    select a.id from public.appointments a
    where a.status = 'completed' and a.followup_sent_at is null
      and (a.starts_at at time zone s.timezone)::date = v_today - 1
      and not exists (select 1 from public.reviews rv where rv.appointment_id = a.id)
  loop
    perform public.queue_sms('followup', r.id);
    update public.appointments set followup_sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_followups() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('lopezcuts-followups') where exists (select 1 from cron.job where jobname = 'lopezcuts-followups');
  perform cron.schedule('lopezcuts-followups', '2 * * * *', 'select public.queue_followups()');
exception when others then
  raise notice 'Cron is not on yet: in Supabase open Integrations → Cron, enable it, then run this file again.';
end $$;

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

-- ---------- Phone notifications (owner app) ----------

-- Each phone that turned notifications on
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  endpoint        text not null unique check (endpoint like 'https://%'),
  p256dh          text not null,
  auth            text not null,
  device          text not null default '',
  notify_bookings boolean not null default true,
  notify_cancels  boolean not null default true,
  last_ok_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_own_read on public.push_subscriptions;
create policy push_own_read on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_own_upd on public.push_subscriptions;
create policy push_own_upd on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_own_del on public.push_subscriptions;
create policy push_own_del on public.push_subscriptions for delete using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon;
revoke insert on public.push_subscriptions from authenticated;
revoke update on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant update (notify_bookings, notify_cancels, device) on public.push_subscriptions to authenticated;

-- The sending keys. Only the notify-owner function (service role) can read them.
create table if not exists public.push_keys (
  id          int primary key check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;

-- One notification per appointment per event, even if the webhook retries
create table if not exists public.push_sent (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  kind           text not null,
  sent_at        timestamptz not null default now(),
  primary key (appointment_id, kind)
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- Save this phone (signed-in team members only)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text default '')
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 1000 then raise exception 'That phone didn''t give a valid notification address.'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(coalesce(p_device, ''), 60))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;


-- ---------- Email alerts ----------
alter table public.settings add column if not exists notify_email   text not null default 'miguel@lopezcuts.com';
alter table public.settings add column if not exists email_bookings boolean not null default true;
alter table public.settings add column if not exists email_cancels  boolean not null default true;

-- ---------- Break-in protection (3 tries = 1 hour lock) ----------
create table if not exists public.security_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ip          text not null default '',
  email       text not null default '',
  stage       text not null default 'password' check (stage in ('password', 'code')),
  user_agent  text not null default '',
  notified_at timestamptz
);
create index if not exists security_events_ip_at on public.security_events (ip, at desc);
alter table public.security_events enable row level security;
revoke all on public.security_events from anon, authenticated;
drop policy if exists security_events_owner_read on public.security_events;
create policy security_events_owner_read on public.security_events for select using (public.is_owner());
grant select on public.security_events to authenticated;

-- The visitor's internet address, as seen by Supabase
create or replace function public.client_ip() returns text
language sql stable as $$
  select coalesce(nullif(btrim(split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for',
             current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''), ',', 1)), ''), '')
$$;

-- When this address is locked until (null = not locked)
create or replace function public.lock_until(p_ip text default null) returns timestamptz
language sql stable security definer set search_path = public as $$
  with f as (
    select at from public.security_events
     where ip = coalesce(p_ip, public.client_ip()) and ip <> '' and at > now() - interval '1 hour'
     order by at desc limit 3)
  select case when count(*) >= 3 then min(at) + interval '1 hour' end from f
$$;

create or replace function public.ip_locked() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.lock_until() > now(), false) $$;

-- The sign-in page calls this after a failed try. Returns when the lock ends, if locked.
create or replace function public.report_failed_login(p_email text default '', p_stage text default 'password')
returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_ip text := public.client_ip(); v_ua text;
begin
  v_ua := left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 200);
  -- cap the log at 20 entries per address per hour so it can't be flooded
  if (select count(*) from public.security_events where ip = v_ip and at > now() - interval '1 hour') < 20 then
    insert into public.security_events (ip, email, stage, user_agent)
    values (v_ip, left(lower(btrim(coalesce(p_email, ''))), 120), case when p_stage = 'code' then 'code' else 'password' end, v_ua);
  end if;
  return json_build_object('locked_until', public.lock_until(v_ip));
end $$;

create or replace function public.login_lock_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('locked_until', public.lock_until())
$$;
grant execute on function public.report_failed_login(text, text) to anon, authenticated;
grant execute on function public.login_lock_status() to anon, authenticated;
revoke execute on function public.lock_until(text) from public, anon, authenticated;

-- A locked address sees nothing, even when signed in
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
  ) and not public.ip_locked();
$$;


-- ---------- Phone-only alerts: own bookings + confirmations ----------
alter table public.push_subscriptions add column if not exists notify_manual   boolean not null default true;
alter table public.push_subscriptions add column if not exists notify_confirms boolean not null default true;
grant update (notify_bookings, notify_cancels, notify_manual, notify_confirms, device) on public.push_subscriptions to authenticated;

-- ---------- "How did you find me?" (see updates/2026-11-08-how-found.sql) ----------
alter table public.clients add column if not exists heard_from text;
alter table public.clients drop constraint if exists clients_heard_from_check;
alter table public.clients add constraint clients_heard_from_check
  check (heard_from is null or heard_from in ('instagram', 'friend', 'snapchat', 'tiktok', 'google', 'flyer', 'booksy', 'other'));
alter table public.clients add column if not exists heard_from_at timestamptz;

-- Called right after a booking, with that booking's private link token, so only
-- the person who just booked can answer for that client.
create or replace function public.set_heard_from(p_token uuid, p_heard_from text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare v_src text := lower(btrim(coalesce(p_heard_from, '')));
begin
  if v_src not in ('instagram', 'friend', 'snapchat', 'tiktok', 'google', 'flyer', 'booksy', 'other') then
    return json_build_object('ok', false);
  end if;
  update public.clients c set heard_from = v_src, heard_from_at = now()
  from public.appointments a
  where a.manage_token = p_token and a.client_id = c.id
    and a.created_at > now() - interval '1 hour'
    and c.heard_from is null;
  return json_build_object('ok', true);
end $$;
grant execute on function public.set_heard_from(uuid, text) to anon, authenticated;

-- =====================================================================
--  FIND MY APPOINTMENT (also in updates/2026-11-11-find-appointment.sql)
-- =====================================================================
create table if not exists public.lookup_attempts (
  id     bigserial primary key,
  ip     text not null default '',
  phone  text not null default '',
  ok     boolean not null default false,
  at     timestamptz not null default now()
);
create index if not exists lookup_attempts_at_idx on public.lookup_attempts (at);
alter table public.lookup_attempts enable row level security;
revoke all on public.lookup_attempts from anon, authenticated;

create or replace function public.find_appointment(p_phone text, p_first_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ip    text := public.client_ip();
  v_phone text := public.norm_phone(p_phone);
  v_first text := lower(regexp_replace(split_part(btrim(coalesce(p_first_name, '')), ' ', 1), '[^[:alpha:]]', '', 'g'));
  v_client public.clients%rowtype;
  v_list json;
begin
  if v_phone is null then raise exception 'Please enter the mobile number you booked with.'; end if;
  if length(v_first) < 1 then raise exception 'Please enter your first name.'; end if;

  delete from public.lookup_attempts where at < now() - interval '1 day';
  if (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and ip = v_ip and v_ip <> '') >= 8
     or (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and phone = v_phone) >= 5 then
    raise exception 'Too many tries. Please wait an hour, or DM @lopezcuts.dmv on Instagram.';
  end if;

  select * into v_client from public.clients c
   where c.phone = v_phone
     and lower(regexp_replace(split_part(btrim(c.full_name), ' ', 1), '[^[:alpha:]]', '', 'g')) = v_first;

  if not found then
    insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, false);
    return json_build_object('found', false, 'appointments', '[]'::json);
  end if;

  insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, true);
  select coalesce(json_agg(x order by x.starts_at), '[]'::json) into v_list from (
    select a.starts_at, a.ends_at, a.status, a.price,
           sv.name as service, st.display_name as staff,
           (select coalesce(array_agg(z.name), '{}') from public.services z where z.id = any (a.addon_ids)) as addons
      from public.appointments a
      join public.staff st on st.id = a.staff_id
      left join public.services sv on sv.id = a.service_id
     where a.client_id = v_client.id and a.status in ('booked', 'confirmed') and a.ends_at > now()
     order by a.starts_at
     limit 5) x;

  return json_build_object('found', true, 'first_name', split_part(btrim(v_client.full_name), ' ', 1), 'appointments', v_list);
end $$;
revoke execute on function public.find_appointment(text, text) from public;
grant execute on function public.find_appointment(text, text) to anon, authenticated;

-- =====================================================================
--  SAFETY PASS (also in updates/2026-11-11-safety-pass.sql)
-- =====================================================================
-- Extra locks. None of these change how the site works.
-- 1. Pin where each helper looks things up, so nothing can be swapped in underneath it.
alter function public.mfa_required() set search_path = public;
alter function public.is_owner() set search_path = public;
alter function public.is_admin() set search_path = public;
alter function public.is_staff() set search_path = public;
alter function public.norm_phone(text) set search_path = public;
alter function public.client_ip() set search_path = public;
-- 2. Dashboard-only actions already check who is signed in. This also stops
--    visitors who aren't signed in from calling them at all.
revoke execute on function public.staff_book(uuid, text, text, text, uuid, uuid[], uuid, timestamptz, numeric, text, boolean, text) from public, anon;
revoke execute on function public.get_available_slots_staff(uuid, date, int) from public, anon;
revoke execute on function public.complete_appointment(uuid, numeric, numeric, public.pay_method, text) from public, anon;
revoke execute on function public.reopen_appointment(uuid) from public, anon;
grant execute on function public.staff_book(uuid, text, text, text, uuid, uuid[], uuid, timestamptz, numeric, text, boolean, text) to authenticated;
grant execute on function public.get_available_slots_staff(uuid, date, int) to authenticated;
grant execute on function public.complete_appointment(uuid, numeric, numeric, public.pay_method, text) to authenticated;
grant execute on function public.reopen_appointment(uuid) to authenticated;

-- =====================================================================
--  RESCHEDULE + CLIENT EMAILS (also in updates/2026-11-11-reschedule-and-emails.sql)
-- =====================================================================
alter table public.settings add column if not exists email_clients boolean not null default true;

-- What the client sees on their private booking link (now also says whether
-- it can be moved, and what the picker needs to show open times).
create or replace function public.get_booking(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'first_name', split_part(c.full_name, ' ', 1),
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'price', a.price,
    'service', sv.name, 'staff', st.display_name,
    'staff_id', a.staff_id,
    'duration_min', (extract(epoch from (a.ends_at - a.starts_at)) / 60)::int,
    'addons', (select coalesce(array_agg(x.name), '{}') from public.services x where x.id = any (a.addon_ids)),
    'can_cancel', a.status in ('booked', 'confirmed')
                  and a.starts_at > now() + make_interval(hours => s.cancel_cutoff_hours),
    'can_reschedule', a.status in ('booked', 'confirmed')
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

-- Move a booking to another open time. Only works with the private booking
-- link, only for upcoming bookings, and only into a time that is really open.
create or replace function public.reschedule_booking(p_token uuid, p_starts_at timestamptz) returns json
language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments%rowtype; s public.settings%rowtype; v_dur int;
begin
  select * into s from public.settings where id = 1;
  select * into a from public.appointments where manage_token = p_token for update;
  if not found then raise exception 'We couldn''t find that booking.'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'This booking can''t be changed anymore.'; end if;
  if a.starts_at <= now() + make_interval(hours => s.cancel_cutoff_hours) then
    raise exception 'It''s too close to your appointment to change it online. Please reply to Miguel''s text or DM @lopezcuts.dmv on Instagram.';
  end if;
  if p_starts_at is null or p_starts_at = a.starts_at then raise exception 'Please pick a different time.'; end if;
  v_dur := (extract(epoch from (a.ends_at - a.starts_at)) / 60)::int;
  if not exists (
    select 1 from public.get_available_slots(a.staff_id, (p_starts_at at time zone s.timezone)::date, v_dur) t
    where t = p_starts_at) then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
  end if;
  -- tells the texts trigger the client moved it (so no "Miguel moved your appointment" text)
  perform set_config('lopezcuts.moved_by', 'client', true);
  update public.appointments
     set starts_at = p_starts_at, ends_at = p_starts_at + make_interval(mins => v_dur), reminder_sent_at = null
   where id = a.id;
  return public.get_booking(p_token);
exception
  when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
end $$;
revoke execute on function public.reschedule_booking(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking(uuid, timestamptz) to anon, authenticated;

-- Same trigger as before, except a move the client made themselves doesn't
-- queue the "Miguel moved your appointment" text.
create or replace function public.appointments_texts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('booked', 'confirmed') and new.starts_at > now() then perform public.queue_sms('booked', new.id); end if;
  elsif new.status = 'cancelled' and old.status in ('booked', 'confirmed') and coalesce(new.cancelled_by, 'shop') = 'shop' and new.starts_at > now() then
    perform public.queue_sms('cancelled', new.id);
  elsif new.status in ('booked', 'confirmed') and old.status in ('booked', 'confirmed') and new.starts_at <> old.starts_at and new.starts_at > now()
        and coalesce(current_setting('lopezcuts.moved_by', true), '') <> 'client' then
    perform public.queue_sms('rescheduled', new.id);
  end if;
  return null;
end $$;


-- =====================================================================
--  REMINDER EMAILS (also in updates/2026-11-11-reminder-emails.sql)
-- =====================================================================
create table if not exists public.email_reminders (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  starts_at      timestamptz not null,
  claimed_at     timestamptz not null default now(),
  primary key (appointment_id, starts_at)
);
alter table public.email_reminders enable row level security;
revoke all on public.email_reminders from anon, authenticated;

-- Which appointments are due a reminder right now.
create or replace function public.due_email_reminders()
returns table (appointment_id uuid, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.starts_at
    from appointments a
    join clients c on c.id = a.client_id
   where a.status in ('booked', 'confirmed')
     and a.starts_at >  now() + interval '12 hours'
     and a.starts_at <= now() + interval '24 hours'
     and a.created_at < now() - interval '3 hours'
     and c.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and coalesce((select s.email_clients from settings s where s.id = 1), true)
     and not exists (select 1 from email_reminders r where r.appointment_id = a.id and r.starts_at = a.starts_at);
$$;

-- Called by the notify-owner function: marks the due ones as taken so no one is emailed twice.
create or replace function public.claim_email_reminders()
returns setof uuid
language sql security definer set search_path = public as $$
  insert into email_reminders (appointment_id, starts_at)
  select d.appointment_id, d.starts_at from due_email_reminders() d
  on conflict do nothing
  returning appointment_id;
$$;

-- Called every hour: wakes the notify-owner function only when something is due.
-- It reuses the address and key of the notify-owner webhook that already exists on appointments.
create or replace function public.send_email_reminders()
returns text
language plpgsql security definer set search_path = public as $$
declare v_args text[];
begin
  if not exists (select 1 from due_email_reminders()) then return 'nothing due'; end if;
  select string_to_array(encode(t.tgargs, 'escape'), '\000') into v_args
    from pg_trigger t
   where t.tgrelid = 'public.appointments'::regclass and not t.tgisinternal
     and encode(t.tgargs, 'escape') like '%/functions/v1/notify-owner%'
   limit 1;
  if v_args is null then return 'notify-owner webhook not found'; end if;
  perform net.http_post(url := v_args[1], headers := v_args[3]::jsonb, body := '{"cron":"reminders"}'::jsonb);
  return 'called';
end $$;

revoke all on function public.due_email_reminders()   from public, anon, authenticated;
revoke all on function public.claim_email_reminders() from public, anon, authenticated;
revoke all on function public.send_email_reminders()  from public, anon, authenticated;
grant execute on function public.claim_email_reminders() to service_role;

-- The hourly schedule.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('lopezcuts-email-reminders') where exists (select 1 from cron.job where jobname = 'lopezcuts-email-reminders');
  perform cron.schedule('lopezcuts-email-reminders', '7 * * * *', 'select public.send_email_reminders()');
exception when others then
  raise notice 'Could not set the hourly schedule: %', sqlerrm;
end $$;


-- =====================================================================
--  EMAIL REQUIRED + EMAILED BOOKING LINK (also in updates/2026-11-11-email-link.sql)
-- =====================================================================
-- 1. Each online booking keeps the email typed for THAT booking. Its confirmation, reminder
--    and booking link only ever go to that address, so nobody can redirect another
--    client's emails by booking with their phone number.
alter table public.appointments add column if not exists contact_email text;

-- 2. Booking online now needs an email.
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
  if not s.booking_open then raise exception 'Online booking is paused right now. Please DM @lopezcuts.dmv on Instagram to book.'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if v_phone is null then raise exception 'Please enter a valid phone number.'; end if;
  if v_email is null then raise exception 'Please enter your email so we can send your confirmation.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'That email address doesn''t look right.'; end if;
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
    if v_client.blocked then raise exception 'Online booking isn''t available for this number. Please DM @lopezcuts.dmv on Instagram to book.'; end if;
    if v_email is not null and v_client.email is null then
      update public.clients set email = v_email where id = v_client.id;
    end if;
  end if;

  select count(*) into v_active from public.appointments
  where client_id = v_client.id and status in ('booked', 'confirmed') and starts_at > now();
  if v_active >= s.max_active_bookings then
    raise exception 'You already have % upcoming bookings. DM @lopezcuts.dmv on Instagram if you need another.', v_active;
  end if;

  v_new := v_client.prior_visits = 0
           and not exists (select 1 from public.appointments where client_id = v_client.id and status = 'completed');
  if svc.first_visit_only and not v_new then
    raise exception 'Welcome back! That option is for first visits. Please pick the returning client haircut.';
  end if;
  v_price := case when v_new and svc.new_client_price is not null then svc.new_client_price else svc.price end + v_add_price;

  insert into public.appointments (client_id, staff_id, service_id, addon_ids, starts_at, ends_at,
                                   price, new_client, source, client_message, created_by, contact_email)
  values (v_client.id, p_staff_id, svc.id, v_addons, p_starts_at, p_starts_at + make_interval(mins => v_dur),
          v_price, v_new, 'online', coalesce(p_note, ''), null, v_email)
  returning * into v_appt;

  return json_build_object(
    'token', v_appt.manage_token, 'starts_at', v_appt.starts_at, 'ends_at', v_appt.ends_at,
    'price', v_price, 'new_client', v_new, 'service', svc.name, 'addons', v_add_names,
    'staff', (select display_name from public.staff where id = p_staff_id), 'status', v_appt.status);
exception
  when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another one.';
end $$;

-- 3. The lookup stays view-only. It also says whether a booking link can be emailed.
create or replace function public.find_appointment(p_phone text, p_first_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ip    text := public.client_ip();
  v_phone text := public.norm_phone(p_phone);
  v_first text := lower(regexp_replace(split_part(btrim(coalesce(p_first_name, '')), ' ', 1), '[^[:alpha:]]', '', 'g'));
  v_client public.clients%rowtype;
  v_list json;
begin
  if v_phone is null then raise exception 'Please enter the mobile number you booked with.'; end if;
  if length(v_first) < 1 then raise exception 'Please enter your first name.'; end if;

  delete from public.lookup_attempts where at < now() - interval '1 day';
  if (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and ip = v_ip and v_ip <> '') >= 8
     or (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and phone = v_phone) >= 5 then
    raise exception 'Too many tries. Please wait an hour, or DM @lopezcuts.dmv on Instagram.';
  end if;

  select * into v_client from public.clients c
   where c.phone = v_phone
     and lower(regexp_replace(split_part(btrim(c.full_name), ' ', 1), '[^[:alpha:]]', '', 'g')) = v_first;

  if not found then
    insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, false);
    return json_build_object('found', false, 'appointments', '[]'::json);
  end if;

  insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, true);
  select coalesce(json_agg(x order by x.starts_at), '[]'::json) into v_list from (
    select a.starts_at, a.ends_at, a.status, a.price,
           (coalesce(a.contact_email, v_client.email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') as can_email,
           sv.name as service, st.display_name as staff,
           (select coalesce(array_agg(z.name), '{}') from public.services z where z.id = any (a.addon_ids)) as addons
      from public.appointments a
      join public.staff st on st.id = a.staff_id
      left join public.services sv on sv.id = a.service_id
     where a.client_id = v_client.id and a.status in ('booked', 'confirmed') and a.ends_at > now()
     order by a.starts_at
     limit 5) x;

  return json_build_object('found', true, 'first_name', split_part(btrim(v_client.full_name), ' ', 1), 'appointments', v_list);
end $$;
revoke execute on function public.find_appointment(text, text) from public;
grant execute on function public.find_appointment(text, text) to anon, authenticated;


-- 4. Reminders use the booking's own email first.
-- Which appointments are due a reminder right now.
create or replace function public.due_email_reminders()
returns table (appointment_id uuid, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.starts_at
    from appointments a
    join clients c on c.id = a.client_id
   where a.status in ('booked', 'confirmed')
     and a.starts_at >  now() + interval '12 hours'
     and a.starts_at <= now() + interval '24 hours'
     and a.created_at < now() - interval '3 hours'
     and coalesce(a.contact_email, c.email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     and coalesce((select s.email_clients from settings s where s.id = 1), true)
     and not exists (select 1 from email_reminders r where r.appointment_id = a.id and r.starts_at = a.starts_at);
$$;


-- 5. "Email me my link": the lookup screen can ask for the private booking link to be
--    emailed. It is only ever sent to the email already on the booking.
create table if not exists public.link_requests (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
alter table public.link_requests enable row level security;
revoke all on public.link_requests from anon, authenticated;

create or replace function public.request_booking_link(p_phone text, p_first_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ip    text := public.client_ip();
  v_phone text := public.norm_phone(p_phone);
  v_first text := lower(regexp_replace(split_part(btrim(coalesce(p_first_name, '')), ' ', 1), '[^[:alpha:]]', '', 'g'));
  v_client public.clients%rowtype;
  v_args  text[];
begin
  if v_phone is null then raise exception 'Please enter the mobile number you booked with.'; end if;
  if length(v_first) < 1 then raise exception 'Please enter your first name.'; end if;
  if (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and ip = v_ip and v_ip <> '') >= 8
     or (select count(*) from public.lookup_attempts where not ok and at > now() - interval '1 hour' and phone = v_phone) >= 5 then
    raise exception 'Too many tries. Please wait an hour, or DM @lopezcuts.dmv on Instagram.';
  end if;

  select * into v_client from public.clients c
   where c.phone = v_phone
     and lower(regexp_replace(split_part(btrim(c.full_name), ' ', 1), '[^[:alpha:]]', '', 'g')) = v_first;
  if not found then
    insert into public.lookup_attempts (ip, phone, ok) values (v_ip, v_phone, false);
    return json_build_object('sent', false);
  end if;

  if not exists (select 1 from public.appointments a
                  where a.client_id = v_client.id and a.status in ('booked', 'confirmed') and a.ends_at > now()
                    and coalesce(a.contact_email, v_client.email, '') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return json_build_object('sent', false);
  end if;

  delete from public.link_requests where created_at < now() - interval '1 day';
  if (select count(*) from public.link_requests where client_id = v_client.id and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'We already emailed your link. Check your inbox and spam folder, or try again in an hour.';
  end if;
  insert into public.link_requests (client_id) values (v_client.id);

  -- wake the notify-owner function (same address and key as the appointments webhook)
  select string_to_array(encode(t.tgargs, 'escape'), '\000') into v_args
    from pg_trigger t
   where t.tgrelid = 'public.appointments'::regclass and not t.tgisinternal
     and encode(t.tgargs, 'escape') like '%/functions/v1/notify-owner%'
   limit 1;
  if v_args is null then raise exception 'We couldn''t send the email right now. Please DM @lopezcuts.dmv on Instagram.'; end if;
  perform net.http_post(url := v_args[1], headers := v_args[3]::jsonb, body := '{"cron":"links"}'::jsonb);
  return json_build_object('sent', true);
end $$;
revoke execute on function public.request_booking_link(text, text) from public;
grant execute on function public.request_booking_link(text, text) to anon, authenticated;

-- Called by the notify-owner function: hands out each fresh request once.
create or replace function public.claim_link_requests()
returns setof uuid
language sql security definer set search_path = public as $$
  update link_requests set claimed_at = now()
   where claimed_at is null and created_at > now() - interval '15 minutes'
  returning client_id;
$$;
revoke all on function public.claim_link_requests() from public, anon, authenticated;
grant execute on function public.claim_link_requests() to service_role;
