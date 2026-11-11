/* Lopezcuts data layer.
 * One API, two backends:
 *   live  → Supabase (Postgres + Auth + Storage), used when config.js has keys
 *   demo  → the same tables and functions, simulated in this browser's storage
 * Both pages (the public site and the owner dashboard) call only what is below,
 * so switching from demo to live needs no code changes.
 */
(function () {
  'use strict';
  const CFG = window.LOPEZCUTS_CONFIG || {};
  const LIVE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  // supabase-js 2.45.4, served from this site (no third-party script host needed)
  const SUPABASE_JS = new URL('../vendor/supabase.js', (document.currentScript && document.currentScript.src) || location.href).href;

  // ------------------------------------------------------------------
  // Time helpers (all business times are shown in the shop's time zone)
  // ------------------------------------------------------------------
  const T = {
    tz: 'America/Denver',
    parts(date, tz = T.tz) {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const o = {}; f.formatToParts(date).forEach(p => { o[p.type] = p.value; }); return o;
    },
    offset(date, tz = T.tz) {
      const p = T.parts(date, tz);
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return asUtc - Math.floor(date.getTime() / 1000) * 1000;
    },
    // "2026-11-04" + "15:20" in the shop's zone → Date
    zoned(day, time, tz = T.tz) {
      const [y, m, d] = day.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
      const guess = Date.UTC(y, m - 1, d, hh, mm);
      const o1 = T.offset(new Date(guess), tz); let t = guess - o1;
      const o2 = T.offset(new Date(t), tz); if (o2 !== o1) t = guess - o2;
      return new Date(t);
    },
    day(date, tz = T.tz) { const p = T.parts(new Date(date), tz); return `${p.year}-${p.month}-${p.day}`; },
    today() { return T.day(new Date()); },
    addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    weekday(day) { return new Date(day + 'T12:00:00Z').getUTCDay(); },
    minutes(date, tz = T.tz) { const p = T.parts(new Date(date), tz); return (+p.hour % 24) * 60 + +p.minute; },
    time(date, tz = T.tz) { return new Date(date).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }); },
    date(date, opts = { weekday: 'short', month: 'short', day: 'numeric' }, tz = T.tz) { return new Date(date).toLocaleDateString('en-US', { timeZone: tz, ...opts }); },
    dayLabel(day, opts = { weekday: 'short', month: 'short', day: 'numeric' }) { return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts }); },
    hm(mins) { const h = Math.floor(mins / 60), m = mins % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; },
    fmtHm(hm) { const [h, m] = hm.split(':').map(Number); return `${(h % 12) || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; },
  };

  const money = (n, cents = false) => { const v = Number(n || 0); return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }); };
  const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10) d = '1' + d; return d.length >= 11 && d.length <= 15 ? d : null; };
  const fmtPhone = p => { const d = String(p || '').replace(/\D/g, ''); const x = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : (p || ''); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  class ApiError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
  function friendly(err) {
    if (!err) return new ApiError('Something went wrong. Try again.');
    const m = err.message || String(err);
    if (/permission denied|row-level security|42501/i.test(m + (err.code || ''))) return new ApiError('Your account doesn\'t have access to that.', 'forbidden');
    if (/not been invited|Database error saving new user/i.test(m)) return new ApiError('That email hasn\'t been invited. Ask the owner to add you under Settings → Team.', 'not_invited');
    if (/Failed to fetch|NetworkError/i.test(m)) return new ApiError('Can\'t reach the server. Check your connection and try again.', 'network');
    if (/JWT|token is expired/i.test(m)) return new ApiError('Your session expired. Sign in again.', 'expired');
    return new ApiError(m.replace(/^ERROR:\s*/, ''), err.code);
  }

  const listeners = new Set();
  const emit = (what) => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });

  // ==================================================================
  //  LIVE BACKEND (Supabase)
  // ==================================================================
  function liveBackend() {
    let sb;
    const ready = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SUPABASE_JS;
      s.onload = () => {
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        resolve();
      };
      s.onerror = () => reject(new ApiError('Couldn\'t load the database library. Check your connection.'));
      document.head.appendChild(s);
    });
    const q = async (p) => { const { data, error } = await p; if (error) throw friendly(error); return data; };

    return {
      mode: 'live', ready,
      async rpc(name, args) { await ready; return q(sb.rpc(name, args || {})); },
      async fn(name, body) {
        await ready; const { data, error } = await sb.functions.invoke(name, { body: body || {} });
        if (error) { let m = ''; try { m = (await error.context.json()).error; } catch { } throw new ApiError(m || `Couldn't reach ${name}. Is that function deployed in Supabase?`); }
        return data;
      },
      async list(table, o = {}) {
        await ready; const out = []; const page = 1000;
        for (let from = 0; ; from += page) {
          let x = sb.from(table).select(o.select || '*');
          for (const [k, v] of Object.entries(o.eq || {})) x = x.eq(k, v);
          for (const [k, v] of Object.entries(o.gte || {})) x = x.gte(k, v);
          for (const [k, v] of Object.entries(o.lte || {})) x = x.lte(k, v);
          if (o.order) x = x.order(o.order, { ascending: o.asc !== false });
          x = x.range(from, from + page - 1);
          const data = await q(x); out.push(...data);
          if (data.length < page || (o.limit && out.length >= o.limit)) break;
        }
        return o.limit ? out.slice(0, o.limit) : out;
      },
      async insert(table, row) { await ready; const d = await q(sb.from(table).insert(row).select()); emit(table); return d && d[0]; },
      async insertMany(table, rows) { await ready; const out = []; for (let i = 0; i < rows.length; i += 200) { const d = await q(sb.from(table).insert(rows.slice(i, i + 200)).select()); out.push(...(d || [])); } emit(table); return out; },
      async update(table, id, patch, key = 'id') { await ready; const d = await q(sb.from(table).update(patch).eq(key, id).select()); emit(table); return d && d[0]; },
      async upsert(table, row, onConflict) { await ready; const d = await q(sb.from(table).upsert(row, onConflict ? { onConflict } : undefined).select()); emit(table); return d && d[0]; },
      async remove(table, id, key = 'id') { await ready; await q(sb.from(table).delete().eq(key, id)); emit(table); },
      async upload(file) {
        await ready;
        const blob = await resizeImage(file, 1600, 'blob');
        const path = `${new Date().toISOString().slice(0, 7)}/${uuid()}.jpg`;
        await q(sb.storage.from('portfolio').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
        return sb.storage.from('portfolio').getPublicUrl(path).data.publicUrl;
      },
      realtime(onChange) {
        ready.then(() => {
          sb.channel('lc-appointments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, p => onChange(p))
            .subscribe();
        });
      },
      auth: {
        async session() { await ready; const { data } = await sb.auth.getSession(); return data.session; },
        onChange(fn) { ready.then(() => sb.auth.onAuthStateChange((ev, s) => fn(ev, s))); },
        async signInPassword(email, password) { await ready; return q(sb.auth.signInWithPassword({ email, password })); },
        async sendLink(email) {
          await ready;
          return q(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } }));
        },
        async signOut() { await ready; await sb.auth.signOut(); },
        async setPassword(password) { await ready; return q(sb.auth.updateUser({ password })); },
        async profile() {
          await ready; const { data: { user } } = await sb.auth.getUser(); if (!user) return null;
          const rows = await q(sb.from('profiles').select('*').eq('id', user.id));
          return rows[0] ? { ...rows[0], email: user.email } : { id: user.id, email: user.email, role: null };
        },
        async aal() { await ready; return q(sb.auth.mfa.getAuthenticatorAssuranceLevel()); },
        async factors() { await ready; const d = await q(sb.auth.mfa.listFactors()); return (d.totp || []).filter(f => f.status === 'verified'); },
        async enroll() {
          await ready;
          // clear half-finished enrollments so a new QR code can be made
          const all = await q(sb.auth.mfa.listFactors());
          for (const f of (all.all || []).filter(f => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
          const d = await q(sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Lopezcuts ' + new Date().toISOString().slice(0, 10) }));
          return { factorId: d.id, qr: d.totp.qr_code, secret: d.totp.secret };
        },
        async verify(factorId, code) { await ready; return q(sb.auth.mfa.challengeAndVerify({ factorId, code })); },
      },
    };
  }

  // ==================================================================
  //  DEMO BACKEND (same tables + functions, in this browser)
  // ==================================================================
  function demoBackend() {
    const KEY = 'lopezcuts-demo-v12';
    const ROLE_KEY = 'lopezcuts-demo-role';
    let db = null;
    let memRole = 'owner';
    const store = {
      load() { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } },
      save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked: keep in memory */ } },
    };
    function role() { try { return sessionStorage.getItem(ROLE_KEY) || memRole; } catch { return memRole; } }
    let demoSignedIn = false;
    function signedIn() { try { return !!sessionStorage.getItem(ROLE_KEY) || demoSignedIn; } catch { return demoSignedIn; } }

    const STAFF = '00000000-0000-4000-8000-000000000001';
    const STAFF2 = '00000000-0000-4000-8000-000000000002';
    const SVC = { first: 'svc-first', cut: 'svc-haircut', home: 'svc-hometown', beard: 'svc-beard', design: 'svc-design', touch: 'svc-touchup' };

    function seed() {
      let s = 1402; const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const pick = a => a[Math.floor(rnd() * a.length)];
      const now = new Date(), today = T.today();
      const d = {
        settings: [{ id: 1, business_name: 'Lopezcuts', timezone: 'America/Denver', address: '(Sample address) 200 S Main St, Salt Lake City, UT', phone: '(571) 599-9297', instagram: 'lopezcuts.dmv', booking_open: true, slot_interval_min: 40, buffer_min: 0, min_notice_min: 720, booking_window_days: 90, max_active_bookings: 2, cancel_cutoff_hours: 6, avoid_gaps: true, booksy_rating: 5.0, booksy_review_count: 35 }],
        staff: [
          { id: STAFF, display_name: 'Miguel Lopez', title: 'Founder & Barber', bio: 'Cutting since 14. Fades, tapers, lineups and curly hair. Roots in the DMV, now in Salt Lake City.', avatar_url: null, color: '#c9a24a', active: true, accepts_online: true, sort: 0 },
          { id: STAFF2, display_name: 'Sample Employee', title: 'Barber (sample)', bio: 'A sample team member so you can preview the employee view.', avatar_url: null, color: '#6f8fb8', active: true, accepts_online: false, sort: 1 },
        ],
        profiles: [
          { id: 'demo-owner', email: 'owner@demo.lopezcuts', full_name: 'Miguel Lopez', role: 'owner', staff_id: STAFF, active: true },
          { id: 'demo-manager', email: 'manager@demo.lopezcuts', full_name: 'Sample Manager', role: 'manager', staff_id: null, active: true },
          { id: 'demo-employee', email: 'employee@demo.lopezcuts', full_name: 'Sample Employee', role: 'employee', staff_id: STAFF2, active: true },
        ],
        staff_invites: [{ email: 'newbarber@example.com', role: 'employee', staff_id: null, full_name: 'Example invite', created_at: now.toISOString(), accepted_at: null }],
        working_hours: [],
        time_off: [],
        services: [
          { id: SVC.first, name: 'First Time Haircut', description: 'Your first cut with Miguel. Fade, taper, lineup or scissor cut, up to 40 minutes.', is_addon: false, duration_min: 40, price: 25, new_client_price: null, first_visit_only: true, bookable: true, active: true, sort: 0 },
          { id: SVC.cut, name: 'Returning Client Haircut', description: 'Welcome back. Fade, taper, lineup or scissor cut, up to 40 minutes.', is_addon: false, duration_min: 40, price: 30, new_client_price: null, first_visit_only: false, bookable: true, active: true, sort: 1 },
          { id: SVC.beard, name: 'Beard', description: 'Shape-up and lineup on the beard.', is_addon: true, duration_min: 0, price: 5, new_client_price: null, bookable: true, active: true, sort: 10 },
          { id: SVC.design, name: 'Design', description: 'Part, line or custom design.', is_addon: true, duration_min: 0, price: 5, new_client_price: null, bookable: false, active: false, sort: 11 },
          { id: SVC.touch, name: 'Touch-up', description: 'Small fixes after your appointment. Always free. Text to set it up.', is_addon: false, duration_min: 15, price: 0, new_client_price: null, bookable: false, active: true, sort: 20 },
          { id: SVC.home, name: 'Hometown Haircut', description: 'For clients back home in the DMV (DC / Virginia). Book a day Miguel is in town.', is_addon: false, duration_min: 40, price: 25, new_client_price: null, first_visit_only: false, bookable: true, active: true, sort: 2 },
        ],
        clients: [], client_notes: [], appointments: [], payments: [], expenses: [],
        budgets: [{ category: 'Supplies', monthly_limit: 80 }, { category: 'Tools & equipment', monthly_limit: 60 }, { category: 'Marketing', monthly_limit: 25 }, { category: 'Software & fees', monthly_limit: 20 }],
        inventory: [
          { id: uuid(), name: 'Neck strips', unit: 'strips', qty: 140, per_cut: 1, per_addon: 0, reorder_at: 40 },
          { id: uuid(), name: 'Razor blades', unit: 'blades', qty: 9, per_cut: 0, per_addon: 1, reorder_at: 10 },
          { id: uuid(), name: 'Clipper oil', unit: 'bottles', qty: 2, per_cut: 0.02, per_addon: 0, reorder_at: 1 },
          { id: uuid(), name: 'Disinfectant spray', unit: 'cans', qty: 1.2, per_cut: 0.03, per_addon: 0, reorder_at: 1 },
          { id: uuid(), name: 'Styling product', unit: 'jars', qty: 3, per_cut: 0.05, per_addon: 0, reorder_at: 1 },
        ],
        reviews: [], portfolio_items: [], audit_log: [],
      };
      // Miguel's real weekly hours from Booksy (Nov 2026)
      const HOURS = [[0, '13:20', '17:20'], [1, '15:20', '17:20'], [2, '13:00', '15:40'], [3, '17:00', '19:40'], [5, '13:00', '15:40']];
      const slotTimes = wd => HOURS.filter(x => x[0] === wd).flatMap(([, a, b]) => { const out = []; const mm = x => +x.slice(0, 2) * 60 + +x.slice(3); for (let m = mm(a); m + 40 <= mm(b); m += 40) out.push(T.hm(m)); return out; });
      HOURS
        .forEach(([w, a, b]) => { d.working_hours.push({ id: uuid(), staff_id: STAFF, weekday: w, start_time: a + ':00', end_time: b + ':00' }); d.working_hours.push({ id: uuid(), staff_id: STAFF2, weekday: w, start_time: '10:00:00', end_time: '16:00:00' }); });
      // a day off next week so the calendar shows time off
      const off = T.addDays(today, 9);
      d.time_off.push({ id: uuid(), staff_id: STAFF, starts_at: T.zoned(off, '00:00').toISOString(), ends_at: T.zoned(T.addDays(off, 1), '00:00').toISOString(), reason: 'Midterm (sample)' });

      const reviews = [["Miguel is the man, hella cool dude and gives great cuts", "Ryan K.", "2026-11-09"], ["", "Wiley St. G.", "2026-10-27"], ["", "Morgan N.", "2026-09-28"], ["If you need a haircut this your guy", "Max S.", "2026-09-24"], ["Best hair cut i’ve received in a minute", "Jason B.", "2026-09-08"], ["Absolute class service", "Will K.", "2026-09-06"], ["Dudes nice with it", "Jonah L.", "2026-09-06"], ["Fire cut w barber", "Evan M.", "2026-04-13"], ["5⭐️", "Sam P.", "2026-03-22"], ["good cut", "Tate M.", "2026-03-16"], ["Fire cuts", "Justin D.", "2026-03-15"], ["great cut", "Kaiden", "2026-03-02"], ["Fire", "Stone H.", "2026-03-02"], ["The goat", "Devin V.", "2026-03-02"], ["Awesome cut at a great price", "Mark", "2026-03-02"], ["Great cuts", "Ethan M.", "2026-03-02"], ["Great barber. Definitely will be getting more cuts in the future. He always provides exactly what I ask for.", "Jeremy B.", "2026-03-02"], ["Goat", "Zach J.", "2026-02-22"], ["he does haircuts", "Morgan N.", "2026-02-05"], ["🐐", "Nick S.", "2026-01-14"], ["Good cut", "Jacob L.", "2026-01-11"], ["🔥🔥🔥🔥🔥🔥🔥", "Jake T.", "2026-01-09"], ["wonderful", "Wills F.", "2026-01-04"], ["Great cut", "Michael W.", "2025-12-23"], ["Bangin", "Cole D.", "2025-12-20"], ["Fire", "Gio B.", "2025-12-04"], ["Cuts fire", "Charlie M.", "2025-11-17"], ["Talented asf", "Owen J.", "2025-10-09"], ["Awesome barber. Def recommend. Dude knows what he’s doing", "Peyton I.", "2025-10-03"], ["perfect cut", "Aidan L.", "2025-10-03"], ["Fire", "Maclan G.", "2025-10-02"], ["Great haircut", "Jack", "2025-09-17"], ["Blessed me with a fire haircut and overall just a good dude to talk with", "Ethan", "2025-09-14"], ["fire", "Will P.", "2025-09-13"], ["Best service", "William B.", "2025-08-09"]];
      reviews.forEach(([b, n, dt]) => d.reviews.push({ id: uuid(), appointment_id: null, client_id: null, rating: 5, body: b, display_name: n, label: '', source: 'booksy', status: 'published', reply: '', created_at: new Date(dt + 'T19:00:00Z').toISOString() }));

      // Miguel's real photos, grouped into boxes by category (first photo in a box is the cover)
      [["Taper Fade", "/assets/img/portfolio/super-clean-taper-fade.jpg"], ["Taper Fade", "/assets/img/portfolio/batu-taper.jpg"], ["Taper Fade", "/assets/img/portfolio/chris-taper-and-beard-2.jpg"], ["Taper Fade", "/assets/img/portfolio/chris-taper-and-beard.jpg"], ["Taper Fade", "/assets/img/portfolio/clean-taper-fade.jpg"], ["Taper Fade", "/assets/img/portfolio/low-fade.jpg"], ["Taper Fade", "/assets/img/portfolio/rakan-taper-fade.jpg"], ["Taper Fade", "/assets/img/portfolio/takumi-taper-fade.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-3.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-4.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-axel.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-buzz-cut.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-danny.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-jeremey.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-miles.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-nolan.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-seby.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-takumi.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade-zach.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-fade1.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-ty.jpg"], ["Taper Fade", "/assets/img/portfolio/taper-will.jpg"], ["Taper Fade", "/assets/img/portfolio/wiley-taper.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-seby.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-aj.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-aj-better.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-cyrus.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-kyler.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-luke.jpg"], ["Burst Fade", "/assets/img/portfolio/burst-fade-pattock.jpg"], ["Burst Fade", "/assets/img/portfolio/miguel-burst-fade.jpg"], ["Burst Fade", "/assets/img/portfolio/seby-burst-fade.jpg"], ["Scissor Work", "/assets/img/portfolio/hink-scissor-work.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-james.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-2.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-4.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-boden.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-greyson.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-lucas-2.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-lucas-3.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-lucas.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-patrick.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work-will.jpg"], ["Scissor Work", "/assets/img/portfolio/scissor-work.jpg"], ["Modern Mullet", "/assets/img/portfolio/modern-mullet-noah.jpg"], ["Modern Mullet", "/assets/img/portfolio/modern-mullet-jek.jpg"], ["Modern Mullet", "/assets/img/portfolio/modern-mullet.jpg"], ["Modern Mullet", "/assets/img/portfolio/mullet-luca.jpg"], ["Modern Mullet", "/assets/img/portfolio/rakan-modern-mullet.jpg"], ["Modern Mullet", "/assets/img/portfolio/will-booth-modern-mullet.jpg"], ["Burst Mullet", "/assets/img/portfolio/burst-mullet-gio.jpg"], ["Burst Mullet", "/assets/img/portfolio/burst-mullet-bender.jpg"], ["Burst Mullet", "/assets/img/portfolio/burst-mullet-cyrus.jpg"], ["Burst Mullet", "/assets/img/portfolio/burst-mullet.jpg"], ["Mod Cut", "/assets/img/portfolio/mod-cut-gus.jpg"], ["Mod Cut", "/assets/img/portfolio/mod-cut.jpg"]]
        .forEach(([c, u], i) => d.portfolio_items.push({ id: uuid(), title: c, category: c, description: '', image_url: u, published: true, sort: 100 + i, created_at: now.toISOString() }));

      const first = ['Andre', 'Bryce', 'Carlos', 'Dante', 'Eli', 'Fabian', 'Gavin', 'Hector', 'Isaiah', 'Jalen', 'Kai', 'Luis', 'Marcus', 'Nico', 'Omar', 'Preston', 'Quinn', 'Rafael', 'Sam', 'Tyrese'];
      const last = ['Reyes', 'Coleman', 'Nguyen', 'Brooks', 'Ortiz', 'Hale', 'Kim', 'Price', 'Diaz', 'Foster', 'Young', 'Silva', 'Ward', 'Moreno', 'Hayes', 'Patel', 'Lane', 'Cruz', 'Bell', 'Grant'];
      first.forEach((f, i) => d.clients.push({ id: uuid(), full_name: `${f} ${last[i]} (sample)`, phone: '1801555' + String(1000 + i * 37).slice(-4), email: i % 3 ? null : `${f.toLowerCase()}@example.com`, birthday: i % 4 ? null : `2004-${String((i % 12) + 1).padStart(2, '0')}-1${i % 9}`, notes: i % 3 === 0 ? pick(['#1.5 on the sides, scissor on top', 'Low taper, keep the length up top', 'Sensitive skin, no alcohol on lineup', 'Likes a hard part on the left']) : '', tags: i % 5 === 0 ? ['VIP'] : (i % 7 === 0 ? ['Curly'] : []), marketing_opt_in: i % 2 === 0, blocked: false, source: i % 4 ? 'booksy' : 'online', heard_from: i % 3 ? pick(['instagram', 'instagram', 'instagram', 'friend', 'friend', 'snapchat', 'google', 'flyer']) : null, created_by: null, created_at: new Date(now - (60 + i * 5) * 864e5).toISOString() }));
      d.client_notes.push({ id: uuid(), client_id: d.clients[0].id, body: 'Wants to grow out the top for winter. Go lighter on the sides next time.', author_id: 'demo-owner', created_at: new Date(now - 12 * 864e5).toISOString() });
      d.client_notes.push({ id: uuid(), client_id: d.clients[3].id, body: 'Paid with Venmo, prefers early evening.', author_id: 'demo-owner', created_at: new Date(now - 30 * 864e5).toISOString() });

      const methods = ['cash', 'cash', 'venmo', 'venmo', 'zelle', 'cashapp', 'apple_pay'];
      const seen = new Set();
      const mk = (client, day, time, status, staff = STAFF) => {
        const start = T.zoned(day, time); const addons = rnd() < 0.25 ? [SVC.beard] : [];
        const isNew = !seen.has(client.id); const price = (isNew ? 25 : 30) + addons.length * 5;
        const a = { id: uuid(), client_id: client.id, staff_id: staff, service_id: isNew ? SVC.first : SVC.cut, addon_ids: addons, starts_at: start.toISOString(), ends_at: new Date(+start + 40 * 6e4).toISOString(), status, price, new_client: isNew, source: rnd() < 0.5 ? 'online' : 'booksy', client_message: '', internal_note: '', manage_token: uuid(), reminder_sent_at: null, confirmed_at: status === 'confirmed' ? now.toISOString() : null, completed_at: status === 'completed' ? new Date(+start + 40 * 6e4).toISOString() : null, cancelled_at: status === 'cancelled' ? start.toISOString() : null, cancelled_by: status === 'cancelled' ? 'client' : null, cancel_reason: '', created_by: null, created_at: new Date(+start - 3 * 864e5).toISOString() };
        if (status === 'completed') { seen.add(client.id); const tip = pick([0, 0, 5, 5, 10, 3, 0, 7]); d.payments.push({ id: uuid(), appointment_id: a.id, client_id: client.id, amount: price, tip, method: pick(methods), note: '', paid_at: a.completed_at, recorded_by: 'demo-owner' }); }
        d.appointments.push(a); return a;
      };
      for (let back = 56; back >= 1; back--) {
        const day = T.addDays(today, -back); const wd = T.weekday(day); const times = slotTimes(wd); if (!times.length) continue;
        const n = 1 + Math.floor(rnd() * times.length); const used = new Set();
        for (let k = 0; k < n; k++) {
          let t = pick(times); if (used.has(t)) continue; used.add(t);
          const r = rnd(); mk(pick(d.clients), day, t, r < 0.05 ? 'no_show' : (r < 0.1 ? 'cancelled' : 'completed'));
        }
        if (rnd() < 0.35) mk(pick(d.clients), day, '11:00', 'completed', STAFF2);
      }
      // upcoming
      for (let fwd = 0; fwd <= 6; fwd++) {
        const day = T.addDays(today, fwd); const wd = T.weekday(day);
        const slots = slotTimes(wd).filter(() => rnd() < 0.45);
        slots.forEach(t => { if (T.zoned(day, t) > now) mk(pick(d.clients), day, t, fwd <= 1 && rnd() < 0.5 ? 'confirmed' : 'booked'); });
      }
      // make sure today has something to show
      if (!d.appointments.some(a => T.day(a.starts_at) === today && new Date(a.starts_at) > now)) {
        const t = slotTimes(T.weekday(today)).find(x => T.zoned(today, x) > now);
        if (t) mk(d.clients[1], today, t, 'booked');
      }
      // expenses
      const exp = [['Clipper blades', 'Tools & equipment', 34], ['Neck strips (box)', 'Supplies', 12], ['Barbicide', 'Supplies', 15], ['Instagram promo', 'Marketing', 20], ['Booksy subscription', 'Software & fees', 29.99], ['Styling clay', 'Supplies', 18], ['Trimmer guards', 'Tools & equipment', 22], ['Cape', 'Tools & equipment', 25], ['Disinfectant', 'Supplies', 9]];
      for (let w = 0; w < 8; w++) for (let k = 0; k < 2; k++) { const [desc, cat, amt] = pick(exp); d.expenses.push({ id: uuid(), description: desc, category: cat, amount: amt, spent_on: T.addDays(today, -(w * 7 + Math.floor(rnd() * 7))), created_by: 'demo-owner', created_at: now.toISOString() }); }
      // one completed visit with a review waiting for approval
      const pend = d.appointments.find(a => a.status === 'completed');
      if (pend) d.reviews.unshift({ id: uuid(), appointment_id: pend.id, client_id: pend.client_id, rating: 5, body: 'Sample review: clean fade and he remembered exactly how I like it. Will be back.', display_name: 'Andre R.', label: 'Returning Client', source: 'site', status: 'pending', reply: '', created_at: new Date(now - 864e5).toISOString() });
      return d;
    }

    function init() {
      db = store.load();
      if (!db || !db.settings) { db = seed(); store.save(); }
    }
    init();
    window.addEventListener('storage', e => { if (e.key === KEY) { db = store.load() || db; emit('*'); } });

    const MONEY = ['payments', 'expenses', 'budgets'];
    const OWNER_ONLY = ['staff_invites', 'audit_log'];
    function me() { const r = role(); return db.profiles.find(p => p.role === r && p.id === 'demo-' + r) || db.profiles[0]; }
    function guard(table, op) {
      const r = role();
      if (r === 'employee' && MONEY.includes(table)) throw new ApiError('Your account doesn\'t have access to that.', 'forbidden');
      if (r !== 'owner' && OWNER_ONLY.includes(table)) throw new ApiError('Your account doesn\'t have access to that.', 'forbidden');
      if (r === 'employee' && op !== 'select' && ['settings', 'services', 'staff', 'inventory', 'reviews', 'portfolio_items', 'profiles'].includes(table)) throw new ApiError('Your account doesn\'t have access to that.', 'forbidden');
      if (table === 'profiles' && op !== 'select' && r !== 'owner') throw new ApiError('Only the owner can change team access.', 'forbidden');
    }
    function visible(table, rows) {
      const r = role(); const mine = me();
      if (table === 'profiles' && r !== 'owner') return rows.filter(p => p.id === mine.id);
      if (r !== 'employee') return rows;
      if (table === 'appointments') return rows.filter(a => a.staff_id === mine.staff_id);
      if (table === 'clients') { const ids = new Set(db.appointments.filter(a => a.staff_id === mine.staff_id).map(a => a.client_id)); return rows.filter(c => ids.has(c.id) || c.created_by === mine.id); }
      if (table === 'client_notes') { const ids = new Set(visible('clients', db.clients).map(c => c.id)); return rows.filter(n => ids.has(n.client_id)); }
      return rows;
    }
    const audit = (table, action, row) => { if (['payments', 'expenses', 'budgets', 'settings', 'profiles', 'staff_invites', 'services'].includes(table)) db.audit_log.unshift({ id: db.audit_log.length + 1, at: new Date().toISOString(), actor: me().id, table_name: table, action, row_id: String(row.id || row.email || row.category || ''), old_data: null, new_data: row }); db.audit_log = db.audit_log.slice(0, 300); };
    const keyOf = t => t === 'staff_invites' ? 'email' : (t === 'budgets' ? 'category' : 'id');
    let bulk = false;
    const commit = (t) => { if (bulk) return; store.save(); emit(t); };
    const clone = x => JSON.parse(JSON.stringify(x));
    // Demo copy of the database's text queue (supabase/schema.sql → queue_sms).
    function queueText(kind, a) {
      const st = db.settings[0]; if ((st.text_mode || 'manual') === 'off') return;
      const c = db.clients.find(x => x.id === a.client_id); if (!c || !c.phone) return;
      const tz = st.timezone || 'America/Denver'; const site = (st.site_url || 'https://www.lopezcuts.com').replace(/\/$/, '');
      const when = new Date(a.starts_at).toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/, (\d+:\d+)/, ' at $1');
      const first = c.full_name.trim().split(' ')[0]; const svc = db.services.find(x => x.id === a.service_id)?.name || 'haircut'; const link = site + '/#manage-' + a.manage_token;
      const body = {
        booked: `Hi ${first}! Your booking with ${st.business_name} went through: ${when} (${svc}).\nMiguel will text you the day of your appointment.\nNeed to change it? ${link}`,
        rescheduled: `Hi ${first}, Miguel moved your ${st.business_name} appointment to ${when}.\nIf that time doesn't work, change it here: ${link} or text ${st.phone}.`,
        cancelled: `Hi ${first}, sorry! Miguel had to cancel your ${st.business_name} appointment on ${when}.${a.cancel_reason ? '\nNote: ' + a.cancel_reason : ''}\nBook a new time here: ${site}`,
      }[kind];
      (db.sms_outbox = db.sms_outbox || []).push({ id: uuid(), appointment_id: a.id, client_id: c.id, kind, to_phone: '+' + c.phone, body, status: 'queued', created_at: new Date().toISOString(), sent_at: null, error: null });
    }
    const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
    const S = () => db.settings[0];

    function slots(staffId, day, dur, forStaff) {
      const s = S(); if (!forStaff && !s.booking_open) return [];
      const st = db.staff.find(x => x.id === staffId); if (!st || !st.active || (!forStaff && !st.accepts_online)) return [];
      const now = Date.now(); dur = Math.max(dur || 40, 5); const D = dur * 6e4; const buf = s.buffer_min * 6e4;
      const gapsOn = !forStaff && s.avoid_gaps !== false;
      const minGap = Math.max(5, Math.min(...db.services.filter(x => x.active && x.bookable && !x.is_addon && x.duration_min > 0).map(x => x.duration_min), 40)) * 6e4;
      const busy = db.appointments.filter(a => a.staff_id === staffId && (a.status === 'booked' || a.status === 'confirmed')).map(a => [+new Date(a.starts_at) - buf, +new Date(a.ends_at) + buf])
        .concat(db.time_off.filter(o => o.staff_id === staffId).map(o => [+new Date(o.starts_at), +new Date(o.ends_at)]));
      const out = new Set();
      db.working_hours.filter(h => h.staff_id === staffId && h.weekday === T.weekday(day)).forEach(h => {
        const ws = +T.zoned(day, h.start_time.slice(0, 5), s.timezone), we = +T.zoned(day, h.end_time.slice(0, 5), s.timezone);
        const cand = [];
        for (let t = ws; t + D <= we; t += s.slot_interval_min * 6e4) cand.push(t);
        if (gapsOn) busy.forEach(([bs, be]) => { if (be >= ws && be + D <= we) cand.push(be); if (bs - D >= ws && bs <= we) cand.push(bs - D); });
        cand.forEach(t => {
          if (forStaff) { if (t < now - 15 * 6e4) return; }
          else if (t < now + s.min_notice_min * 6e4 || t > now + s.booking_window_days * 864e5) return;
          if (busy.some(([bs, be]) => overlaps(bs, be, t, t + D))) return;
          if (gapsOn) {
            const before = t - Math.max(ws, ...busy.filter(b => b[1] <= t).map(b => b[1]));
            const after = Math.min(we, ...busy.filter(b => b[0] >= t + D).map(b => b[0])) - (t + D);
            if (!(before === 0 || after === 0 || (before >= minGap && after >= minGap))) return;
          }
          out.add(new Date(t).toISOString());
        });
      });
      return [...out].sort();
    }

    function bookingView(a) {
      const c = db.clients.find(x => x.id === a.client_id) || {}; const s = S();
      const reviewed = db.reviews.some(r => r.appointment_id === a.id);
      return { first_name: (c.full_name || '').split(' ')[0], starts_at: a.starts_at, ends_at: a.ends_at, status: a.status, price: a.price,
        service: (db.services.find(x => x.id === a.service_id) || {}).name, staff: (db.staff.find(x => x.id === a.staff_id) || {}).display_name,
        addons: db.services.filter(x => a.addon_ids.includes(x.id)).map(x => x.name),
        staff_id: a.staff_id, duration_min: Math.round((+new Date(a.ends_at) - +new Date(a.starts_at)) / 6e4),
        can_cancel: ['booked', 'confirmed'].includes(a.status) && new Date(a.starts_at) > Date.now() + s.cancel_cutoff_hours * 36e5,
        can_reschedule: ['booked', 'confirmed'].includes(a.status) && new Date(a.starts_at) > Date.now() + s.cancel_cutoff_hours * 36e5,
        can_confirm: a.status === 'booked' && new Date(a.starts_at) > Date.now(),
        can_review: a.status === 'completed' && !reviewed, reviewed };
    }
    const fail = m => { throw new ApiError(m); };
    const isStaff = () => signedIn();
    const isAdmin = () => isStaff() && role() !== 'employee';
    function consume(addons, sign) { const n = (addons || []).length; db.inventory.forEach(i => { const use = (+i.per_cut || 0) + (+i.per_addon || 0) * n; if (use) i.qty = Math.max(0, Math.round((+i.qty - sign * use) * 100) / 100); }); }
    function addonInfo(ids) { const ad = db.services.filter(x => x.is_addon && (ids || []).includes(x.id)); return { ids: ad.map(x => x.id), names: ad.map(x => x.name), price: ad.reduce((t, x) => t + +x.price, 0), dur: ad.reduce((t, x) => t + +x.duration_min, 0) }; }

    const RPC = {
      get_public_settings() { const s = S(); return { business_name: s.business_name, timezone: s.timezone, phone: s.phone, instagram: s.instagram, booking_open: s.booking_open, booking_window_days: s.booking_window_days, min_notice_min: s.min_notice_min, cancel_cutoff_hours: s.cancel_cutoff_hours, booksy_rating: s.booksy_rating, booksy_review_count: s.booksy_review_count }; },
      get_available_slots({ p_staff_id, p_day, p_duration }) { return slots(p_staff_id, p_day, p_duration, false); },
      get_available_slots_staff({ p_staff_id, p_day, p_duration }) { if (!isStaff()) return []; return slots(p_staff_id, p_day, p_duration, true); },
      get_open_days({ p_staff_id, p_from, p_days, p_duration }) { const out = []; for (let i = 0; i < Math.min(p_days || 14, 93); i++) { const day = T.addDays(p_from, i); out.push({ day, openings: slots(p_staff_id, day, p_duration, false).length }); } return out; },
      book_appointment({ p_name, p_phone, p_email, p_service_id, p_addon_ids, p_staff_id, p_starts_at, p_note }) {
        const s = S(); if (!s.booking_open) fail(`Online booking is paused right now. Please DM @lopezcuts.dmv on Instagram to book.`);
        const name = String(p_name || '').trim(); if (name.length < 2 || name.length > 80) fail('Please enter your full name.');
        const phone = normPhone(p_phone); if (!phone) fail('Please enter a valid phone number.');
        const email = String(p_email || '').trim().toLowerCase() || null; if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('That email address doesn\'t look right.');
        const svc = db.services.find(x => x.id === p_service_id && x.active && x.bookable && !x.is_addon); if (!svc) fail('Please choose a service.');
        const ad = addonInfo(p_addon_ids); const dur = svc.duration_min + ad.dur;
        const startIso = new Date(p_starts_at).toISOString();
        if (!slots(p_staff_id, T.day(startIso, s.timezone), dur, false).includes(startIso)) fail('Sorry, that time was just taken. Please pick another one.');
        let c = db.clients.find(x => x.phone === phone);
        if (!c) { c = { id: uuid(), full_name: name, phone, email, birthday: null, notes: '', tags: [], marketing_opt_in: false, blocked: false, source: 'online', created_by: null, created_at: new Date().toISOString() }; db.clients.push(c); }
        else { if (c.blocked) fail(`Online booking isn't available for this number. Please DM @lopezcuts.dmv on Instagram to book.`); if (email && !c.email) c.email = email; }
        const active = db.appointments.filter(a => a.client_id === c.id && ['booked', 'confirmed'].includes(a.status) && new Date(a.starts_at) > Date.now()).length;
        if (active >= s.max_active_bookings) fail(`You already have ${active} upcoming bookings. DM @lopezcuts.dmv on Instagram if you need another.`);
        const isNew = !(c.prior_visits > 0) && !db.appointments.some(a => a.client_id === c.id && a.status === 'completed');
        if (svc.first_visit_only && !isNew) fail('Welcome back! That option is for first visits. Please pick the returning client haircut.');
        const price = (isNew && svc.new_client_price != null ? +svc.new_client_price : +svc.price) + ad.price;
        const a = { id: uuid(), client_id: c.id, staff_id: p_staff_id, service_id: svc.id, addon_ids: ad.ids, starts_at: startIso, ends_at: new Date(+new Date(startIso) + dur * 6e4).toISOString(), status: 'booked', price, new_client: isNew, source: 'online', client_message: String(p_note || '').slice(0, 500), internal_note: '', manage_token: uuid(), reminder_sent_at: null, confirmed_at: null, completed_at: null, cancelled_at: null, cancelled_by: null, cancel_reason: '', created_by: null, created_at: new Date().toISOString() };
        db.appointments.push(a); queueText('booked', a); commit('appointments');
        return { token: a.manage_token, starts_at: a.starts_at, ends_at: a.ends_at, price, new_client: isNew, service: svc.name, addons: ad.names, staff: (db.staff.find(x => x.id === p_staff_id) || {}).display_name, status: 'booked' };
      },
      set_heard_from({ p_token, p_heard_from }) {
        const ok = ['instagram', 'friend', 'snapchat', 'tiktok', 'google', 'flyer', 'booksy', 'other'];
        const a = db.appointments.find(x => x.manage_token === p_token); const c = a && db.clients.find(x => x.id === a.client_id);
        if (!c || !ok.includes(p_heard_from) || c.heard_from) return { ok: false };
        c.heard_from = p_heard_from; c.heard_from_at = new Date().toISOString(); commit('clients'); return { ok: true };
      },
      find_appointment({ p_phone, p_first_name }) {
        const phone = normPhone(p_phone); if (!phone) fail('Please enter the mobile number you booked with.');
        const clean = v => String(v || '').trim().split(' ')[0].replace(/[^\p{L}]/gu, '').toLowerCase();
        const first = clean(p_first_name); if (!first) fail('Please enter your first name.');
        const c = db.clients.find(x => x.phone === phone && clean(x.full_name) === first);
        if (!c) return { found: false, appointments: [] };
        const list = db.appointments.filter(a => a.client_id === c.id && ['booked', 'confirmed'].includes(a.status) && new Date(a.ends_at) > Date.now())
          .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)).slice(0, 5)
          .map(a => ({ starts_at: a.starts_at, ends_at: a.ends_at, status: a.status, price: a.price, token: a.manage_token, service: (db.services.find(x => x.id === a.service_id) || {}).name, staff: (db.staff.find(x => x.id === a.staff_id) || {}).display_name, addons: addonInfo(a.addon_ids).names }));
        return { found: true, first_name: String(c.full_name).trim().split(' ')[0], appointments: list };
      },
      get_booking({ p_token }) { const a = db.appointments.find(x => x.manage_token === p_token); return a ? bookingView(a) : null; },
      confirm_booking({ p_token }) { const a = db.appointments.find(x => x.manage_token === p_token); if (a && a.status === 'booked' && new Date(a.starts_at) > Date.now()) { a.status = 'confirmed'; a.confirmed_at = new Date().toISOString(); commit('appointments'); } return a ? bookingView(a) : null; },
      cancel_booking({ p_token, p_reason }) {
        const a = db.appointments.find(x => x.manage_token === p_token); const s = S();
        if (!a) fail('We couldn\'t find that booking.'); if (!['booked', 'confirmed'].includes(a.status)) fail('This booking can\'t be cancelled anymore.');
        if (new Date(a.starts_at) <= Date.now() + s.cancel_cutoff_hours * 36e5) fail(`It's too close to your appointment to cancel online. Please reply to Miguel's text or DM @lopezcuts.dmv on Instagram.`);
        Object.assign(a, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'client', cancel_reason: String(p_reason || '').slice(0, 300) }); commit('appointments'); return bookingView(a);
      },
      reschedule_booking({ p_token, p_starts_at }) {
        const a = db.appointments.find(x => x.manage_token === p_token); const s = S();
        if (!a) fail('We couldn\'t find that booking.'); if (!['booked', 'confirmed'].includes(a.status)) fail('This booking can\'t be changed anymore.');
        if (new Date(a.starts_at) <= Date.now() + s.cancel_cutoff_hours * 36e5) fail('It\'s too close to your appointment to change it online. Please reply to Miguel\'s text or DM @lopezcuts.dmv on Instagram.');
        const startIso = new Date(p_starts_at).toISOString(); const dur = Math.round((+new Date(a.ends_at) - +new Date(a.starts_at)) / 6e4);
        if (startIso === new Date(a.starts_at).toISOString()) fail('Please pick a different time.');
        if (!slots(a.staff_id, T.day(startIso), dur, false).includes(startIso)) fail('Sorry, that time was just taken. Please pick another one.');
        a.starts_at = startIso; a.ends_at = new Date(+new Date(startIso) + dur * 6e4).toISOString(); a.reminder_sent_at = null; commit('appointments'); return bookingView(a);
      },
      submit_review({ p_token, p_rating, p_body, p_display_name }) {
        const a = db.appointments.find(x => x.manage_token === p_token);
        if (!a || a.status !== 'completed') fail('Reviews open after your appointment is finished.');
        if (db.reviews.some(r => r.appointment_id === a.id)) fail('You already reviewed this visit. Thank you!');
        if (!(p_rating >= 1 && p_rating <= 5)) fail('Please choose 1 to 5 stars.');
        db.reviews.unshift({ id: uuid(), appointment_id: a.id, client_id: a.client_id, rating: p_rating, body: String(p_body || '').trim().slice(0, 1000), display_name: String(p_display_name || 'Client').trim().slice(0, 40), label: a.new_client ? 'First Time Client' : 'Returning Client', source: 'site', status: 'pending', reply: '', created_at: new Date().toISOString() });
        commit('reviews'); return { ok: true };
      },
      login_lock_status() { return { locked_until: null }; },
      report_failed_login() { return { locked_until: null }; },
      submit_open_review({ p_rating, p_body, p_display_name, p_phone }) {
        const name = String(p_display_name || '').trim().slice(0, 40), body = String(p_body || '').trim();
        if (!(p_rating >= 1 && p_rating <= 5)) fail('Please choose 1 to 5 stars.');
        if (name.length < 2) fail('Please add your name.');
        if (body.length > 1000) fail('Please keep your review under 1,000 characters.');
        if (/(https?:\/\/|www\.)/i.test(body)) fail('Please leave links out of your review.');
        if (db.reviews.some(r => !r.appointment_id && r.source === 'site' && r.display_name.toLowerCase() === name.toLowerCase() && +new Date(r.created_at) > Date.now() - 864e5)) fail('Thanks! We already got a review from you today.');
        const digits = String(p_phone || '').replace(/\D/g, '').slice(-10);
        const c = digits.length === 10 ? db.clients.find(x => String(x.phone || '').replace(/\D/g, '').slice(-10) === digits && db.appointments.some(a => a.client_id === x.id && a.status === 'completed')) : null;
        db.reviews.unshift({ id: uuid(), appointment_id: null, client_id: c ? c.id : null, rating: p_rating, body, display_name: name, label: c ? 'Verified Client' : 'Client', source: 'site', status: 'pending', reply: '', created_at: new Date().toISOString() });
        commit('reviews'); return { ok: true };
      },
      staff_book({ p_client_id, p_name, p_phone, p_email, p_service_id, p_addon_ids, p_staff_id, p_starts_at, p_price, p_note, p_force, p_source }) {
        if (!isStaff()) fail('Not allowed.');
        if (!isAdmin() && p_staff_id !== me().staff_id) fail('You can only book on your own calendar.');
        const svc = db.services.find(x => x.id === p_service_id); if (!svc) fail('Please choose a service.');
        const ad = addonInfo(p_addon_ids); const dur = svc.duration_min + ad.dur; const src = p_source || 'manual';
        let cid = p_client_id; const phone = normPhone(p_phone);
        if (!cid) { const ex = phone && db.clients.find(x => x.phone === phone); if (ex) cid = ex.id; else { if (!String(p_name || '').trim()) fail('Please enter the client\'s name.'); const c = { id: uuid(), full_name: String(p_name).trim(), phone, email: (p_email || '').trim().toLowerCase() || null, birthday: null, notes: '', tags: [], marketing_opt_in: false, blocked: false, source: src, created_by: me().id, created_at: new Date().toISOString() }; db.clients.push(c); cid = c.id; } }
        const startIso = new Date(p_starts_at).toISOString(); const endIso = new Date(+new Date(startIso) + dur * 6e4).toISOString();
        if (!(p_force && isAdmin()) && src !== 'walk_in' && !slots(p_staff_id, T.day(startIso), dur, true).includes(startIso)) fail('That time is outside working hours or already taken.');
        if (db.appointments.some(a => a.staff_id === p_staff_id && ['booked', 'confirmed'].includes(a.status) && overlaps(+new Date(a.starts_at), +new Date(a.ends_at), +new Date(startIso), +new Date(endIso)))) fail('That overlaps another booking.');
        const isNew = !db.appointments.some(a => a.client_id === cid && a.status === 'completed');
        const a = { id: uuid(), client_id: cid, staff_id: p_staff_id, service_id: svc.id, addon_ids: ad.ids, starts_at: startIso, ends_at: endIso, status: 'booked', price: p_price != null && p_price !== '' ? +p_price : (isNew && svc.new_client_price != null ? +svc.new_client_price : +svc.price) + ad.price, new_client: isNew, source: src, client_message: '', internal_note: p_note || '', manage_token: uuid(), reminder_sent_at: null, confirmed_at: null, completed_at: null, cancelled_at: null, cancelled_by: null, cancel_reason: '', created_by: me().id, created_at: new Date().toISOString() };
        db.appointments.push(a); queueText('booked', a); commit('appointments'); return a.id;
      },
      complete_appointment({ p_id, p_amount, p_tip, p_method, p_note }) {
        const a = db.appointments.find(x => x.id === p_id); if (!a) fail('Appointment not found.');
        if (!(isAdmin() || (isStaff() && a.staff_id === me().staff_id))) fail('Not allowed.');
        if (a.status === 'completed') fail('This visit is already checked out.'); if (a.status === 'cancelled') fail('This visit was cancelled.');
        if (!(+p_amount >= 0) || +(p_tip || 0) < 0) fail('Amounts can\'t be negative.');
        a.status = 'completed'; a.completed_at = new Date().toISOString();
        const pay = { id: uuid(), appointment_id: a.id, client_id: a.client_id, amount: +p_amount, tip: +(p_tip || 0), method: p_method || 'cash', note: p_note || '', paid_at: new Date().toISOString(), recorded_by: me().id };
        db.payments.push(pay); audit('payments', 'insert', pay); consume(a.addon_ids, 1); commit('appointments'); return null;
      },
      reopen_appointment({ p_id }) {
        if (!isAdmin()) fail('Only an owner or manager can undo a checkout.');
        const a = db.appointments.find(x => x.id === p_id); if (!a || a.status !== 'completed') return null;
        db.payments = db.payments.filter(p => p.appointment_id !== p_id); a.status = 'confirmed'; a.completed_at = null; consume(a.addon_ids, -1); commit('appointments'); return null;
      },
    };

    return {
      mode: 'demo', ready: Promise.resolve(),
      async rpc(name, args) { await tick(); if (!RPC[name]) throw new ApiError('Unknown action ' + name); return clone(RPC[name](args || {})); },
      async fn() { await tick(); throw new ApiError('Phone notifications only work on the live site, not in this preview.'); },
      async list(table, o = {}) {
        await tick(); guard(table, 'select');
        let rows = visible(table, db[table] || []);
        if (['services', 'staff', 'portfolio_items', 'reviews'].includes(table) && !isStaff()) rows = rows.filter(r => table === 'reviews' ? r.status === 'published' : (table === 'portfolio_items' ? r.published : r.active));
        for (const [k, v] of Object.entries(o.eq || {})) rows = rows.filter(r => r[k] === v);
        for (const [k, v] of Object.entries(o.gte || {})) rows = rows.filter(r => r[k] >= v);
        for (const [k, v] of Object.entries(o.lte || {})) rows = rows.filter(r => r[k] <= v);
        if (o.order) rows = rows.slice().sort((a, b) => (a[o.order] > b[o.order] ? 1 : a[o.order] < b[o.order] ? -1 : 0) * (o.asc === false ? -1 : 1));
        if (o.limit) rows = rows.slice(0, o.limit);
        return clone(rows);
      },
      async insert(table, row) {
        if (!bulk) await tick(); guard(table, 'insert');
        const k = keyOf(table); const r = { ...row }; if (k === 'id' && !r.id) r.id = uuid();
        if ('created_at' in r || ['clients', 'expenses', 'client_notes', 'time_off', 'portfolio_items', 'staff_invites', 'reviews'].includes(table)) r.created_at = r.created_at || new Date().toISOString();
        if (table === 'clients') { if (r.phone && db.clients.some(c => c.phone === r.phone)) throw new ApiError('A client with that phone number already exists.'); r.created_by = me().id; r.tags = r.tags || []; r.notes = r.notes || ''; }
        if (table === 'client_notes') r.author_id = me().id;
        if (table === 'expenses') r.created_by = me().id;
        (db[table] = db[table] || []).push(r); audit(table, 'insert', r); commit(table); return clone(r);
      },
      async insertMany(table, rows) { bulk = true; const out = []; try { for (const r of rows) out.push(await this.insert(table, r)); } finally { bulk = false; } commit(table); return out; },
      async update(table, id, patch, key) {
        await tick(); guard(table, 'update'); key = key || keyOf(table);
        const r = (db[table] || []).find(x => x[key] === id); if (!r) throw new ApiError('That item no longer exists.');
        if (table === 'appointments' && role() === 'employee' && r.staff_id !== me().staff_id) throw new ApiError('Your account doesn\'t have access to that.');
        if (table === 'profiles' && r.id === me().id && ('role' in patch || 'active' in patch)) throw new ApiError('You can\'t change your own role or access.');
        if (table === 'appointments' && (patch.starts_at || patch.status)) {
          const next = { ...r, ...patch };
          if (['booked', 'confirmed'].includes(next.status) && db.appointments.some(a => a.id !== r.id && a.staff_id === next.staff_id && ['booked', 'confirmed'].includes(a.status) && overlaps(+new Date(a.starts_at), +new Date(a.ends_at), +new Date(next.starts_at), +new Date(next.ends_at)))) throw new ApiError('That overlaps another booking.');
        }
        const before = { ...r };
        Object.assign(r, patch); audit(table, 'update', r);
        if (table === 'appointments' && +new Date(r.starts_at) > Date.now()) {
          const live = x => ['booked', 'confirmed'].includes(x);
          if (r.status === 'cancelled' && live(before.status) && (r.cancelled_by || 'shop') === 'shop') queueText('cancelled', r);
          else if (live(r.status) && live(before.status) && r.starts_at !== before.starts_at) queueText('rescheduled', r);
        }
        commit(table); return clone(r);
      },
      async upsert(table, row) { const k = keyOf(table); const ex = (db[table] || []).find(x => x[k] === row[k]); return ex ? this.update(table, row[k], row, k) : this.insert(table, row); },
      async remove(table, id, key) {
        await tick(); guard(table, 'delete'); key = key || keyOf(table);
        const r = (db[table] || []).find(x => x[key] === id); db[table] = (db[table] || []).filter(x => x[key] !== id);
        if (r) audit(table, 'delete', r); commit(table);
      },
      async upload(file) { return resizeImage(file, 900, 'dataurl'); },
      realtime() { /* other tabs update through the storage event */ },
      reset() { db = seed(); store.save(); emit('*'); },
      auth: {
        async session() { return signedIn() ? { demo: true } : null; },
        onChange() {},
        async signInPassword() { throw new ApiError('Demo mode has no passwords. Pick a role below to preview.'); },
        async sendLink() { throw new ApiError('Demo mode can\'t send email. Pick a role below to preview.'); },
        async demoSignIn(r) { memRole = r; demoSignedIn = true; try { sessionStorage.setItem(ROLE_KEY, r); } catch { } },
        async signOut() { demoSignedIn = false; try { sessionStorage.removeItem(ROLE_KEY); } catch { } },
        async setPassword() { return true; },
        async profile() { return clone(me()); },
        async aal() { return { currentLevel: 'aal2', nextLevel: 'aal2' }; },
        async factors() { return [{ id: 'demo' }]; },
        async enroll() { return null; },
        async verify() { return true; },
      },
    };
  }

  const tick = () => new Promise(r => setTimeout(r, 60));

  // Resize photos before upload so the site stays fast.
  function resizeImage(file, max, as) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new ApiError('Please choose a JPG, PNG or WebP photo.'));
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        if (as === 'blob') c.toBlob(b => b ? resolve(b) : reject(new ApiError('Couldn\'t read that photo.')), 'image/jpeg', 0.85);
        else resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new ApiError('Couldn\'t read that photo.'));
      img.src = url;
    });
  }

  const backend = LIVE ? liveBackend() : demoBackend();
  window.LC = Object.assign(backend, { T, money, normPhone, fmtPhone, uuid, ApiError, config: CFG, onData(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
})();
