-- Security check: turns on Row Level Security for EVERY table in your database's public area
-- and then tests what a stranger on the internet (the "anon" role) can actually read.
-- Safe to run any time, as often as you like. Changes nothing except switching RLS on where it was off.

-- 1. Make sure RLS is on for every table
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS turned on for %', t.relname;
  end loop;
end $$;

-- Private views never go to the public
revoke all on public.client_stats from anon;

-- 2. Pretend to be a stranger and count what they can see in each table
create temp table if not exists _lc_check (tbl text primary key, rls_on boolean, rules int, stranger_sees text);
truncate _lc_check;
grant all on _lc_check to anon;
do $$
declare t record; n bigint; v text;
begin
  for t in select c.relname, c.relrowsecurity,
                  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as rules
             from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname loop
    begin
      execute 'set role anon';
      execute format('select count(*) from public.%I', t.relname) into n;
      execute 'reset role';
      v := case when n = 0 then 'nothing' else n || ' rows' end;
    exception when insufficient_privilege then
      execute 'reset role'; v := 'blocked';
    end;
    insert into _lc_check values (t.relname, t.relrowsecurity, t.rules, v);
  end loop;
end $$;

-- 3. The report. Every row should say rls_on = true.
--    Only these should show rows to a stranger: services, staff, working_hours, reviews (published),
--    portfolio_items (published). Clients, appointments, payments, expenses, settings, texts and
--    the activity log must say "nothing" or "blocked".
select tbl as "table", rls_on, rules, stranger_sees,
       case when not rls_on then 'FIX: RLS off'
            when stranger_sees not in ('nothing', 'blocked')
             and tbl not in ('services', 'staff', 'working_hours', 'reviews', 'portfolio_items') then 'CHECK THIS'
            else 'ok' end as status
  from _lc_check order by status desc, tbl;
