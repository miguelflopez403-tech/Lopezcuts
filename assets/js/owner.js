/* Lopezcuts owner dashboard.
 * Security note: this page only decides what to SHOW. What each account can
 * actually read or change is enforced by the database (row-level security +
 * 2-step verification checks in supabase/schema.sql). Hiding a tab here is
 * a convenience, not the lock.
 */
(function () {
  'use strict';
  const { T, money, fmtPhone, normPhone } = LC;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'style') e.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(9).forEach(k => { if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); });
    return e;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  const icon = id => { const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(svgNS, 'use'); u.setAttribute('href', '#i-' + id); s.append(u); return s; };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Couldn\'t copy. Select the text and copy it.'); } }
  const field = (label, input, hint) => h('label', { class: 'f' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
  const initials = n => (n || '?').replace(/\(sample\)/i, '').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  const firstName = n => (n || '').replace(/\(sample\)/i, '').trim().split(' ')[0];
  const by = (k, dir = 1) => (a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir;
  const sum = (arr, f) => arr.reduce((t, x) => t + (+f(x) || 0), 0);
  async function run(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message || 'Something went wrong'); throw e; } }
  function armBtn(label, onConfirm, cls = 'btn sm danger', armedLabel = 'Tap again to confirm') {
    const b = h('button', { class: cls, type: 'button' }, label);
    b.addEventListener('click', async () => {
      if (b.classList.contains('armed')) { b.disabled = true; try { await onConfirm(); } finally { b.disabled = false; } return; }
      b.classList.add('armed'); b.textContent = armedLabel;
      setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = label; } }, 3500);
    });
    return b;
  }
  function csv(name, rows) {
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = rows.map(r => r.map(esc).join(',')).join('\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); a.remove();
    toast('Downloading ' + name);
  }

  // ===================================================================
  //  STATE
  // ===================================================================
  let ME = null; let D = null; let entered = false; let gating = false;
  const isOwner = () => ME?.role === 'owner';
  const isAdmin = () => ME?.role === 'owner' || ME?.role === 'manager';
  const S = () => (D.settings && D.settings[0]) || {};
  const UI = { view: 'today', calAnchor: T.today(), calStaff: 'all', clientQ: '', clientFilter: 'all', clientSort: 'last', schedPast: false, moneyRange: 'month', setupTab: null, revFilter: 'pending' };

  // ===================================================================
  //  AUTH SCREENS
  // ===================================================================
  const auth = $('#auth'), authBody = $('#authBody');
  function showAuth(...nodes) { $('#app').hidden = true; auth.hidden = false; authBody.replaceChildren(...nodes.flat()); }

  function showDemoLogin() {
    const pick = (role, title, desc) => h('button', { type: 'button', onclick: async () => { await LC.auth.demoSignIn(role); gate(); } }, h('span', { class: 'avatar' }, title[0]), h('span', {}, h('b', {}, title), h('span', {}, desc)));
    showAuth(h('div', { class: 'stack' },
      h('h2', {}, 'Preview the dashboard'),
      h('p', { class: 'muted' }, 'Demo mode uses sample data saved in this browser only. Pick a role to see exactly what that person can see.'),
      h('div', { class: 'role-pick' },
        pick('owner', 'Owner', 'Everything, including money, team and activity log'),
        pick('manager', 'Manager', 'Everything except team access and the activity log'),
        pick('employee', 'Employee', 'Own calendar and clients only. No money.')),
      h('p', { class: 'hint' }, 'When it\'s live, this screen asks for an invited email, a password and a 6-digit code from an authenticator app.')));
  }

  function showLogin(msg, mode = 'password') {
    const email = h('input', { id: 'lgEmail', type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.com' });
    const pw = h('input', { id: 'lgPass', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    const out = h('div', { 'aria-live': 'polite' }, msg ? h('div', { class: 'err' }, msg) : null);
    const btn = h('button', { class: 'btn gold block', type: 'submit' }, mode === 'password' ? 'Sign in' : 'Email me a sign-in link');
    const form = h('form', { class: 'stack', onsubmit: async e => {
      e.preventDefault(); btn.disabled = true; out.replaceChildren();
      try {
        if (mode === 'password') { await LC.auth.signInPassword(email.value.trim(), pw.value); await gate(); }
        else { await LC.auth.sendLink(email.value.trim()); out.replaceChildren(h('div', { class: 'okmsg' }, 'Check your email for a sign-in link. It works once and expires in an hour.')); }
      } catch (err) { out.replaceChildren(h('div', { class: 'err' }, /Invalid login/i.test(err.message) ? 'Wrong email or password. First time? Use "Email me a sign-in link" and set a password after.' : err.message)); }
      finally { btn.disabled = false; }
    } },
      h('div', {}, h('h2', {}, 'Staff sign in'), h('p', { class: 'muted' }, 'Only people the owner has invited can sign in.')),
      out, field('Email', email), mode === 'password' ? field('Password', pw) : null, btn,
      h('div', { class: 'divider' }, 'or'),
      h('button', { class: 'btn block', type: 'button', onclick: () => showLogin(null, mode === 'password' ? 'link' : 'password') }, mode === 'password' ? 'Email me a sign-in link instead' : 'Use my password instead'));
    showAuth(form); setTimeout(() => email.focus(), 50);
  }

  function showNoAccess(p) {
    showAuth(h('div', { class: 'stack' }, h('h2', {}, 'No access yet'),
      h('p', { class: 'muted' }, `${p?.email || 'This account'} is signed in but hasn't been given a role, or access was switched off. Ask the owner to check Settings → Team.`),
      h('button', { class: 'btn block', type: 'button', onclick: async () => { await LC.auth.signOut(); location.reload(); } }, 'Sign out')));
  }

  function codeForm(onCode, label = 'Verify') {
    const code = h('input', { id: 'mfaCode', class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}', placeholder: '000000', required: true });
    const out = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn gold block', type: 'submit' }, label);
    const f = h('form', { class: 'stack', onsubmit: async e => { e.preventDefault(); btn.disabled = true; out.replaceChildren(); try { await onCode(code.value.trim()); } catch (err) { out.replaceChildren(h('div', { class: 'err' }, /invalid|expired/i.test(err.message) ? 'That code didn\'t work. Codes change every 30 seconds, so try the newest one.' : err.message)); code.select(); } finally { btn.disabled = false; } } },
      field('6-digit code from your authenticator app', code), out, btn);
    setTimeout(() => code.focus(), 50); return f;
  }
  function showMfaChallenge(factorId) {
    showAuth(h('div', { class: 'stack' },
      h('h2', {}, '2-step verification'), h('p', { class: 'muted' }, 'Open your authenticator app (Google Authenticator, 1Password, Authy…) and enter the code for Lopezcuts.'),
      codeForm(async c => { await LC.auth.verify(factorId, c); enter(); }),
      h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { await LC.auth.signOut(); location.reload(); } }, 'Sign out')));
  }
  async function showMfaEnroll() {
    showAuth(h('div', { class: 'stack' },
      h('h2', {}, 'Protect your account'),
      h('p', { class: 'muted' }, 'Owners and managers can see the business\'s money, so 2-step verification is required. You\'ll need a free authenticator app like Google Authenticator, Microsoft Authenticator, 1Password or Authy.'),
      h('button', { class: 'btn gold block', type: 'button', onclick: async e => {
        e.target.disabled = true;
        try {
          const en = await LC.auth.enroll();
          showAuth(h('div', { class: 'stack' },
            h('h2', {}, 'Scan this code'),
            h('p', { class: 'muted' }, 'In your authenticator app, tap + and scan. Then type the 6-digit code it shows.'),
            h('div', { class: 'qr' }, h('img', { src: en.qr, alt: 'QR code for your authenticator app' })),
            h('details', {}, h('summary', { class: 'small muted' }, 'Can\'t scan? Enter this key instead'), h('p', { class: 'secret' }, en.secret)),
            codeForm(async c => { await LC.auth.verify(en.factorId, c); toast('2-step verification is on'); enter(); }, 'Turn on 2-step verification')));
        } catch (err) { toast(err.message); e.target.disabled = false; }
      } }, icon('shield'), 'Set up 2-step verification'),
      h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { await LC.auth.signOut(); location.reload(); } }, 'Sign out')));
  }

  async function gate() {
    if (gating) return; gating = true;
    try {
      const prof = await LC.auth.profile();
      if (!prof) return showLogin();
      if (!prof.role || prof.active === false) return showNoAccess(prof);
      ME = prof;
      if (prof.role !== 'employee') {
        const aal = await LC.auth.aal();
        if (aal.currentLevel !== 'aal2') { const f = await LC.auth.factors(); return f.length ? showMfaChallenge(f[0].id) : showMfaEnroll(); }
      }
      await enter();
    } catch (e) { showLogin(e.message); }
    finally { gating = false; }
  }

  // Auto-lock after 30 minutes without activity (live mode).
  let lastActive = Date.now();
  ['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
  setInterval(async () => {
    if (LC.mode !== 'live' || !entered) return;
    if (Date.now() - lastActive > 30 * 60 * 1000) { entered = false; await LC.auth.signOut(); showLogin('You were signed out after 30 minutes of inactivity.'); }
  }, 60 * 1000);

  // ===================================================================
  //  DATA
  // ===================================================================
  const since = () => new Date(Date.now() - 400 * 864e5).toISOString();
  const LOADERS = {
    settings: () => LC.list('settings'),
    staff: () => LC.list('staff', { order: 'sort' }),
    services: () => LC.list('services', { order: 'sort' }),
    working_hours: () => LC.list('working_hours'),
    time_off: () => LC.list('time_off', { order: 'starts_at' }),
    clients: () => LC.list('clients', { order: 'full_name' }),
    client_stats: () => LC.list('client_stats').catch(() => []),
    client_notes: () => LC.list('client_notes', { order: 'created_at', asc: false }),
    appointments: () => LC.list('appointments', { gte: { starts_at: since() }, order: 'starts_at' }),
    inventory: () => LC.list('inventory', { order: 'name' }),
    reviews: () => LC.list('reviews', { order: 'created_at', asc: false }),
    portfolio_items: () => LC.list('portfolio_items', { order: 'sort' }),
    payments: () => isAdmin() ? LC.list('payments', { gte: { paid_at: since() }, order: 'paid_at', asc: false }) : [],
    expenses: () => isAdmin() ? LC.list('expenses', { gte: { spent_on: since().slice(0, 10) }, order: 'spent_on', asc: false }) : [],
    budgets: () => isAdmin() ? LC.list('budgets', { order: 'category' }) : [],
    sms_outbox: () => isAdmin() ? LC.list('sms_outbox', { order: 'created_at', asc: false, limit: 60 }).catch(() => []) : [],
    profiles: () => LC.list('profiles', { order: 'email' }),
    staff_invites: () => isOwner() ? LC.list('staff_invites', { order: 'created_at', asc: false }) : [],
    audit_log: () => isOwner() ? LC.list('audit_log', { order: 'at', asc: false, limit: 150 }) : [],
  };
  async function load(tables = Object.keys(LOADERS)) {
    D = D || {};
    if (!tables.includes('client_stats') && tables.some(t => ['clients', 'appointments', 'payments'].includes(t))) tables = [...tables, 'client_stats'];
    if (!tables.includes('sms_outbox') && tables.includes('appointments')) tables = [...tables, 'sms_outbox'];
    const res = await Promise.all(tables.map(t => Promise.resolve().then(LOADERS[t]).catch(e => { console.warn(t, e); return D[t] || []; })));
    tables.forEach((t, i) => { D[t] = res[i]; });
    if (S().timezone) T.tz = S().timezone;
    index();
  }
  function index() {
    D.client = new Map(D.clients.map(c => [c.id, c]));
    D.svc = new Map(D.services.map(s => [s.id, s]));
    D.stf = new Map(D.staff.map(s => [s.id, s]));
    D.payByAppt = new Map(D.payments.map(p => [p.appointment_id, p]));
    D.prof = new Map(D.profiles.map(p => [p.id, p]));
    const now = Date.now(); const st = new Map();
    D.clients.forEach(c => st.set(c.id, { appts: [], visits: 0, noShows: 0, cancels: 0, last: null, next: null, spend: 0, tips: 0, avgGap: null, dueBack: null }));
    D.appointments.forEach(a => { const s = st.get(a.client_id); if (!s) return; s.appts.push(a); });
    st.forEach(s => {
      s.appts.sort(by('starts_at', -1));
      const done = s.appts.filter(a => a.status === 'completed');
      s.visits = done.length; s.noShows = s.appts.filter(a => a.status === 'no_show').length; s.cancels = s.appts.filter(a => a.status === 'cancelled').length;
      s.last = done[0]?.starts_at || null;
      s.next = s.appts.filter(a => ['booked', 'confirmed'].includes(a.status) && new Date(a.starts_at) > now).sort(by('starts_at')).at(0)?.starts_at || null;
      done.forEach(a => { const p = D.payByAppt.get(a.id); if (p) { s.spend += +p.amount + +p.tip; s.tips += +p.tip; } });
      if (done.length >= 2) { const ts = done.map(a => +new Date(a.starts_at)).sort((x, y) => x - y); s.avgGap = (ts.at(-1) - ts[0]) / (ts.length - 1) / 864e5; s.dueBack = new Date(ts.at(-1) + s.avgGap * 864e5).toISOString(); }
    });
    // Whole-history totals from the database (the list above only holds the last ~13 months).
    const life = new Map((D.client_stats || []).map(r => [r.client_id, r]));
    st.forEach((s, id) => {
      const c = D.client.get(id), L = life.get(id);
      if (L) { s.visits = L.visits; s.last = L.last_visit; s.noShows = L.no_shows; s.cancels = L.cancels; if (isAdmin()) { s.spend = +L.spend; s.tips = +L.tips; } }
      else { s.visits += c.prior_visits || 0; if (c.prior_last_visit && (!s.last || c.prior_last_visit > s.last.slice(0, 10))) s.last = c.prior_last_visit + 'T18:00:00Z'; }
    });
    D.stats = st;
  }
  async function refresh(tables) { await load(tables); renderNav(); render(); }

  const client = id => D.client.get(id) || { full_name: 'Unknown client', phone: '' };
  const svcName = a => [D.svc.get(a.service_id)?.name || 'Service', ...(a.addon_ids || []).map(id => D.svc.get(id)?.name).filter(Boolean)].join(' + ');
  const staffName = id => D.stf.get(id)?.display_name || '';
  const mins = a => Math.round((new Date(a.ends_at) - new Date(a.starts_at)) / 6e4);
  const statusLabel = { booked: 'Booked', confirmed: 'Confirmed', completed: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };
  const pill = st => h('span', { class: 'pill ' + st }, statusLabel[st] || st);
  // Links in texts use whatever address the dashboard is opened on, so they work on
  // lopezcuts.vercel.app now and switch to lopezcuts.com automatically once it is connected.
  const siteBase = () => new URL('../', location.href).href;
  const manageUrl = tok => siteBase() + '#manage-' + tok;
  const smsHref = (phone, body) => { const d = String(phone || '').replace(/\D/g, ''); return d ? `sms:+${d.length === 10 ? '1' + d : d}${body ? '?&body=' + encodeURIComponent(body) : ''}` : null; };
  const monthKey = d => T.day(d).slice(0, 7);
  const weekStart = day => { const wd = T.weekday(day); return T.addDays(day, wd === 0 ? -6 : 1 - wd); };

  function reminderText(a) {
    const c = client(a.client_id); const day = T.day(a.starts_at);
    const when = day === T.today() ? 'today' : day === T.addDays(T.today(), 1) ? 'tomorrow' : 'on ' + T.date(a.starts_at, { weekday: 'long', month: 'short', day: 'numeric' });
    const hello = T.minutes(new Date()) < 720 ? 'Good morning' : 'Hey';
    const addr = S().address;
    return `${hello} ${firstName(c.full_name)}! Confirming your Lopezcuts appointment ${when} at ${T.time(a.starts_at)} (${svcName(a)}, ${money(a.price)}).`
      + (addr ? `\nAddress: ${addr}\nMap: https://maps.google.com/?q=${encodeURIComponent(addr)}` : '')
      + `\nTap to confirm or cancel: ${manageUrl(a.manage_token)}\nSee you soon! - Miguel`;
  }

  // ===================================================================
  //  SHELL
  // ===================================================================
  const VIEWS = [
    { id: 'today', label: 'Today', icon: 'today', render: viewToday },
    { id: 'schedule', label: 'Schedule', icon: 'clock', render: viewSchedule },
    { id: 'calendar', label: 'Calendar', icon: 'cal', render: viewCalendar },
    { id: 'clients', label: 'Clients', icon: 'users', render: viewClients },
    { id: 'money', label: 'Money', icon: 'money', render: viewMoney, admin: true },
    { id: 'reviews', label: 'Reviews', icon: 'star', render: viewReviews },
    { id: 'portfolio', label: 'Portfolio', icon: 'image', render: viewPortfolio, admin: true },
    { id: 'supplies', label: 'Supplies', icon: 'box', render: viewSupplies },
    { id: 'setup', label: 'Settings', icon: 'gear', render: viewSettings },
  ];
  const allowed = () => VIEWS.filter(v => !v.admin || isAdmin());

  async function enter() {
    entered = true; auth.hidden = true; $('#app').hidden = false;
    $('#view').replaceChildren(h('div', { class: 'kpis' }, [1, 2, 3, 4].map(() => h('div', { class: 'skel', style: 'height:96px' }))), h('div', { class: 'skel', style: 'height:300px' }));
    await load();
    const want = location.hash.slice(1);
    UI.view = allowed().some(v => v.id === want) ? want : 'today';
    renderNav(); render(); renderBanner();
    LC.realtime(p => {
      if (p.eventType === 'INSERT' && p.new?.source === 'online') toast(`New online booking: ${T.date(p.new.starts_at)} at ${T.time(p.new.starts_at)}`);
      refresh(['appointments', 'clients']);
    });
  }
  function renderBanner() {
    const b = $('#banner');
    if (LC.mode !== 'demo') { b.hidden = true; return; }
    b.hidden = false;
    b.replaceChildren(icon('alert'), h('span', {}, h('b', {}, 'Demo mode. '), `Sample data, saved only in this browser. You're viewing as ${ME.role}.`),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { await LC.auth.signOut(); entered = false; showDemoLogin(); } }, 'Switch role'),
      armBtn('Reset sample data', async () => { LC.reset(); await refresh(); toast('Sample data reset'); }, 'btn sm'));
  }
  function renderNav() {
    const pending = D.reviews.filter(r => r.status === 'pending').length;
    const mk = (v, cls) => h('button', { type: 'button', 'aria-current': UI.view === v.id ? 'page' : null, onclick: () => go(v.id) }, icon(v.icon), h('span', {}, v.label), v.id === 'reviews' && pending && cls === 'side' ? h('span', { class: 'count' }, pending) : null);
    $('#sideNav').replaceChildren(...allowed().map(v => mk(v, 'side')));
    $('#tabbar').replaceChildren(...allowed().map(v => mk(v, 'tab')));
    $('#sideMe').replaceChildren(
      h('div', { class: 'me-row' }, h('span', { class: 'avatar' }, initials(ME.full_name || ME.email)), h('div', { style: 'min-width:0' }, h('div', { class: 'nm' }, ME.full_name || ME.email), h('div', { class: 'rl' }, ME.role))),
      h('button', { class: 'btn sm block', type: 'button', onclick: signOut }, icon('out'), 'Sign out'));
    $('#topDate').textContent = T.date(new Date(), { weekday: 'long', month: 'long', day: 'numeric' });
  }
  async function signOut() { entered = false; await LC.auth.signOut(); if (LC.mode === 'demo') showDemoLogin(); else location.reload(); }
  function go(id) { UI.view = id; try { history.replaceState(null, '', '#' + id); } catch { } renderNav(); render(); $('#view').focus({ preventScroll: true }); scrollTo(0, 0); }
  addEventListener('hashchange', () => { const id = location.hash.slice(1); if (entered && allowed().some(v => v.id === id) && id !== UI.view) go(id); });
  function render() {
    const v = allowed().find(x => x.id === UI.view) || VIEWS[0];
    $('#viewTitle').textContent = v.label;
    try { $('#view').replaceChildren(...[v.render()].flat().filter(Boolean)); }
    catch (e) { console.error(e); $('#view').replaceChildren(h('div', { class: 'err' }, 'This page hit an error: ' + e.message)); }
  }
  $('#newBooking').addEventListener('click', () => openNewBooking());
  const gs = $('#globalSearch');
  gs.addEventListener('keydown', e => { if (e.key === 'Enter') { UI.clientQ = gs.value; go('clients'); } });
  gs.addEventListener('input', () => { if (UI.view === 'clients') { UI.clientQ = gs.value; render(); gs.focus(); } });

  // modal + drawer
  const modalEl = $('#modal'), drawerEl = $('#drawer');
  function modal(title, body, opts = {}) { $('#modalTitle').textContent = title; $('#modalBody').replaceChildren(...[body].flat().filter(Boolean)); modalEl.classList.toggle('wide', !!opts.wide); if (!modalEl.open) modalEl.showModal(); return () => modalEl.close(); }
  function drawer(title, body) { $('#drawerTitle').textContent = title; $('#drawerBody').replaceChildren(...[body].flat().filter(Boolean)); if (!drawerEl.open) drawerEl.showModal(); $('#drawerBody').scrollTop = 0; }
  $('#modalClose').addEventListener('click', () => modalEl.close());
  $('#drawerClose').addEventListener('click', () => drawerEl.close());
  [modalEl, drawerEl].forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ===================================================================
  //  TODAY
  // ===================================================================
  function kpi(label, val, sub, cls = '', spark) { return h('div', { class: 'kpi ' + cls }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, val), h('div', { class: 'sub' }, sub), spark || null); }
  function sparkline(vals) {
    const w = 74, hh = 28, max = Math.max(1, ...vals); const pts = vals.map((v, i) => [i * (w / (vals.length - 1 || 1)), hh - 3 - (v / max) * (hh - 6)]);
    const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('class', 'spark'); s.setAttribute('viewBox', `0 0 ${w} ${hh}`); s.setAttribute('aria-hidden', 'true');
    const area = document.createElementNS(svgNS, 'path'); area.setAttribute('d', `M0 ${hh} L${pts.map(p => p.join(' ')).join(' L')} L${w} ${hh} Z`); area.setAttribute('fill', 'rgb(201 162 74 / 18%)');
    const line = document.createElementNS(svgNS, 'polyline'); line.setAttribute('points', pts.map(p => p.join(',')).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#c9a24a'); line.setAttribute('stroke-width', '1.8');
    const dot = document.createElementNS(svgNS, 'circle'); const last = pts.at(-1); dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', '2.6'); dot.setAttribute('fill', '#c9a24a');
    s.append(area, line, dot); return s;
  }
  function revenueOn(day) { return sum(D.payments.filter(p => T.day(p.paid_at) === day), p => +p.amount + +p.tip); }

  function viewToday() {
    const today = T.today(), now = Date.now();
    const todays = D.appointments.filter(a => T.day(a.starts_at) === today && a.status !== 'cancelled').sort(by('starts_at'));
    const live = todays.filter(a => a.status !== 'no_show');
    const ninety = D.appointments.filter(a => new Date(a.starts_at) > now - 90 * 864e5 && new Date(a.starts_at) < now && ['completed', 'no_show'].includes(a.status));
    const ns = ninety.filter(a => a.status === 'no_show').length; const nsRate = ninety.length ? Math.round(100 * ns / ninety.length) : 0;
    let kpis;
    if (isAdmin()) {
      const ws = weekStart(today); const week = D.payments.filter(p => T.day(p.paid_at) >= ws);
      const mk = monthKey(new Date()); const inc = sum(D.payments.filter(p => monthKey(p.paid_at) === mk), p => +p.amount + +p.tip);
      const exp = sum(D.expenses.filter(x => x.spent_on.slice(0, 7) === mk), x => x.amount);
      const days7 = Array.from({ length: 7 }, (_, i) => revenueOn(T.addDays(today, i - 6)));
      kpis = [
        kpi('Today', money(sum(live, a => a.price)), `${live.length} booked · ${live.filter(a => a.status === 'completed').length} done`, 'hero'),
        kpi('This week', money(sum(week, p => +p.amount + +p.tip)), `${money(sum(week, p => p.tip))} in tips`, '', sparkline(days7)),
        kpi('Profit this month', money(inc - exp), `${money(inc)} in · ${money(exp)} out`),
        kpi('No-show rate', nsRate + '%', `${ns} in the last 90 days`),
      ];
    } else {
      const ws = weekStart(today);
      kpis = [
        kpi('Today', String(live.length), `${live.filter(a => a.status === 'completed').length} done so far`, 'hero'),
        kpi('Cuts this week', String(D.appointments.filter(a => a.status === 'completed' && T.day(a.starts_at) >= ws).length), 'Completed visits'),
        kpi('Next 7 days', String(D.appointments.filter(a => ['booked', 'confirmed'].includes(a.status) && new Date(a.starts_at) > now && new Date(a.starts_at) < now + 7 * 864e5).length), 'Upcoming bookings'),
        kpi('No-show rate', nsRate + '%', `${ns} in the last 90 days`),
      ];
    }

    // timeline
    const tl = h('div', { class: 'timeline' });
    if (!todays.length) tl.append(h('div', { class: 'empty' }, 'Nothing on the book today. ', h('button', { class: 'btn sm', type: 'button', onclick: () => openNewBooking({ day: today }) }, 'Add a booking')));
    let nowPlaced = false;
    todays.forEach(a => {
      const st = +new Date(a.starts_at), en = +new Date(a.ends_at);
      if (!nowPlaced && st > now) { tl.append(h('div', { class: 'nowline' }, 'Now · ' + T.time(new Date()))); nowPlaced = true; }
      tl.append(apptCard(a, en < now ? 'past' : (st <= now && en >= now ? 'now' : '')));
    });
    const greeting = (T.minutes(new Date()) < 720 ? 'Good morning' : T.minutes(new Date()) < 1020 ? 'Good afternoon' : 'Good evening') + ', ' + firstName(ME.full_name || 'there') + '.';

    return [
      h('div', { class: 'kpis' }, kpis),
      h('div', { class: 'grid2' },
        h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, 'Today\'s chair'), h('div', { class: 'sub' }, greeting)), h('button', { class: 'btn sm', type: 'button', onclick: () => go('calendar') }, icon('cal'), 'Calendar')), tl),
        h('div', { class: 'section-gap' }, nextUpCard(), confirmationsCard(), textsCard(), headsUpCard())),
    ];
  }
  function apptCard(a, cls) {
    const c = client(a.client_id); const st = D.stats.get(a.client_id);
    const acts = h('div', { class: 'acts' });
    const stop = fn => e => { e.stopPropagation(); fn(); };
    if (a.status === 'booked') acts.append(h('button', { class: 'btn sm good', type: 'button', onclick: stop(() => setStatus(a, 'confirmed')) }, icon('check'), 'Confirm'));
    if (['booked', 'confirmed'].includes(a.status)) {
      acts.append(h('button', { class: 'btn sm gold', type: 'button', onclick: stop(() => openCheckout(a)) }, 'Check out'));
      const sms = smsHref(c.phone, reminderText(a)); if (sms) acts.append(h('a', { class: 'btn sm', href: sms, onclick: e => e.stopPropagation() }, icon('msg'), 'Text'));
      if (new Date(a.starts_at) < Date.now()) acts.append(h('button', { class: 'btn sm danger', type: 'button', onclick: stop(() => setStatus(a, 'no_show')) }, 'No-show'));
    }
    const pay = D.payByAppt.get(a.id);
    return h('article', { class: 'appt ' + (cls || ''), tabindex: '0', onclick: () => openAppt(a), onkeydown: e => { if (e.key === 'Enter') openAppt(a); } },
      h('div', { class: 'tm' }, T.time(a.starts_at).replace(/ [AP]M/, ''), h('small', {}, T.time(a.starts_at).slice(-2) + ' · ' + mins(a) + 'm')),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'who' }, c.full_name, a.new_client ? h('span', { class: 'pill gold plain' }, 'New') : null, (c.tags || []).map(t => h('span', { class: 'pill plain' }, t)), st && st.noShows > 1 ? h('span', { class: 'pill warn plain' }, st.noShows + ' no-shows') : null),
        h('div', { class: 'what' }, `${svcName(a)}${D.staff.length > 1 ? ' · ' + staffName(a.staff_id) : ''}`),
        c.notes ? h('div', { class: 'note' }, '📝 ' + c.notes) : null,
        a.client_message ? h('div', { class: 'note' }, 'Client wrote: ' + a.client_message) : null),
      h('div', { class: 'right' }, pill(a.status), h('span', { class: 'price num' }, isAdmin() && pay ? money(+pay.amount + +pay.tip) : money(a.price))),
      acts.childNodes.length ? acts : null);
  }
  function nextUpCard() {
    const now = Date.now();
    const n = D.appointments.filter(a => ['booked', 'confirmed'].includes(a.status) && +new Date(a.ends_at) > now).sort(by('starts_at'))[0];
    if (!n) return h('section', { class: 'card next-up' }, h('div', { class: 'card-h' }, h('h2', {}, 'Next up')), h('p', { class: 'muted' }, 'No upcoming bookings. Share your booking link to fill the chair.'), h('button', { class: 'btn', type: 'button', onclick: () => copy(siteBase()) }, icon('copy'), 'Copy booking link'));
    const c = client(n.client_id); const diff = Math.round((+new Date(n.starts_at) - now) / 6e4);
    const rel = diff <= 0 ? 'Now' : diff < 60 ? `In ${diff} min` : diff < 60 * 24 ? `In ${Math.floor(diff / 60)}h ${diff % 60}m` : T.date(n.starts_at);
    const sms = smsHref(c.phone, reminderText(n));
    return h('section', { class: 'card next-up' },
      h('div', { class: 'card-h' }, h('h2', {}, 'Next up'), pill(n.status)),
      h('div', { class: 'big' }, rel),
      h('p', {}, h('b', {}, c.full_name), ' · ', T.time(n.starts_at)),
      h('p', { class: 'muted' }, svcName(n) + ' · ' + money(n.price)),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn gold', type: 'button', onclick: () => openCheckout(n) }, 'Check out'), sms ? h('a', { class: 'btn', href: sms }, icon('msg'), 'Text') : null, h('button', { class: 'btn', type: 'button', onclick: () => openAppt(n) }, 'Details')));
  }
  function confirmationsCard() {
    const today = T.today(), tmr = T.addDays(today, 1);
    const list = D.appointments.filter(a => a.status === 'booked' && [today, tmr].includes(T.day(a.starts_at)) && +new Date(a.starts_at) > Date.now()).sort(by('starts_at'));
    const body = list.length ? list.map(a => {
      const c = client(a.client_id); const msg = reminderText(a); const sms = smsHref(c.phone, msg);
      return h('div', { class: 'reminder' + (a.reminder_sent_at ? ' sent' : '') },
        h('div', { class: 'row between' }, h('b', {}, `${T.day(a.starts_at) === today ? 'Today' : 'Tomorrow'} ${T.time(a.starts_at)} · ${c.full_name}`), a.reminder_sent_at ? h('span', { class: 'pill confirmed plain' }, 'Sent') : h('span', { class: 'small muted num' }, fmtPhone(c.phone) || 'No phone')),
        h('div', { class: 'msg', title: 'Tap to see the full text', onclick: e => e.currentTarget.classList.toggle('open') }, msg),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => copy(msg) }, icon('copy'), 'Copy'),
          sms ? h('a', { class: 'btn sm gold', href: sms, onclick: () => markSent(a) }, icon('msg'), 'Open in Messages') : null,
          !a.reminder_sent_at ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => markSent(a, true) }, 'Mark sent') : null));
    }) : [h('div', { class: 'empty' }, 'Everyone today and tomorrow is confirmed.')];
    return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, 'Confirmation texts'), h('div', { class: 'sub' }, 'Unconfirmed bookings for today and tomorrow. Each text has their one-tap confirm link.'))),
      h('div', { class: 'stack' }, body));
  }
  // Thank-you texts after a visit: first-timers get rebook + review + refer-a-friend.
  function followupText(a) {
    const c = client(a.client_id); const site = (S().site_url || siteBase()).replace(/\/$/, '');
    const visits = D.appointments.filter(x => x.client_id === a.client_id && x.status === 'completed').length;
    const first = a.new_client || visits <= 1;
    return first
      ? `Thanks for coming in, ${firstName(c.full_name)}! Hope you love the cut.`
        + `\nReady for the next one? Book anytime: ${site}`
        + `\nIf you have a minute, a quick review helps me a lot: ${manageUrl(a.manage_token)}`
        + `\nKnow someone who needs a cut? Send them ${site} (first cuts are $25).`
        + `\n- Miguel, Lopezcuts`
      : `Thanks again, ${firstName(c.full_name)}! Book your next cut anytime: ${site}`
        + `\nEnjoyed it? A quick review means a lot: ${manageUrl(a.manage_token)}`
        + `\n- Miguel`;
  }
  // Texts waiting for Miguel to send from his own phone (Settings → Texts → "I send them").
  // Booking / you-moved-it / you-cancelled-it texts come from the database queue;
  // thank-yous come from finished visits that haven't had one yet.
  const textMode = () => S().text_mode || 'manual';
  function textsCard() {
    if (textMode() !== 'manual' || !isAdmin()) return null;
    const kinds = { booked: ['Booking confirmed', 'confirmed'], rescheduled: ['You moved it', 'warn'], cancelled: ['You cancelled', 'no_show'], followup: ['Thank-you', 'gold'] };
    const queued = (D.sms_outbox || []).filter(m => m.status === 'queued').map(m => ({ key: 'q' + m.id, kind: m.kind, c: client(m.client_id), when: m.created_at, msg: m.body, phone: m.to_phone, done: skip => markText(m, skip) }));
    const since = Date.now() - 7 * 864e5;
    const reviewed = new Set(D.reviews.map(r => r.appointment_id).filter(Boolean));
    const thanks = D.appointments.filter(a => a.status === 'completed' && !a.followup_sent_at && !reviewed.has(a.id) && +new Date(a.completed_at || a.starts_at) > since && client(a.client_id)?.phone)
      .map(a => ({ key: 'f' + a.id, kind: 'followup', c: client(a.client_id), when: a.starts_at, msg: followupText(a), phone: client(a.client_id).phone, first: a.new_client, done: skip => markFollowup(a, skip) }));
    const list = [...queued.sort((x, y) => +new Date(x.when) - +new Date(y.when)), ...thanks.sort((x, y) => +new Date(y.when) - +new Date(x.when))].slice(0, 25);
    if (!list.length) return null;
    const body = list.map(t => {
      const sms = smsHref(t.phone, t.msg); const [label, tone] = kinds[t.kind] || [t.kind, ''];
      return h('div', { class: 'reminder' },
        h('div', { class: 'row between' }, h('b', {}, `${t.c.full_name} · ${T.date(t.when, { weekday: 'short', month: 'short', day: 'numeric' })}`),
          h('span', { class: 'pill plain ' + tone }, t.kind === 'followup' && t.first ? 'Thank-you · first visit' : label)),
        h('div', { class: 'msg', title: 'Tap to see the full text', onclick: e => e.currentTarget.classList.toggle('open') }, t.msg),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => copy(t.msg) }, icon('copy'), 'Copy'),
          sms ? h('a', { class: 'btn sm gold', href: sms, onclick: () => t.done(false) }, icon('msg'), 'Open in Messages') : null,
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => t.done(true) }, 'Skip')));
    });
    return h('section', { class: 'card', id: 'textsCard' }, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, `Texts to send (${list.length})`),
      h('div', { class: 'sub' }, 'Send these from your phone at the end of the day. Tap Open in Messages, hit send, and it drops off this list.'))),
      h('div', { class: 'stack' }, body));
  }
  async function markText(m, skip) { await run(() => LC.update('sms_outbox', m.id, { status: skip ? 'skipped' : 'sent', sent_at: skip ? null : new Date().toISOString() }), skip ? 'Removed from the list' : null); refresh(['sms_outbox']); }
  async function markFollowup(a, notify) { await run(() => LC.update('appointments', a.id, { followup_sent_at: new Date().toISOString() }), notify ? 'Removed from the list' : null); refresh(['appointments']); }
  async function markSent(a, notify) { await run(() => LC.update('appointments', a.id, { reminder_sent_at: new Date().toISOString() }), notify ? 'Marked as sent' : null); refresh(['appointments']); }
  function headsUpCard() {
    const al = []; const now = Date.now(); const today = T.today();
    if (isAdmin() && !S().address) al.push(['warn', 'Add your address in Settings so confirmation texts include it.', 'Settings', () => { UI.setupTab = 'business'; go('setup'); }]);
    if (!S().booking_open) al.push(['warn', 'Online booking is paused. Clients can\'t book on the site.', isAdmin() ? 'Turn on' : null, () => { UI.setupTab = 'business'; go('setup'); }]);
    D.inventory.filter(i => +i.qty <= +i.reorder_at).forEach(i => al.push(['bad', `Reorder ${i.name}: ${+(+i.qty).toFixed(1)} ${i.unit || ''} left.`, 'Supplies', () => go('supplies')]));
    const pend = D.reviews.filter(r => r.status === 'pending').length;
    if (pend) al.push(['info', `${pend} new review${pend > 1 ? 's' : ''} waiting for your approval.`, 'Review', () => { UI.revFilter = 'pending'; go('reviews'); }]);
    const stale = D.appointments.filter(a => ['booked', 'confirmed'].includes(a.status) && +new Date(a.ends_at) < now);
    if (stale.length) al.push(['warn', `${stale.length} past booking${stale.length > 1 ? 's are' : ' is'} still open. Check out or mark no-show.`, 'Show', () => openStale(stale)]);
    if (isAdmin()) {
      const mk = today.slice(0, 7); const spent = {}; D.expenses.filter(x => x.spent_on.slice(0, 7) === mk).forEach(x => { spent[x.category] = (spent[x.category] || 0) + +x.amount; });
      D.budgets.forEach(b => { if (+b.monthly_limit > 0 && (spent[b.category] || 0) > +b.monthly_limit) al.push(['bad', `${b.category} is over budget: ${money(spent[b.category])} of ${money(b.monthly_limit)}.`, 'Money', () => go('money')]); });
    }
    const md = d => d.slice(5);
    const soon = new Set(Array.from({ length: 7 }, (_, i) => md(T.addDays(today, i))));
    D.clients.filter(c => c.birthday && soon.has(c.birthday.slice(5))).forEach(c => al.push(['info', `${c.full_name}'s birthday is ${c.birthday.slice(5) === md(today) ? 'today' : T.dayLabel(today.slice(0, 4) + c.birthday.slice(4), { weekday: 'long' })}.`, 'Open', () => openClient(c.id)]));
    const due = D.clients.map(c => [c, D.stats.get(c.id)]).filter(([, s]) => s && s.dueBack && !s.next && +new Date(s.dueBack) < now - 5 * 864e5 && +new Date(s.dueBack) > now - 60 * 864e5).sort((x, y) => x[1].dueBack.localeCompare(y[1].dueBack)).slice(0, 4);
    due.forEach(([c, s]) => al.push(['info', `${c.full_name} usually comes every ${Math.round(s.avgGap)} days and is overdue. Send a rebook text?`, 'Text', () => { const href = smsHref(c.phone, `Hey ${firstName(c.full_name)}! It's been a minute. Want to get your next cut on the books? Book here: ${siteBase()}`); if (href) location.href = href; else openClient(c.id); }]));
    return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Heads up')),
      h('div', { class: 'stack' }, al.length ? al.map(([t, m, btn, fn]) => h('div', { class: 'alert ' + t }, icon(t === 'good' ? 'check' : t === 'info' ? 'clock' : 'alert'), h('span', {}, m), btn ? h('button', { class: 'btn sm', type: 'button', onclick: fn }, btn) : null)) : [h('div', { class: 'alert good' }, icon('check'), 'All clear.')]));
  }
  function openStale(list) {
    drawer('Open past bookings', [h('p', { class: 'hint' }, 'These visits already happened but were never checked out.'), h('div', { class: 'list' }, list.sort(by('starts_at', -1)).map(a => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { class: 't' }, client(a.client_id).full_name), h('div', { class: 's' }, `${T.date(a.starts_at)} ${T.time(a.starts_at)} · ${svcName(a)}`)),
      h('button', { class: 'btn sm gold', type: 'button', onclick: () => openCheckout(a) }, 'Check out'), h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { await setStatus(a, 'no_show'); openStale(list.filter(x => x.id !== a.id)); } }, 'No-show'))))]);
  }

  // ===================================================================
  //  APPOINTMENT ACTIONS
  // ===================================================================
  async function setStatus(a, status, extra = {}) {
    const patch = { status, ...extra };
    if (status === 'confirmed') patch.confirmed_at = new Date().toISOString();
    if (status === 'cancelled') { patch.cancelled_at = new Date().toISOString(); patch.cancelled_by = patch.cancelled_by || 'shop'; }
    await run(() => LC.update('appointments', a.id, patch), { confirmed: 'Confirmed', no_show: 'Marked no-show', cancelled: 'Cancelled', booked: 'Restored' }[status]);
    await refresh(['appointments']); if (drawerEl.open && $('#drawerTitle').textContent === 'Appointment') openAppt(D.appointments.find(x => x.id === a.id) || a);
  }
  function openCheckout(a) {
    const c = client(a.client_id);
    const amt = h('input', { id: 'coAmt', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: String(+a.price) });
    const tip = h('input', { id: 'coTip', type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: '0' });
    const note = h('input', { id: 'coNote', placeholder: 'Optional' });
    let method = 'cash';
    const methods = [['cash', 'Cash'], ['venmo', 'Venmo'], ['zelle', 'Zelle'], ['cashapp', 'Cash App'], ['apple_pay', 'Apple Pay'], ['card', 'Card'], ['other', 'Other']];
    const mrow = h('div', { class: 'pay-methods', role: 'radiogroup', 'aria-label': 'Payment method' }, methods.map(([k, l]) => h('button', { class: 'chip', type: 'button', role: 'radio', 'aria-pressed': String(k === method), onclick: e => { method = k; $$('button', mrow).forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, l)));
    const total = h('b', { class: 'num' }, money(a.price));
    const upd = () => { total.textContent = money((+amt.value || 0) + (+tip.value || 0)); };
    amt.addEventListener('input', upd); tip.addEventListener('input', upd);
    const tipQuick = h('div', { class: 'chips' }, [0, 5, 10, 15].map(t => h('button', { class: 'chip', type: 'button', onclick: () => { tip.value = t || ''; upd(); } }, t ? '+' + money(t) : 'No tip')));
    const btn = h('button', { class: 'btn gold block', type: 'button', onclick: async () => {
      btn.disabled = true;
      try { await run(() => LC.rpc('complete_appointment', { p_id: a.id, p_amount: +amt.value || 0, p_tip: +tip.value || 0, p_method: method, p_note: note.value }), 'Checked out'); modalEl.close(); if (drawerEl.open) drawerEl.close(); await refresh(['appointments', 'payments', 'inventory']); }
      catch { btn.disabled = false; }
    } }, icon('check'), 'Finish checkout');
    modal('Check out', [
      h('p', {}, h('b', {}, c.full_name), ' · ', svcName(a), h('br'), h('span', { class: 'muted small' }, `${T.date(a.starts_at)} at ${T.time(a.starts_at)}${a.new_client ? ' · first visit' : ''}`)),
      h('div', { class: 'row' }, field('Service total', amt), field('Tip', tip)), tipQuick,
      h('div', { class: 'f' }, 'Paid with', mrow), field('Note', note),
      h('div', { class: 'total-line' }, h('span', { class: 'muted' }, 'Total collected'), total),
      !isAdmin() ? h('p', { class: 'hint' }, 'Payments go straight to the owner\'s books. You won\'t see totals after checkout.') : null, btn]);
    setTimeout(() => tip.focus(), 60);
  }

  function openAppt(a) {
    a = D.appointments.find(x => x.id === a.id) || a;
    const c = client(a.client_id); const pay = D.payByAppt.get(a.id); const st = D.stats.get(a.client_id);
    const note = h('textarea', { id: 'apNote', placeholder: 'Only staff see this' }, a.internal_note || '');
    const sms = smsHref(c.phone, reminderText(a));
    const actions = h('div', { class: 'row' });
    if (['booked', 'confirmed'].includes(a.status)) {
      actions.append(h('button', { class: 'btn gold', type: 'button', onclick: () => openCheckout(a) }, 'Check out'));
      if (a.status === 'booked') actions.append(h('button', { class: 'btn good', type: 'button', onclick: () => setStatus(a, 'confirmed') }, icon('check'), 'Confirm'));
      actions.append(h('button', { class: 'btn danger', type: 'button', onclick: () => setStatus(a, 'no_show') }, 'No-show'));
    }
    if (['no_show', 'cancelled'].includes(a.status)) actions.append(h('button', { class: 'btn', type: 'button', onclick: () => setStatus(a, 'booked', { cancelled_at: null, cancelled_by: null }) }, 'Restore booking'));
    if (a.status === 'completed' && isAdmin()) actions.append(armBtn('Undo checkout', async () => { await run(() => LC.rpc('reopen_appointment', { p_id: a.id }), 'Checkout undone'); await refresh(['appointments', 'payments', 'inventory']); openAppt(a); }, 'btn'));

    // reschedule
    const rDay = h('input', { id: 'rsDay', type: 'date', value: T.day(a.starts_at) });
    const rTime = h('input', { id: 'rsTime', type: 'time', step: '300', value: T.hm(T.minutes(a.starts_at)) });
    const resched = ['booked', 'confirmed'].includes(a.status) ? h('details', {}, h('summary', { class: 'btn sm', style: 'display:inline-flex' }, icon('clock'), 'Reschedule'),
      h('div', { class: 'row', style: 'margin-top:10px;align-items:end' }, field('Day', rDay), field('Time', rTime),
        h('button', { class: 'btn dark', type: 'button', onclick: async () => {
          const start = T.zoned(rDay.value, rTime.value); const end = new Date(+start + mins(a) * 6e4);
          await run(() => LC.update('appointments', a.id, { starts_at: start.toISOString(), ends_at: end.toISOString(), reminder_sent_at: null }), 'Moved to ' + T.date(start) + ' ' + T.time(start));
          await refresh(['appointments']); openAppt(a);
        } }, 'Move'))) : null;
    const reason = h('input', { id: 'cxReason', placeholder: 'Reason (optional)' });
    const cancelBox = ['booked', 'confirmed'].includes(a.status) ? h('details', {}, h('summary', { class: 'btn sm danger', style: 'display:inline-flex' }, 'Cancel appointment'),
      h('div', { class: 'row', style: 'margin-top:10px;align-items:end' }, field('Reason', reason), h('button', { class: 'btn danger', type: 'button', onclick: () => setStatus(a, 'cancelled', { cancel_reason: reason.value }) }, 'Cancel it'))) : null;

    drawer('Appointment', [
      h('div', { class: 'row between' }, h('div', {}, h('div', { style: 'font:400 2.4rem/1 var(--display)' }, T.time(a.starts_at)), h('div', { class: 'muted' }, `${T.date(a.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })} · ${mins(a)} min`)), pill(a.status)),
      h('button', { class: 'picked', type: 'button', style: 'cursor:pointer;text-align:left', onclick: () => openClient(c.id) }, h('span', { class: 'avatar' }, initials(c.full_name)), h('span', { style: 'flex:1;min-width:0' }, h('b', {}, c.full_name), h('br'), h('span', { class: 'small muted' }, `${st ? st.visits : 0} visits${st?.noShows ? ' · ' + st.noShows + ' no-shows' : ''} · ${fmtPhone(c.phone) || 'no phone'}`)), icon('right')),
      h('div', { class: 'row' }, sms ? h('a', { class: 'btn sm', href: sms }, icon('msg'), 'Text') : null, c.phone ? h('button', { class: 'btn sm', type: 'button', onclick: () => copy(fmtPhone(c.phone)) }, icon('copy'), 'Copy number') : null, h('button', { class: 'btn sm', type: 'button', onclick: () => copy(manageUrl(a.manage_token)) }, icon('copy'), 'Client\'s booking link')),
      h('dl', { class: 'dl' },
        h('dt', {}, 'Service'), h('dd', {}, svcName(a)),
        h('dt', {}, 'Barber'), h('dd', {}, staffName(a.staff_id)),
        h('dt', {}, 'Quoted'), h('dd', {}, money(a.price) + (a.new_client ? ' (first visit)' : '')),
        pay && isAdmin() ? [h('dt', {}, 'Paid'), h('dd', {}, `${money(pay.amount)} + ${money(pay.tip)} tip · ${pay.method.replace('_', ' ')}`)] : null,
        h('dt', {}, 'Booked'), h('dd', {}, `${T.date(a.created_at)} · ${{ online: 'online', manual: 'by staff', walk_in: 'walk-in', booksy: 'from Booksy' }[a.source] || a.source}`),
        h('dt', {}, 'Reminder'), h('dd', {}, a.reminder_sent_at ? 'Sent ' + T.date(a.reminder_sent_at) + ' ' + T.time(a.reminder_sent_at) : 'Not sent'),
        a.confirmed_at ? [h('dt', {}, 'Confirmed'), h('dd', {}, T.date(a.confirmed_at) + ' ' + T.time(a.confirmed_at))] : null,
        a.cancelled_at ? [h('dt', {}, 'Cancelled'), h('dd', {}, `${T.date(a.cancelled_at)} by ${a.cancelled_by || 'shop'}${a.cancel_reason ? ': ' + a.cancel_reason : ''}`)] : null,
        a.client_message ? [h('dt', {}, 'Client wrote'), h('dd', {}, a.client_message)] : null),
      actions,
      h('div', { class: 'row' }, resched, cancelBox),
      field('Staff note', note), h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => { await run(() => LC.update('appointments', a.id, { internal_note: note.value }), 'Note saved'); refresh(['appointments']); } }, 'Save note'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openNewBooking({ clientId: c.id }) }, icon('plus'), 'Book again'),
        isAdmin() ? armBtn('Delete', async () => { await run(() => LC.remove('appointments', a.id), 'Deleted'); drawerEl.close(); refresh(['appointments', 'payments']); }) : null),
    ]);
  }

  // ===================================================================
  //  NEW BOOKING
  // ===================================================================
  function openNewBooking(pre = {}) {
    const staffChoices = isAdmin() ? D.staff.filter(s => s.active) : D.staff.filter(s => s.id === ME.staff_id);
    if (!staffChoices.length) { toast(isAdmin() ? 'Add a barber in Settings → Team first.' : 'Your login isn\'t linked to a chair yet. Ask the owner.'); return; }
    const B = { clientId: pre.clientId || null, newClient: !pre.clientId, serviceId: (D.services.find(s => !s.is_addon && s.active && s.bookable) || D.services.find(s => !s.is_addon))?.id, addons: new Set(), staffId: pre.staffId || (UI.calStaff !== 'all' && staffChoices.some(s => s.id === UI.calStaff) ? UI.calStaff : staffChoices[0].id), day: pre.day || T.today(), slot: null, custom: pre.time || '', walkIn: false, priceTouched: false };
    const nm = h('input', { id: 'nbName', placeholder: 'Client name', autocomplete: 'off' });
    const ph = h('input', { id: 'nbPhone', type: 'tel', placeholder: '(801) 555-1234', autocomplete: 'off' });
    const em = h('input', { id: 'nbEmail', type: 'email', placeholder: 'Optional' });
    const priceIn = h('input', { id: 'nbPrice', type: 'number', min: '0', step: '1' });
    const noteIn = h('input', { id: 'nbNote', placeholder: 'Optional, staff only' });
    const tipIn = h('input', { id: 'nbTip', type: 'number', min: '0', step: '1', placeholder: '0' });
    const methodSel = h('select', { id: 'nbMethod' }, [['cash', 'Cash'], ['venmo', 'Venmo'], ['zelle', 'Zelle'], ['cashapp', 'Cash App'], ['apple_pay', 'Apple Pay'], ['card', 'Card'], ['other', 'Other']].map(([v, l]) => h('option', { value: v }, l)));
    const clientBox = h('div'); const svcBox = h('div', { class: 'stack' }); const slotBox = h('div', { class: 'stack' }); const payBox = h('div', { class: 'row' }, field('Tip', tipIn), field('Paid with', methodSel));
    const err = h('div', { 'aria-live': 'polite' });

    const svc = () => D.svc.get(B.serviceId);
    const addonObjs = () => D.services.filter(s => s.is_addon && B.addons.has(s.id));
    const dur = () => (svc()?.duration_min || 40) + sum(addonObjs(), x => x.duration_min);
    const isNew = () => !B.clientId || !(D.stats.get(B.clientId)?.visits > 0);
    const autoPrice = () => (isNew() && svc()?.new_client_price != null ? +svc().new_client_price : +(svc()?.price || 0)) + sum(addonObjs(), x => x.price);
    const paintPrice = () => { if (!B.priceTouched) priceIn.value = autoPrice(); };
    priceIn.addEventListener('input', () => { B.priceTouched = true; });

    function paintClient() {
      if (B.clientId) {
        const c = client(B.clientId); const st = D.stats.get(B.clientId);
        clientBox.replaceChildren(h('div', { class: 'picked' }, h('span', { class: 'avatar' }, initials(c.full_name)), h('span', { style: 'flex:1;min-width:0' }, h('b', {}, c.full_name), h('br'), h('span', { class: 'small muted' }, `${fmtPhone(c.phone)} · ${st?.visits || 0} visits`)), h('button', { class: 'btn sm', type: 'button', onclick: () => { B.clientId = null; paintClient(); paintPrice(); } }, 'Change')));
        return;
      }
      const q = h('input', { id: 'nbSearch', placeholder: 'Search clients by name or phone', autocomplete: 'off' });
      const listEl = h('div', { class: 'ta-list', hidden: true });
      q.addEventListener('input', () => {
        const s = q.value.trim().toLowerCase(); const d = s.replace(/\D/g, '');
        if (!s) { listEl.hidden = true; return; }
        const hits = D.clients.filter(c => c.full_name.toLowerCase().includes(s) || (d.length >= 3 && (c.phone || '').includes(d))).slice(0, 8);
        listEl.replaceChildren(...hits.map(c => h('button', { type: 'button', onclick: () => { B.clientId = c.id; paintClient(); paintPrice(); } }, h('span', { class: 'avatar', style: 'width:28px;height:28px;font-size:.9rem' }, initials(c.full_name)), h('span', {}, c.full_name, h('br'), h('span', { class: 'small muted' }, fmtPhone(c.phone))))),
          h('button', { type: 'button', onclick: () => { nm.value = q.value; listEl.hidden = true; nm.focus(); } }, icon('plus'), `New client "${q.value}"`));
        listEl.hidden = false;
      });
      clientBox.replaceChildren(h('div', { class: 'typeahead' }, field('Find a client', q), listEl), h('div', { class: 'divider' }, 'or add a new client'), h('div', { class: 'row' }, field('Name', nm), field('Phone', ph)), field('Email', em));
    }
    function paintSvc() {
      const mains = D.services.filter(s => !s.is_addon && s.active);
      const adds = D.services.filter(s => s.is_addon && s.active);
      svcBox.replaceChildren(
        field('Service', h('select', { id: 'nbSvc', onchange: e => { B.serviceId = e.target.value; paintPrice(); loadSlots(); } }, mains.map(s => h('option', { value: s.id, selected: s.id === B.serviceId }, `${s.name} · ${s.new_client_price != null ? money(s.new_client_price) + '/' : ''}${money(s.price)} · ${s.duration_min} min`)))),
        adds.length ? h('div', { class: 'f' }, 'Add-ons', h('div', { class: 'chips' }, adds.map(a => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(B.addons.has(a.id)), onclick: e => { B.addons.has(a.id) ? B.addons.delete(a.id) : B.addons.add(a.id); e.currentTarget.setAttribute('aria-pressed', String(B.addons.has(a.id))); paintPrice(); loadSlots(); } }, `${a.name} +${money(a.price)}`)))) : null,
        staffChoices.length > 1 ? field('Barber', h('select', { id: 'nbStaff', onchange: e => { B.staffId = e.target.value; loadSlots(); } }, staffChoices.map(s => h('option', { value: s.id, selected: s.id === B.staffId }, s.display_name)))) : null);
    }
    const dayIn = h('input', { id: 'nbDay', type: 'date', value: B.day, onchange: e => { B.day = e.target.value; B.slot = null; loadSlots(); } });
    const customIn = h('input', { id: 'nbTime', type: 'time', step: '300', value: B.custom, oninput: e => { B.custom = e.target.value; B.slot = null; $$('.slot', slotBox).forEach(x => x.setAttribute('aria-pressed', 'false')); } });
    let slotReq = 0;
    async function loadSlots() {
      if (B.walkIn) { slotBox.replaceChildren(h('p', { class: 'hint' }, 'Walk-in: the visit is logged starting now and checked out right away.')); return; }
      const my = ++slotReq; slotBox.replaceChildren(h('div', { class: 'skel', style: 'height:60px' }));
      let slots = [];
      try { slots = await LC.rpc('get_available_slots_staff', { p_staff_id: B.staffId, p_day: B.day, p_duration: dur() }); } catch (e) { toast(e.message); }
      if (my !== slotReq) return;
      if (B.custom && slots.some(s => T.hm(T.minutes(s)) === B.custom)) { B.slot = slots.find(s => T.hm(T.minutes(s)) === B.custom); B.custom = ''; customIn.value = ''; }
      slotBox.replaceChildren(
        field('Day', dayIn),
        h('div', { class: 'f' }, slots.length ? `Open times (${slots.length})` : 'No open times that day',
          slots.length ? h('div', { class: 'slots' }, slots.map(s => h('button', { class: 'slot', type: 'button', 'aria-pressed': String(B.slot === s), onclick: e => { B.slot = s; B.custom = ''; customIn.value = ''; $$('.slot', slotBox).forEach(x => x.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); } }, T.time(s)))) : null),
        isAdmin() ? field('Or a custom time', customIn, 'Books even outside working hours. Double bookings are still blocked.') : null);
    }
    const walk = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', id: 'nbWalk', onchange: e => { B.walkIn = e.target.checked; payBox.hidden = !B.walkIn; submit.textContent = B.walkIn ? 'Log walk-in and check out' : 'Book appointment'; loadSlots(); } }), 'Walk-in, check out now');
    payBox.hidden = true;
    const submit = h('button', { class: 'btn gold block', type: 'button', onclick: async () => {
      err.replaceChildren();
      let start;
      if (B.walkIn) { const n = new Date(); n.setSeconds(0, 0); start = new Date(+n - dur() * 6e4); }
      else if (B.slot) start = new Date(B.slot);
      else if (B.custom && isAdmin()) start = T.zoned(B.day, B.custom);
      else { err.replaceChildren(h('div', { class: 'err' }, 'Pick a time.')); return; }
      if (!B.clientId && !nm.value.trim()) { err.replaceChildren(h('div', { class: 'err' }, 'Pick a client or enter a new client\'s name.')); return; }
      if (!B.clientId && ph.value && !normPhone(ph.value)) { err.replaceChildren(h('div', { class: 'err' }, 'That phone number doesn\'t look right.')); return; }
      submit.disabled = true;
      try {
        const id = await LC.rpc('staff_book', { p_client_id: B.clientId, p_name: nm.value.trim(), p_phone: ph.value, p_email: em.value, p_service_id: B.serviceId, p_addon_ids: [...B.addons], p_staff_id: B.staffId, p_starts_at: start.toISOString(), p_price: priceIn.value === '' ? null : +priceIn.value, p_note: noteIn.value, p_force: !!(B.custom && !B.slot && isAdmin()), p_source: B.walkIn ? 'walk_in' : 'manual' });
        if (B.walkIn) await LC.rpc('complete_appointment', { p_id: id, p_amount: +priceIn.value || 0, p_tip: +tipIn.value || 0, p_method: methodSel.value, p_note: '' });
        modalEl.close(); toast(B.walkIn ? 'Walk-in logged' : `Booked ${T.date(start)} at ${T.time(start)}`);
        await refresh(['appointments', 'clients', 'payments', 'inventory']);
      } catch (e) { err.replaceChildren(h('div', { class: 'err' }, e.message)); }
      finally { submit.disabled = false; }
    } }, 'Book appointment');
    paintClient(); paintSvc(); paintPrice();
    modal('New booking', [clientBox, svcBox, walk, slotBox, h('div', { class: 'row' }, field('Price', priceIn, 'First-visit price applies to new clients'), field('Note', noteIn)), payBox, err, submit], { wide: true });
    loadSlots();
  }

  // ===================================================================
  //  CALENDAR
  // ===================================================================
  // ---------------- Schedule: a scrolling day-by-day list (phone friendly)
  function viewSchedule() {
    const today = T.today(); const now = Date.now();
    const mine = a => isAdmin() || a.staff_id === ME.staff_id;
    const appts = D.appointments.filter(a => a.status !== 'cancelled' && mine(a));
    const byDay = new Map(); appts.forEach(a => { const d = T.day(a.starts_at); (byDay.get(d) || byDay.set(d, []).get(d)).push(a); });
    const workDays = new Set(D.working_hours.filter(w => isAdmin() || w.staff_id === ME.staff_id).map(w => w.weekday));
    const off = d => D.time_off.some(t => T.day(t.starts_at) <= d && T.day(new Date(+new Date(t.ends_at) - 1)) >= d);
    const first = UI.schedPast ? T.addDays(today, -14) : today;
    const lastBooked = [...byDay.keys()].sort().at(-1) || today;
    const last = [T.addDays(today, 30), lastBooked].sort().at(-1);
    const est = list => list.filter(a => a.status !== 'no_show').reduce((t, a) => t + (+a.price || 0), 0);
    const days = [];
    for (let d = first; d <= last; d = T.addDays(d, 1)) {
      const list = (byDay.get(d) || []).sort(by('starts_at'));
      const working = workDays.has(T.weekday(d)) && !off(d);
      if (list.length || (working && d >= today)) days.push({ d, list, working });
    }
    const wk = T.addDays(today, 6); const weekList = appts.filter(a => { const d = T.day(a.starts_at); return d >= today && d <= wk; });
    const head = h('div', { class: 'sched-sum' },
      h('div', {}, h('b', {}, String(weekList.filter(a => a.status !== 'no_show').length)), h('span', {}, 'clients next 7 days')),
      isAdmin() ? h('div', {}, h('b', {}, money(est(weekList))), h('span', {}, 'estimated next 7 days')) : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => { UI.schedPast = !UI.schedPast; render(); } }, UI.schedPast ? 'Hide past days' : 'Show past 2 weeks'));
    const dayEl = ({ d, list, working }) => {
      const isToday = d === today;
      const label = isToday ? 'Today' : d === T.addDays(today, 1) ? 'Tomorrow' : T.dayLabel(d, { weekday: 'long' });
      const live = list.filter(a => a.status !== 'no_show');
      return h('section', { class: 'sched-day' + (isToday ? ' today' : '') + (d < today ? ' past' : ''), id: 'day-' + d },
        h('div', { class: 'sched-h' },
          h('div', {}, h('div', { class: 'sd-name' }, label), h('div', { class: 'sd-date' }, T.dayLabel(d, { month: 'long', day: 'numeric' }))),
          h('div', { class: 'sd-tot' }, h('span', {}, live.length ? `${live.length} client${live.length === 1 ? '' : 's'}` : 'No bookings'), isAdmin() ? h('b', {}, money(est(live))) : null, isAdmin() ? h('small', {}, d < today ? 'income' : 'est. income') : null)),
        list.length ? h('div', { class: 'sched-list' }, list.map(a => {
          const c = client(a.client_id); const end = +new Date(a.ends_at); const isNow = +new Date(a.starts_at) <= now && end > now;
          return h('button', { class: 'sched-row' + (end < now ? ' done' : '') + (isNow ? ' now' : ''), type: 'button', onclick: () => openAppt(a) },
            h('span', { class: 'sr-time' }, T.time(a.starts_at)),
            h('span', { class: 'sr-main' }, h('b', {}, c.full_name), h('span', {}, svcName(a) + (a.new_client ? ' · first visit' : ''))),
            h('span', { class: 'sr-right' }, isAdmin() ? h('b', {}, money(a.price)) : null, a.status !== 'booked' ? pill(a.status) : null));
        })) : h('button', { class: 'sched-open', type: 'button', onclick: () => openNewBooking({ day: d }) }, working ? 'Open · tap to add a booking' : 'Tap to add a booking'));
    };
    const out = [head, h('div', { class: 'sched' }, days.map(dayEl))];
    requestAnimationFrame(() => { if (UI.schedPast) $('#day-' + today)?.scrollIntoView({ block: 'start' }); });
    return out;
  }

  function viewCalendar() {
    const one = innerWidth < 760; const n = one ? 1 : 7;
    const start = one ? UI.calAnchor : weekStart(UI.calAnchor);
    const days = Array.from({ length: n }, (_, i) => T.addDays(start, i));
    const staffShown = isAdmin() ? (UI.calStaff === 'all' ? D.staff.filter(s => s.active) : D.staff.filter(s => s.id === UI.calStaff)) : D.staff.filter(s => s.id === ME.staff_id);
    const sIds = new Set(staffShown.map(s => s.id));
    const hours = D.working_hours.filter(w => sIds.has(w.staff_id));
    const appts = D.appointments.filter(a => days.includes(T.day(a.starts_at)) && a.status !== 'cancelled' && (sIds.has(a.staff_id) || !isAdmin()));
    let lo = Math.min(9 * 60, ...hours.map(w => toMin(w.start_time)), ...appts.map(a => T.minutes(a.starts_at)));
    let hi = Math.max(20 * 60, ...hours.map(w => toMin(w.end_time)), ...appts.map(a => T.minutes(a.starts_at) + mins(a)));
    lo = Math.floor(lo / 60) * 60; hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
    const ppm = 1.15, H = (hi - lo) * ppm;
    const label = one ? T.dayLabel(start, { weekday: 'long', month: 'long', day: 'numeric' }) : `${T.dayLabel(start, { month: 'short', day: 'numeric' })} – ${T.dayLabel(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const shift = k => { UI.calAnchor = T.addDays(UI.calAnchor, k * n); render(); };

    const grid = h('div', { class: 'cal-grid' + (one ? ' one' : ''), style: `grid-template-columns: 54px repeat(${n}, minmax(0, 1fr))` });
    grid.append(h('div', { class: 'cal-head' }, h('div', {}), days.map(d => {
      const cnt = appts.filter(a => T.day(a.starts_at) === d && a.status !== 'no_show').length;
      return h('div', { class: d === T.today() ? 'today' : '' }, h('div', { class: 'dw' }, T.dayLabel(d, { weekday: 'short' })), h('div', { class: 'dn' }, T.dayLabel(d, { day: 'numeric' })), h('div', { class: 'cnt' }, cnt ? `${cnt} booked` : ' '));
    })));
    const times = h('div', { class: 'cal-times', style: `height:${H}px` });
    for (let m = lo; m < hi; m += 60) times.append(h('span', { style: `top:${(m - lo) * ppm}px` }, m === lo ? '' : T.fmtHm(T.hm(m)).replace(':00', '')));
    grid.append(times);
    const nowMin = T.minutes(new Date());
    days.forEach(d => {
      const col = h('div', { class: 'cal-col', style: `height:${H}px`, title: 'Click an open spot to book' });
      hours.filter(w => w.weekday === T.weekday(d)).forEach(w => col.append(h('div', { class: 'open', style: `top:${(toMin(w.start_time) - lo) * ppm}px;height:${(toMin(w.end_time) - toMin(w.start_time)) * ppm}px` })));
      for (let m = lo + 30; m < hi; m += 30) col.append(h('div', { class: 'hr' + (m % 60 ? ' half' : ''), style: `top:${(m - lo) * ppm}px` }));
      D.time_off.filter(o => sIds.has(o.staff_id)).forEach(o => {
        const ds = +T.zoned(d, '00:00'), de = +T.zoned(T.addDays(d, 1), '00:00'); const os = +new Date(o.starts_at), oe = +new Date(o.ends_at);
        if (oe <= ds || os >= de) return;
        const a = os <= ds ? lo : Math.max(lo, T.minutes(o.starts_at)); const b = oe >= de ? hi : Math.min(hi, T.minutes(o.ends_at));
        if (b > a) col.append(h('div', { class: 'off', style: `top:${(a - lo) * ppm}px;height:${(b - a) * ppm}px`, title: o.reason, onclick: e => { e.stopPropagation(); openTimeOff(o); } }, `Off${staffShown.length > 1 ? ' · ' + firstName(staffName(o.staff_id)) : ''}${o.reason ? ': ' + o.reason : ''}`));
      });
      const dayAppts = appts.filter(a => T.day(a.starts_at) === d);
      const lanes = staffShown.length > 1 ? staffShown.map(s => s.id) : null;
      dayAppts.forEach(a => {
        const c = client(a.client_id); const top = (T.minutes(a.starts_at) - lo) * ppm; const ht = Math.max(22, mins(a) * ppm - 2);
        const clash = lanes && dayAppts.some(x => x !== a && x.staff_id !== a.staff_id && x.status !== 'cancelled' && +new Date(x.starts_at) < +new Date(a.ends_at) && +new Date(a.starts_at) < +new Date(x.ends_at));
        const li = clash ? Math.max(0, lanes.indexOf(a.staff_id)) : 0; const ln = clash ? lanes.length : 1;
        col.append(h('div', { class: 'blk ' + a.status, role: 'button', tabindex: '0', style: `top:${top}px;height:${ht}px;--c:${D.stf.get(a.staff_id)?.color || '#c9a24a'};left:calc(${li * 100 / ln}% + 3px);right:auto;width:calc(${100 / ln}% - 6px)`, onclick: e => { e.stopPropagation(); openAppt(a); }, onkeydown: e => { if (e.key === 'Enter') openAppt(a); } },
          h('b', {}, firstName(c.full_name) + ' ' + (c.full_name.replace(/\(sample\)/, '').trim().split(' ')[1] || '').slice(0, 1)), h('span', {}, `${T.time(a.starts_at)} · ${svcName(a)}`)));
      });
      if (d === T.today() && nowMin >= lo && nowMin <= hi) col.append(h('div', { class: 'now', style: `top:${(nowMin - lo) * ppm}px` }));
      col.addEventListener('click', e => {
        if (e.target !== col && !e.target.classList.contains('open') && !e.target.classList.contains('hr')) return;
        const y = e.clientY - col.getBoundingClientRect().top; const iv = S().slot_interval_min || 40;
        const m = lo + Math.floor(y / ppm / iv) * iv; openNewBooking({ day: d, time: T.hm(m), staffId: staffShown.length === 1 ? staffShown[0].id : undefined });
      });
      grid.append(col);
    });

    return [
      h('div', { class: 'cal-bar' },
        h('h2', {}, label),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous', onclick: () => shift(-1) }, icon('left')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { UI.calAnchor = T.today(); render(); } }, 'Today'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next', onclick: () => shift(1) }, icon('right')),
        isAdmin() && D.staff.filter(s => s.active).length > 1 ? h('div', { class: 'chips' }, [['all', 'Everyone'], ...D.staff.filter(s => s.active).map(s => [s.id, firstName(s.display_name)])].map(([id, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(UI.calStaff === id), onclick: () => { UI.calStaff = id; render(); } }, l))) : null,
        h('button', { class: 'btn sm', type: 'button', onclick: () => openTimeOff() }, icon('clock'), 'Block time')),
      h('div', { class: 'cal' }, h('div', { class: 'cal-scroll' }, grid)),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--open);border:1px solid var(--line)' }), 'Open hours'), h('span', {}, h('i', { style: 'background:var(--closed)' }), 'Closed'), h('span', {}, h('i', { style: 'background:var(--info-soft)' }), 'Booked'), h('span', {}, h('i', { style: 'background:var(--good-soft)' }), 'Confirmed'), h('span', {}, h('i', { style: 'background:var(--bad-soft)' }), 'No-show'), h('span', {}, 'Click an open spot to book')),
    ];
  }
  const toMin = t => { const [a, b] = String(t).split(':').map(Number); return a * 60 + (b || 0); };

  function openTimeOff(o) {
    const staffChoices = isAdmin() ? D.staff.filter(s => s.active) : D.staff.filter(s => s.id === ME.staff_id);
    const sSel = h('select', { id: 'toStaff' }, staffChoices.map(s => h('option', { value: s.id, selected: o ? s.id === o.staff_id : null }, s.display_name)));
    const d1 = h('input', { id: 'toD1', type: 'date', value: o ? T.day(o.starts_at) : T.today() });
    const t1 = h('input', { id: 'toT1', type: 'time', value: o ? T.hm(T.minutes(o.starts_at)) : '' });
    const d2 = h('input', { id: 'toD2', type: 'date', value: o ? T.day(new Date(+new Date(o.ends_at) - 1)) : T.today() });
    const t2 = h('input', { id: 'toT2', type: 'time', value: o ? (T.minutes(o.ends_at) ? T.hm(T.minutes(o.ends_at)) : '') : '' });
    const rs = h('input', { id: 'toReason', placeholder: 'e.g. Class, vacation, lunch', value: o?.reason || '' });
    const save = h('button', { class: 'btn gold', type: 'button', onclick: async () => {
      const s = T.zoned(d1.value, t1.value || '00:00'); const e = t2.value ? T.zoned(d2.value, t2.value) : T.zoned(T.addDays(d2.value, 1), '00:00');
      if (e <= s) { toast('The end has to be after the start.'); return; }
      const row = { staff_id: sSel.value, starts_at: s.toISOString(), ends_at: e.toISOString(), reason: rs.value };
      await run(() => o ? LC.update('time_off', o.id, row) : LC.insert('time_off', row), 'Time blocked'); modalEl.close(); refresh(['time_off']);
    } }, o ? 'Save' : 'Block this time');
    modal(o ? 'Time off' : 'Block time', [h('p', { class: 'hint' }, 'Blocked time can\'t be booked online. Leave the times empty to block whole days.'), field('Barber', sSel), h('div', { class: 'row' }, field('From day', d1), field('From time', t1)), h('div', { class: 'row' }, field('To day', d2), field('To time', t2)), field('Reason', rs),
      h('div', { class: 'row' }, save, o ? armBtn('Remove', async () => { await run(() => LC.remove('time_off', o.id), 'Removed'); modalEl.close(); refresh(['time_off']); }, 'btn danger') : null)]);
  }

  // ===================================================================
  //  CLIENTS
  // ===================================================================
  function viewClients() {
    const now = Date.now(); const q = UI.clientQ.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    const rows = D.clients.map(c => ({ c, s: D.stats.get(c.id) }));
    const F = {
      all: () => true,
      new: r => r.s.visits <= 1 && +new Date(r.c.created_at) > now - 45 * 864e5,
      regulars: r => r.s.visits >= 3,
      lapsed: r => r.s.last && !r.s.next && +new Date(r.s.last) < now - 42 * 864e5,
      noshows: r => r.s.noShows > 0,
      vip: r => (r.c.tags || []).some(t => /vip/i.test(t)),
    };
    const labels = { all: 'All', new: 'New', regulars: 'Regulars', lapsed: 'Haven\'t been back 6+ wks', noshows: 'No-shows', vip: 'VIP' };
    let list = rows.filter(F[UI.clientFilter]).filter(r => !q || r.c.full_name.toLowerCase().includes(q) || (qd.length >= 3 && (r.c.phone || '').includes(qd)) || (r.c.email || '').includes(q));
    const sorts = { last: (a, b) => (b.s.last || '').localeCompare(a.s.last || ''), name: (a, b) => a.c.full_name.localeCompare(b.c.full_name), visits: (a, b) => b.s.visits - a.s.visits, spend: (a, b) => b.s.spend - a.s.spend };
    list.sort(sorts[UI.clientSort] || sorts.last);
    const search = h('input', { class: 'inp', id: 'clSearch', type: 'search', placeholder: 'Search name, phone or email', value: UI.clientQ, style: 'max-width:320px', oninput: e => { UI.clientQ = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#clSearch'); n.focus(); try { n.setSelectionRange(pos, pos); } catch { } } });
    const th = (k, l, cls) => h('th', { class: cls, style: sorts[k] ? 'cursor:pointer' : null, onclick: sorts[k] ? () => { UI.clientSort = k; render(); } : null }, l + (UI.clientSort === k ? ' ↓' : ''));
    return [
      h('div', { class: 'row between', style: 'margin-bottom:12px' }, search,
        h('div', { class: 'row' }, isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: () => csv('lopezcuts-clients.csv', [['Name', 'Phone', 'Email', 'Visits', 'Last visit', 'No-shows', 'Spent', 'Tags', 'Notes'], ...list.map(r => [r.c.full_name, fmtPhone(r.c.phone), r.c.email, r.s.visits, r.s.last ? T.day(r.s.last) : '', r.s.noShows, r.s.spend, (r.c.tags || []).join(' '), r.c.notes])]) }, icon('down'), 'Export') : null,
          isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: openImport }, icon('up'), 'Import from Booksy') : null,
          h('button', { class: 'btn gold', type: 'button', onclick: () => openClientForm() }, icon('plus'), 'Add client'))),
      h('div', { class: 'chips', style: 'margin-bottom:14px' }, Object.keys(F).map(k => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(UI.clientFilter === k), onclick: () => { UI.clientFilter = k; render(); } }, labels[k], h('span', { class: 'ct' }, rows.filter(F[k]).length)))),
      list.length ? h('div', { class: 'tbl-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, th('name', 'Client'), th('visits', 'Visits', 'r'), th('last', 'Last visit'), h('th', {}, 'Next'), h('th', { class: 'r' }, 'No-shows'), isAdmin() ? th('spend', 'Spent', 'r') : null, h('th', {}, 'Due back'))),
        h('tbody', {}, list.slice(0, 300).map(({ c, s }) => h('tr', { class: 'click', tabindex: '0', onclick: () => openClient(c.id), onkeydown: e => { if (e.key === 'Enter') openClient(c.id); } },
          h('td', {}, h('div', { class: 'client-cell' }, h('span', { class: 'avatar' }, initials(c.full_name)), h('div', {}, h('b', {}, c.full_name), ' ', (c.tags || []).map(t => h('span', { class: 'pill plain', style: 'margin-left:4px' }, t)), c.blocked ? h('span', { class: 'pill no_show plain' }, 'Blocked') : null, h('div', { class: 'small muted num' }, fmtPhone(c.phone))))),
          h('td', { class: 'r num' }, s.visits),
          h('td', { class: 'num' }, s.last ? T.date(s.last, { month: 'short', day: 'numeric', year: '2-digit' }) : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'num' }, s.next ? T.date(s.next, { month: 'short', day: 'numeric' }) : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'r num' }, s.noShows ? h('span', { class: 'pill no_show plain' }, s.noShows) : '0'),
          isAdmin() ? h('td', { class: 'r num' }, money(s.spend)) : null,
          h('td', { class: 'num' }, s.next ? h('span', { class: 'pill confirmed plain' }, 'Booked') : s.dueBack ? (+new Date(s.dueBack) < now ? h('span', { class: 'pill warn plain' }, 'Overdue') : T.date(s.dueBack, { month: 'short', day: 'numeric' })) : h('span', { class: 'muted' }, '—'))))))) : h('div', { class: 'empty' }, q ? `No clients match "${UI.clientQ}".` : 'No clients here yet.'),
      list.length > 300 ? h('p', { class: 'hint', style: 'margin-top:8px' }, `Showing 300 of ${list.length}. Search to narrow it down.`) : null,
    ];
  }
  function openClientForm(c) {
    const nm = h('input', { id: 'cfName', value: c?.full_name || '' });
    const ph = h('input', { id: 'cfPhone', type: 'tel', value: c ? fmtPhone(c.phone) : '' });
    const em = h('input', { id: 'cfEmail', type: 'email', value: c?.email || '' });
    const bd = h('input', { id: 'cfBday', type: 'date', value: c?.birthday || '' });
    const tg = h('input', { id: 'cfTags', placeholder: 'VIP, Curly, Student', value: (c?.tags || []).join(', ') });
    const mk = h('input', { type: 'checkbox', id: 'cfMkt', checked: c?.marketing_opt_in });
    const bl = h('input', { type: 'checkbox', id: 'cfBlock', checked: c?.blocked });
    const pv = h('input', { id: 'cfPrior', type: 'number', min: '0', step: '1', value: String(c?.prior_visits || 0) });
    const pl = h('input', { id: 'cfPriorLast', type: 'date', value: c?.prior_last_visit || '' });
    const err = h('div');
    modal(c ? 'Edit client' : 'Add client', [field('Name', nm), h('div', { class: 'row' }, field('Phone', ph), field('Email', em)), h('div', { class: 'row' }, field('Birthday', bd), field('Tags', tg, 'Separate with commas')),
      h('div', { class: 'row' }, field('Visits on Booksy', pv, 'Added to their visit count'), field('Last Booksy visit', pl)),
      h('label', { class: 'toggle' }, mk, 'OK to text about openings and promos'), h('label', { class: 'toggle' }, bl, 'Block online booking for this client'), err,
      h('button', { class: 'btn gold block', type: 'button', onclick: async () => {
        if (!nm.value.trim()) { err.replaceChildren(h('div', { class: 'err' }, 'Enter a name.')); return; }
        const phone = ph.value.trim() ? normPhone(ph.value) : null; if (ph.value.trim() && !phone) { err.replaceChildren(h('div', { class: 'err' }, 'That phone number doesn\'t look right.')); return; }
        const row = { full_name: nm.value.trim(), phone, email: em.value.trim().toLowerCase() || null, birthday: bd.value || null, tags: tg.value.split(',').map(x => x.trim()).filter(Boolean), marketing_opt_in: mk.checked, blocked: bl.checked, prior_visits: Math.max(0, parseInt(pv.value, 10) || 0), prior_last_visit: pl.value || null };
        try { const r = c ? await LC.update('clients', c.id, row) : await LC.insert('clients', { ...row, source: 'manual' }); modalEl.close(); toast(c ? 'Saved' : 'Client added'); await refresh(['clients']); openClient((r || c).id); }
        catch (e) { err.replaceChildren(h('div', { class: 'err' }, /duplicate|unique/i.test(e.message) ? 'A client with that phone number already exists.' : e.message)); }
      } }, c ? 'Save' : 'Add client')]);
  }
  // ---------------- Import clients (Booksy export or any spreadsheet saved as CSV)
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  function toISODate(v) {
    v = String(v || '').trim(); if (!v) return null;
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
    const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  function mapClientRows(rows) {
    const head = rows[0].map(x => x.trim().toLowerCase());
    const col = (...res) => head.findIndex(hd => res.some(re => re.test(hd)));
    const ix = {
      name: col(/^(client |customer )?(full )?name$/, /^client$/, /^customer$/), first: col(/first/), last: col(/^last ?name|surname/),
      phone: col(/phone|mobile|cell/), email: col(/e-?mail/), visits: col(/visits|appointments|bookings|^no\.? of/),
      lastVisit: col(/last (visit|appointment|booking)|last seen|recent/), birthday: col(/birth/), notes: col(/note/), tags: col(/tag|group/),
    };
    const get = (r, k) => ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '';
    return { ix, people: rows.slice(1).map(r => {
      const full = get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ');
      return { full_name: full.replace(/\s+/g, ' ').slice(0, 120), phone: normPhone(get(r, 'phone')), email: get(r, 'email').toLowerCase() || null,
        prior_visits: Math.max(0, parseInt(get(r, 'visits').replace(/\D/g, ''), 10) || 0), prior_last_visit: toISODate(get(r, 'lastVisit')),
        birthday: toISODate(get(r, 'birthday')), notes: get(r, 'notes'), tags: get(r, 'tags') ? get(r, 'tags').split(/[,;|]/).map(x => x.trim()).filter(Boolean) : [] };
    }).filter(p => p.full_name) };
  }
  function openImport() {
    const out = h('div', { class: 'stack' });
    const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      if (/\.xlsx?$/i.test(f.name)) { out.replaceChildren(h('div', { class: 'err' }, 'That is an Excel file. Open it in Excel or Google Sheets, choose File → Download (or Save As) → CSV, then pick the CSV here.')); return; }
      const rows = parseCSV(await f.text()); if (rows.length < 2) { out.replaceChildren(h('div', { class: 'err' }, 'No rows found in that file.')); return; }
      const { ix, people } = mapClientRows(rows);
      if (ix.name < 0 && ix.first < 0) { out.replaceChildren(h('div', { class: 'err' }, 'Couldn\'t find a Name column. The first row should have column names like Name, Phone, Email, Visits, Last visit.')); return; }
      const byPhone = new Map(D.clients.filter(c => c.phone).map(c => [c.phone, c]));
      const byName = new Map(D.clients.filter(c => !c.phone).map(c => [c.full_name.toLowerCase(), c]));
      const seen = new Set(); const add = [], upd = [];
      people.forEach(p => {
        const key = p.phone || 'n:' + p.full_name.toLowerCase(); if (seen.has(key)) return; seen.add(key);
        const ex = p.phone ? byPhone.get(p.phone) : byName.get(p.full_name.toLowerCase());
        if (ex) upd.push([ex, p]); else add.push(p);
      });
      const found = ['phone', 'email', 'visits', 'lastVisit', 'birthday', 'notes'].filter(k => ix[k] >= 0).map(k => ({ phone: 'phone', email: 'email', visits: 'visit count', lastVisit: 'last visit', birthday: 'birthday', notes: 'notes' })[k]);
      out.replaceChildren(
        h('div', { class: 'alert info' }, icon('users'), h('span', {}, `${add.length} new client${add.length === 1 ? '' : 's'} to add, ${upd.length} already here (their Booksy visits and last visit will be updated). Columns found: name${found.length ? ', ' + found.join(', ') : ''}.`)),
        h('div', { class: 'tbl-wrap', style: 'max-height:260px;overflow:auto' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Phone'), h('th', { class: 'r' }, 'Visits'), h('th', {}, 'Last visit'))),
          h('tbody', {}, [...add, ...upd.map(u => u[1])].slice(0, 50).map(p => h('tr', {}, h('td', {}, p.full_name), h('td', { class: 'num' }, fmtPhone(p.phone) || '—'), h('td', { class: 'r num' }, p.prior_visits), h('td', { class: 'num' }, p.prior_last_visit || '—')))))),
        h('button', { class: 'btn gold block', type: 'button', onclick: async e => {
          e.target.disabled = true; e.target.textContent = 'Importing…';
          try {
            if (add.length) await LC.insertMany('clients', add.map(p => ({ ...p, source: 'booksy' })));
            for (const [c, p] of upd) await LC.update('clients', c.id, { prior_visits: p.prior_visits, prior_last_visit: p.prior_last_visit || c.prior_last_visit || null, email: c.email || p.email, birthday: c.birthday || p.birthday });
            modalEl.close(); toast(`Imported ${add.length} new and updated ${upd.length} clients`); refresh(['clients']);
          } catch (err) { e.target.disabled = false; e.target.textContent = 'Try again'; out.append(h('div', { class: 'err' }, err.message)); }
        } }, `Import ${add.length + upd.length} clients`));
    } });
    modal('Import clients', [
      h('p', { class: 'hint' }, 'Pick a CSV file of your clients. On Booksy, export your client list from the Clients section of Booksy Biz on a computer. The file needs a Name column; Phone, Email, number of visits, last visit, birthday and notes are picked up too. Clients already here (same phone) are updated, not doubled.'),
      h('label', { class: 'btn upload' }, icon('up'), 'Choose file', file), out], { wide: true });
  }
  function openClient(id) {
    const c = D.client.get(id); if (!c) return; const s = D.stats.get(id); const now = Date.now();
    const notes = D.client_notes.filter(n => n.client_id === id);
    const std = h('textarea', { id: 'clStd', placeholder: 'Guard sizes, how they like it, allergies…' }, c.notes || '');
    const newNote = h('input', { id: 'clNote', placeholder: 'Add a dated note' });
    const sms = smsHref(c.phone);
    const avgTip = s.visits ? s.tips / s.visits : 0;
    drawer('Client', [
      h('div', { class: 'client-head' }, h('span', { class: 'avatar' }, initials(c.full_name)), h('div', {}, h('div', { class: 'nm' }, c.full_name), h('div', { class: 'small muted' }, `Client since ${T.date(c.created_at, { month: 'short', year: 'numeric' })} · ${c.source === 'online' ? 'booked online' : c.source}`), h('div', { class: 'chips', style: 'margin-top:6px' }, (c.tags || []).map(t => h('span', { class: 'pill plain' }, t)), c.blocked ? h('span', { class: 'pill no_show plain' }, 'Online booking blocked') : null, c.marketing_opt_in ? h('span', { class: 'pill confirmed plain' }, 'OK to text promos') : null))),
      h('div', { class: 'stat-row' }, h('div', {}, h('b', {}, s.visits), h('span', {}, 'Visits')), h('div', {}, h('b', {}, s.noShows), h('span', {}, 'No-shows')), isAdmin() ? h('div', {}, h('b', {}, money(s.spend)), h('span', {}, 'Spent')) : h('div', {}, h('b', {}, s.cancels), h('span', {}, 'Cancels')), isAdmin() ? h('div', {}, h('b', {}, money(avgTip)), h('span', {}, 'Avg tip')) : h('div', {}, h('b', {}, s.avgGap ? Math.round(s.avgGap) + 'd' : '—'), h('span', {}, 'Between visits'))),
      s.dueBack && !s.next ? h('div', { class: 'alert ' + (+new Date(s.dueBack) < now ? 'warn' : 'info') }, icon('clock'), h('span', {}, `Comes about every ${Math.round(s.avgGap)} days. Due back around ${T.date(s.dueBack)}.`), sms ? h('a', { class: 'btn sm', href: smsHref(c.phone, `Hey ${firstName(c.full_name)}! Ready for your next cut? Book here: ${siteBase()}`) }, 'Text') : null) : null,
      s.next ? h('div', { class: 'alert good' }, icon('cal'), `Next visit ${T.date(s.next)} at ${T.time(s.next)}`) : null,
      h('div', { class: 'row' }, sms ? h('a', { class: 'btn sm', href: sms }, icon('msg'), 'Text') : null, c.phone ? h('button', { class: 'btn sm', type: 'button', onclick: () => copy(fmtPhone(c.phone)) }, icon('copy'), fmtPhone(c.phone)) : null, c.email ? h('a', { class: 'btn sm', href: 'mailto:' + c.email }, c.email) : null,
        h('button', { class: 'btn sm gold', type: 'button', onclick: () => { drawerEl.close(); openNewBooking({ clientId: id }); } }, icon('plus'), 'Book'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openClientForm(c) }, 'Edit')),
      c.birthday ? h('p', { class: 'small muted' }, '🎂 Birthday ' + T.dayLabel(c.birthday, { month: 'long', day: 'numeric' })) : null,
      field('Standing notes', std, 'Shows on every appointment card'),
      h('button', { class: 'btn sm', type: 'button', style: 'justify-self:start', onclick: async () => { await run(() => LC.update('clients', id, { notes: std.value }), 'Saved'); refresh(['clients']); } }, 'Save notes'),
      h('div', { class: 'f' }, 'Notes history', h('div', { class: 'row' }, newNote, h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (!newNote.value.trim()) return; await run(() => LC.insert('client_notes', { client_id: id, body: newNote.value.trim() }), 'Note added'); await refresh(['client_notes']); openClient(id); } }, 'Add')),
        notes.length ? h('div', { class: 'list' }, notes.map(n => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { style: 'font-weight:500;color:var(--ink)' }, n.body), h('div', { class: 's' }, `${T.date(n.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}${D.prof.get(n.author_id) ? ' · ' + (D.prof.get(n.author_id).full_name || D.prof.get(n.author_id).email) : ''}`))))) : null),
      c.prior_visits ? h('div', { class: 'alert info' }, icon('clock'), `${c.prior_visits} earlier visit${c.prior_visits === 1 ? '' : 's'} on Booksy${c.prior_last_visit ? ', last one ' + T.date(c.prior_last_visit + 'T18:00:00Z') : ''}. Counted in their total.`) : null,
      h('div', { class: 'f' }, `History (${s.appts.length})`, s.appts.length ? h('div', { class: 'list history' }, s.appts.slice(0, 40).map(a => h('div', { class: 'li', onclick: () => openAppt(a) }, h('div', { class: 'main' }, h('div', { class: 't' }, `${T.date(a.starts_at, { month: 'short', day: 'numeric', year: 'numeric' })} · ${T.time(a.starts_at)}`), h('div', { class: 's' }, svcName(a) + (D.staff.length > 1 ? ' · ' + staffName(a.staff_id) : ''))), pill(a.status), h('span', { class: 'num' }, money(isAdmin() && D.payByAppt.get(a.id) ? +D.payByAppt.get(a.id).amount + +D.payByAppt.get(a.id).tip : a.price))))) : h('div', { class: 'empty' }, 'No visits yet.')),
      isOwner() ? armBtn('Delete client and their history', async () => { await run(() => LC.remove('clients', id), 'Client deleted'); drawerEl.close(); refresh(['clients', 'appointments', 'client_notes']); }, 'btn sm danger') : null,
    ]);
  }

  // ===================================================================
  //  MONEY (owner + manager)
  // ===================================================================
  function moneyRange(k) {
    const today = T.today(); const y = +today.slice(0, 4), m = +today.slice(5, 7);
    const ym = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
    const mStart = (yy, mm) => ym(yy, mm) + '-01';
    const prevM = m === 1 ? [y - 1, 12] : [y, m - 1];
    if (k === 'month') return { from: mStart(y, m), to: today, prevFrom: mStart(...prevM), prevTo: T.addDays(mStart(...prevM), +today.slice(8) - 1), label: 'This month', vs: 'same days last month' };
    if (k === 'last') { const pp = prevM[1] === 1 ? [prevM[0] - 1, 12] : [prevM[0], prevM[1] - 1]; return { from: mStart(...prevM), to: T.addDays(mStart(y, m), -1), prevFrom: mStart(...pp), prevTo: T.addDays(mStart(...prevM), -1), label: 'Last month', vs: 'the month before' }; }
    if (k === '90') return { from: T.addDays(today, -89), to: today, prevFrom: T.addDays(today, -179), prevTo: T.addDays(today, -90), label: 'Last 90 days', vs: 'the 90 days before' };
    return { from: `${y}-01-01`, to: today, prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}${today.slice(4)}`, label: 'This year', vs: 'same period last year' };
  }
  function viewMoney() {
    const R = moneyRange(UI.moneyRange);
    const inR = (d, a, b) => d >= a && d <= b;
    const pays = D.payments.filter(p => inR(T.day(p.paid_at), R.from, R.to)), prevPays = D.payments.filter(p => inR(T.day(p.paid_at), R.prevFrom, R.prevTo));
    const exps = D.expenses.filter(x => inR(x.spent_on, R.from, R.to)), prevExps = D.expenses.filter(x => inR(x.spent_on, R.prevFrom, R.prevTo));
    const rev = sum(pays, p => p.amount), tips = sum(pays, p => p.tip), ex = sum(exps, x => x.amount), prof = rev + tips - ex;
    const pRev = sum(prevPays, p => p.amount), pTips = sum(prevPays, p => p.tip), pEx = sum(prevExps, x => x.amount);
    const delta = (cur, prev, invert) => { if (!prev) return h('span', { class: 'muted' }, 'no data before'); const d = Math.round(100 * (cur - prev) / prev); const good = invert ? d <= 0 : d >= 0; return h('span', {}, h('span', { class: 'delta ' + (good ? 'up' : 'down') }, (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d) + '%'), ' vs ' + R.vs); };
    const cuts = pays.length; const avg = cuts ? (rev + tips) / cuts : 0;

    // 8-week chart
    const ws = weekStart(T.today()); const weeks = Array.from({ length: 8 }, (_, i) => T.addDays(ws, (i - 7) * 7));
    const inc = weeks.map(w => sum(D.payments.filter(p => inR(T.day(p.paid_at), w, T.addDays(w, 6))), p => +p.amount + +p.tip));
    const out = weeks.map(w => sum(D.expenses.filter(x => inR(x.spent_on, w, T.addDays(w, 6))), x => x.amount));
    const chart = barChart(weeks.map(w => T.dayLabel(w, { month: 'short', day: 'numeric' })), inc, out);

    const byMethod = {}; pays.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + +p.amount + +p.tip; });
    const mMax = Math.max(1, ...Object.values(byMethod));
    const mLabel = { cash: 'Cash', venmo: 'Venmo', zelle: 'Zelle', cashapp: 'Cash App', apple_pay: 'Apple Pay', card: 'Card', other: 'Other' };
    const apptOf = new Map(D.appointments.map(a => [a.id, a]));
    const newRev = sum(pays.filter(p => apptOf.get(p.appointment_id)?.new_client), p => p.amount);
    const addonRev = sum(pays, p => { const a = apptOf.get(p.appointment_id); return a ? sum((a.addon_ids || []).map(id => D.svc.get(id)).filter(Boolean), s => s.price) : 0; });

    // budgets this month
    const mk = T.today().slice(0, 7); const spentM = {}; D.expenses.filter(x => x.spent_on.slice(0, 7) === mk).forEach(x => { spentM[x.category] = (spentM[x.category] || 0) + +x.amount; });
    const cats = [...new Set([...D.budgets.map(b => b.category), ...Object.keys(spentM)])];

    const eDesc = h('input', { id: 'exDesc', placeholder: 'New clipper blades' });
    const eCat = h('select', { id: 'exCat' }, cats.map(c => h('option', {}, c)));
    const eAmt = h('input', { id: 'exAmt', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', placeholder: '$' });
    const eDate = h('input', { id: 'exDate', type: 'date', value: T.today() });

    return [
      h('div', { class: 'row between', style: 'margin-bottom:14px' }, h('div', { class: 'chips' }, [['month', 'This month'], ['last', 'Last month'], ['90', '90 days'], ['year', 'This year']].map(([k, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(UI.moneyRange === k), onclick: () => { UI.moneyRange = k; render(); } }, l))),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => csv(`lopezcuts-payments-${R.from}-to-${R.to}.csv`, [['Date', 'Client', 'Service', 'Amount', 'Tip', 'Method', 'Note'], ...pays.map(p => { const a = apptOf.get(p.appointment_id); return [T.day(p.paid_at), client(p.client_id).full_name, a ? svcName(a) : '', p.amount, p.tip, p.method, p.note]; })]) }, icon('down'), 'Payments CSV'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => csv(`lopezcuts-expenses-${R.from}-to-${R.to}.csv`, [['Date', 'Description', 'Category', 'Amount'], ...exps.map(x => [x.spent_on, x.description, x.category, x.amount])]) }, icon('down'), 'Expenses CSV'))),
      h('div', { class: 'kpis' },
        kpi('Profit · ' + R.label, money(prof), delta(prof, pRev + pTips - pEx), 'hero'),
        kpi('Service income', money(rev), delta(rev, pRev)),
        kpi('Tips', money(tips), delta(tips, pTips)),
        kpi('Expenses', money(ex), delta(ex, pEx, true))),
      h('div', { class: 'grid2' },
        h('div', { class: 'section-gap' },
          h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, 'Income vs. expenses'), h('div', { class: 'sub' }, 'Last 8 weeks. Income includes tips.'))), chart, h('div', { class: 'chart-legend' }, h('span', {}, h('i', { style: 'background:#c9a24a' }), 'Income'), h('span', {}, h('i', { style: 'background:var(--muted)' }), 'Expenses'))),
          h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Payments'), h('span', { class: 'sub' }, `${cuts} in ${R.label.toLowerCase()} · ${money(avg)} average`)),
            pays.length ? h('div', { class: 'list' }, pays.slice(0, 25).map(p => { const a = apptOf.get(p.appointment_id); return h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { class: 't' }, client(p.client_id).full_name), h('div', { class: 's' }, `${T.date(p.paid_at)} · ${a ? svcName(a) : 'Payment'} · ${mLabel[p.method] || p.method}`)), h('div', { class: 'num', style: 'text-align:right' }, h('b', {}, money(p.amount)), +p.tip ? h('div', { class: 's' }, '+' + money(p.tip) + ' tip') : null), a ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openAppt(a) }, icon('right')) : null); })) : h('div', { class: 'empty' }, 'No payments in this range yet. They appear when you check out a visit.'))),
        h('div', { class: 'section-gap' },
          h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Where it comes from')),
            h('div', { class: 'stack' }, Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'hbar' }, h('span', {}, mLabel[k] || k), h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${100 * v / mMax}%` })), h('span', { class: 'num', style: 'text-align:right' }, money(v)))),
              !pays.length ? h('div', { class: 'empty' }, 'No payments yet.') : null,
              h('dl', { class: 'dl', style: 'margin-top:6px' }, h('dt', {}, 'New clients'), h('dd', { class: 'num' }, money(newRev)), h('dt', {}, 'Add-ons'), h('dd', { class: 'num' }, money(addonRev)), h('dt', {}, 'Avg per visit'), h('dd', { class: 'num' }, money(avg))))),
          h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Budget'), h('span', { class: 'sub' }, T.dayLabel(mk + '-15', { month: 'long' }))),
            h('div', { class: 'stack' }, cats.map(c => { const b = D.budgets.find(x => x.category === c); const lim = +(b?.monthly_limit || 0), s = spentM[c] || 0;
              const inp = h('input', { class: 'inp', type: 'number', min: '0', step: '5', value: String(lim), 'aria-label': c + ' monthly limit', style: 'width:84px', onchange: async e => { await run(() => LC.upsert('budgets', { category: c, monthly_limit: +e.target.value || 0 }, 'category'), 'Budget saved'); refresh(['budgets']); } });
              return h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'row between' }, h('span', {}, c), h('span', { class: 'row', style: 'gap:6px' }, h('span', { class: 'num small' }, money(s) + ' of'), inp)), h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill' + (lim && s > lim ? ' over' : ''), style: `width:${lim ? Math.min(100, 100 * s / lim) : (s ? 100 : 0)}%` })));
            }),
            h('div', { class: 'row' }, h('input', { class: 'inp', id: 'newCat', placeholder: 'New category', style: 'flex:1' }), h('button', { class: 'btn sm', type: 'button', onclick: async () => { const v = $('#newCat').value.trim(); if (!v) return; await run(() => LC.upsert('budgets', { category: v, monthly_limit: 0 }, 'category'), 'Category added'); refresh(['budgets']); } }, 'Add')))),
          h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Log an expense')),
            h('form', { class: 'stack', onsubmit: async e => { e.preventDefault(); if (!eDesc.value.trim() || !(+eAmt.value > 0)) { toast('Add a description and amount'); return; } await run(() => LC.insert('expenses', { description: eDesc.value.trim(), category: eCat.value, amount: +eAmt.value, spent_on: eDate.value || T.today() }), 'Expense added'); refresh(['expenses']); } },
              field('What was it?', eDesc), h('div', { class: 'row' }, field('Category', eCat), field('Amount', eAmt)), field('Date', eDate), h('button', { class: 'btn dark', type: 'submit' }, 'Add expense')),
            h('div', { class: 'list', style: 'margin-top:10px' }, exps.slice(0, 15).map(x => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { class: 't' }, x.description), h('div', { class: 's' }, `${T.dayLabel(x.spent_on)} · ${x.category}`)), h('b', { class: 'num' }, money(x.amount, true)), armBtn('✕', async () => { await run(() => LC.remove('expenses', x.id), 'Deleted'); refresh(['expenses']); }, 'btn sm ghost danger', 'Delete?')))))))];
  }
  function barChart(labels, a, b) {
    const W = 640, H = 240, pl = 44, pb = 26, pt = 10, pr = 8; const max = Math.max(10, ...a, ...b); const step = niceStep(max / 4); const top = Math.ceil(max / step) * step;
    const s = document.createElementNS(svgNS, 'svg'); s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('class', 'chart'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'Weekly income and expenses for the last 8 weeks');
    const y = v => pt + (H - pt - pb) * (1 - v / top); const bw = (W - pl - pr) / labels.length;
    const g = document.createElementNS(svgNS, 'g'); g.setAttribute('class', 'grid');
    for (let v = 0; v <= top; v += step) { const ln = document.createElementNS(svgNS, 'line'); ln.setAttribute('x1', pl); ln.setAttribute('x2', W - pr); ln.setAttribute('y1', y(v)); ln.setAttribute('y2', y(v)); g.append(ln); const t = document.createElementNS(svgNS, 'text'); t.setAttribute('x', pl - 6); t.setAttribute('y', y(v) + 4); t.setAttribute('text-anchor', 'end'); t.textContent = '$' + v; g.append(t); }
    s.append(g);
    labels.forEach((l, i) => {
      const x0 = pl + i * bw; const w = Math.min(22, bw * 0.32);
      [[a[i], '#c9a24a', 0], [b[i], 'var(--muted)', 1]].forEach(([v, c, k]) => {
        const r = document.createElementNS(svgNS, 'rect'); const yy = y(v); r.setAttribute('x', x0 + bw / 2 - w - 2 + k * (w + 4)); r.setAttribute('width', w); r.setAttribute('y', yy); r.setAttribute('height', Math.max(0, H - pb - yy)); r.setAttribute('rx', 4); r.setAttribute('fill', c);
        r.style.transformOrigin = `0 ${H - pb}px`; r.style.animation = `grow .7s ${i * 40}ms cubic-bezier(.2,.7,.2,1) both`;
        const ti = document.createElementNS(svgNS, 'title'); ti.textContent = `${l}: ${k ? 'expenses' : 'income'} ${money(v)}`; r.append(ti); s.append(r);
      });
      const t = document.createElementNS(svgNS, 'text'); t.setAttribute('x', x0 + bw / 2); t.setAttribute('y', H - 8); t.setAttribute('text-anchor', 'middle'); t.textContent = l; s.append(t);
    });
    const st = document.createElementNS(svgNS, 'style'); st.textContent = '@keyframes grow{from{transform:scaleY(0)}}@media (prefers-reduced-motion: reduce){rect{animation:none!important}}'; s.append(st);
    return s;
  }
  const niceStep = r => { const p = Math.pow(10, Math.floor(Math.log10(r))); const n = r / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

  // ===================================================================
  //  REVIEWS
  // ===================================================================
  function viewReviews() {
    const s = S(); const pub = D.reviews.filter(r => r.status === 'published'); const site = pub.filter(r => r.source === 'site');
    const bc = +s.booksy_review_count || 0; const count = bc + site.length;
    const avg = count ? ((+s.booksy_rating || 5) * bc + sum(site, r => r.rating)) / count : 0;
    const groups = { pending: D.reviews.filter(r => r.status === 'pending'), published: pub, hidden: D.reviews.filter(r => r.status === 'hidden') };
    const list = groups[UI.revFilter] || [];
    const card = r => {
      const reply = h('input', { class: 'inp', placeholder: 'Reply publicly (optional)', value: r.reply || '', 'aria-label': 'Reply' });
      return h('div', { class: 'rev' }, h('div', { class: 'row between' }, h('span', { class: 'stars' }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)), h('span', { class: 'pill plain' }, r.source === 'booksy' ? 'Booksy' : 'Lopezcuts')),
        h('q', {}, r.body || '(no text)'), h('div', { class: 'small muted' }, `${r.display_name} · ${r.label || 'Client'} · ${T.date(r.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}`),
        isAdmin() ? [reply, h('div', { class: 'row' },
          r.status !== 'published' ? h('button', { class: 'btn sm gold', type: 'button', onclick: async () => { await run(() => LC.update('reviews', r.id, { status: 'published', reply: reply.value }), 'Published on the site'); refresh(['reviews']); } }, icon('check'), 'Publish') : h('button', { class: 'btn sm', type: 'button', onclick: async () => { await run(() => LC.update('reviews', r.id, { reply: reply.value }), 'Reply saved'); refresh(['reviews']); } }, 'Save reply'),
          r.status !== 'hidden' ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { await run(() => LC.update('reviews', r.id, { status: 'hidden' }), 'Hidden'); refresh(['reviews']); } }, 'Hide') : null,
          armBtn('Delete', async () => { await run(() => LC.remove('reviews', r.id), 'Deleted'); refresh(['reviews']); }))] : null);
    };
    const nm = h('input', { id: 'rvN', placeholder: 'Name as shown on Booksy' }); const lb = h('select', { id: 'rvL' }, h('option', {}, 'Returning Client'), h('option', {}, 'First Time Client'));
    const rt = h('select', { id: 'rvR' }, [5, 4, 3, 2, 1].map(n => h('option', { value: n }, n + ' stars'))); const tx = h('input', { id: 'rvT', placeholder: 'Copy the review word for word' });
    return [
      h('div', { class: 'grid2', style: 'margin-bottom:18px' },
        h('section', { class: 'card' }, h('div', { class: 'big-rating' }, h('span', { class: 'n' }, avg.toFixed(1)), h('div', {}, h('div', { class: 'stars', style: 'color:var(--gold);letter-spacing:3px;font-size:1.2rem' }, '★★★★★'), h('div', { class: 'muted small' }, `${count} reviews: ${bc} on Booksy, ${site.length} on your site`))),
          h('p', { class: 'hint', style: 'margin-top:10px' }, 'Anyone can leave a review from the site. Ones marked Verified Client matched a phone number with a finished visit. New reviews wait here until you publish them.')),
        isAdmin() ? h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Add a Booksy review')),
          h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Name', nm), field('Type', lb), field('Rating', rt)), field('Review', tx),
            h('button', { class: 'btn dark', type: 'button', onclick: async () => { if (!nm.value.trim() || !tx.value.trim()) { toast('Add a name and the review text'); return; } await run(() => LC.insert('reviews', { rating: +rt.value, body: tx.value.trim(), display_name: nm.value.trim(), label: lb.value, source: 'booksy', status: 'published', reply: '' }), 'Added to the site'); refresh(['reviews']); } }, 'Add review'))) : null),
      h('div', { class: 'chips', style: 'margin-bottom:14px' }, Object.keys(groups).map(k => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(UI.revFilter === k), onclick: () => { UI.revFilter = k; render(); } }, { pending: 'Waiting for approval', published: 'On the site', hidden: 'Hidden' }[k], h('span', { class: 'ct' }, groups[k].length)))),
      list.length ? h('div', { class: 'rev-grid' }, list.map(card)) : h('div', { class: 'empty' }, UI.revFilter === 'pending' ? 'No reviews waiting. Nice.' : 'Nothing here.'),
    ];
  }

  // ===================================================================
  //  PORTFOLIO
  // ===================================================================
  function viewPortfolio() {
    const items = D.portfolio_items.slice().sort(by('sort'));
    const boxName = it => (it.category || it.title || 'Cuts').trim();
    const photos = items.filter(i => i.image_url), empties = items.filter(i => !i.image_url);
    const boxes = [...new Set(photos.map(boxName))];
    if (!UI.pfBox || (!boxes.includes(UI.pfBox) && !UI.pfCustom)) UI.pfBox = boxes[0] || 'Fresh cuts';
    const maxSort = () => Math.max(0, ...items.map(i => i.sort || 0));
    const pick = h('select', { class: 'inp', 'aria-label': 'Box to upload into', style: 'width:auto', onchange: e => { if (e.target.value === '__new') { const n = (prompt('Name the new box (for example "Fades" or "Curly")') || '').trim().slice(0, 40); if (n) { UI.pfBox = n; UI.pfCustom = true; } render(); } else { UI.pfBox = e.target.value; UI.pfCustom = false; } } },
      [...new Set([...boxes, UI.pfBox])].map(b => h('option', { value: b, selected: b === UI.pfBox }, b)), h('option', { value: '__new' }, '+ New box…'));
    const up = h('label', { class: 'btn gold upload' }, icon('plus'), 'Upload photos', h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, onchange: async e => {
      const files = [...e.target.files]; if (!files.length) return; let max = maxSort();
      for (const f of files) {
        try { toast(`Uploading ${f.name}…`); const url = await LC.upload(f); await LC.insert('portfolio_items', { title: UI.pfBox, category: UI.pfBox, description: '', image_url: url, published: true, sort: ++max }); }
        catch (err) { toast(err.message); }
      }
      toast(`Added to ${UI.pfBox}`); refresh(['portfolio_items']);
    } }));
    const makeCover = async it => { const box = photos.filter(p => boxName(p) === boxName(it)); const first = box[0]; if (first === it) return; await run(() => Promise.all([LC.update('portfolio_items', it.id, { sort: first.sort }), LC.update('portfolio_items', first.id, { sort: it.sort })]), 'Cover changed'); refresh(['portfolio_items']); };
    const moveBox = async (it, to) => { if (to === '__new') { to = (prompt('Name the new box') || '').trim().slice(0, 40); if (!to) return render(); } await run(() => LC.update('portfolio_items', it.id, { category: to, title: to }), `Moved to ${to}`); refresh(['portfolio_items']); };
    const card = (it, isCover) => h('div', { class: 'pf' },
      h('div', { class: 'img' }, h('img', { src: it.image_url, alt: boxName(it), loading: 'lazy' }), isCover ? h('span', { class: 'badge' }, '★ Cover') : (!it.published ? h('span', { class: 'badge' }, 'Hidden') : null)),
      h('div', { class: 'body' },
        h('select', { class: 'inp', 'aria-label': 'Box', onchange: e => moveBox(it, e.target.value) }, boxes.map(b => h('option', { value: b, selected: b === boxName(it) }, b)), h('option', { value: '__new' }, '+ New box…')),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: it.published, onchange: async e => { await run(() => LC.update('portfolio_items', it.id, { published: e.target.checked }), e.target.checked ? 'Showing on site' : 'Hidden from site'); refresh(['portfolio_items']); } }), 'Show on site'),
        h('div', { class: 'tools' }, isCover ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => makeCover(it) }, '★ Make cover'), armBtn('Delete', async () => { await run(() => LC.remove('portfolio_items', it.id), 'Deleted'); refresh(['portfolio_items']); }, 'btn sm danger', 'Sure?'))));
    const emptyCard = it => h('div', { class: 'pf' }, h('div', { class: 'img' }, h('span', { class: 'ph' }, it.title), h('span', { class: 'badge' }, it.published ? 'Placeholder' : 'Hidden')),
      h('div', { class: 'body' }, h('b', {}, it.title), h('div', { class: 'tools' }, armBtn('Delete', async () => { await run(() => LC.remove('portfolio_items', it.id), 'Deleted'); refresh(['portfolio_items']); }, 'btn sm danger', 'Sure?'))));
    return [
      h('div', { class: 'row between', style: 'margin-bottom:14px;gap:12px;flex-wrap:wrap' }, h('p', { class: 'hint', style: 'max-width:560px' }, 'Each box is one tile in "The Work" on your site. The ★ cover photo shows on the tile, and tapping it opens every photo in the box. Pick a box, then Upload photos to add to it.'), h('div', { class: 'row' }, pick, up)),
      photos.length ? h('div', {}, boxes.map(b => { const list = photos.filter(p => boxName(p) === b); return h('section', { style: 'margin-bottom:22px' }, h('h3', { style: 'margin:0 0 10px' }, `${b} `, h('span', { class: 'muted small' }, `${list.length} photo${list.length > 1 ? 's' : ''}`)), h('div', { class: 'pf-grid' }, list.map((it, i) => card(it, i === 0)))); })) : h('div', { class: 'empty' }, 'No photos yet. Pick or create a box, then tap Upload photos.'),
      empties.length ? h('details', { style: 'margin-top:10px' }, h('summary', { class: 'muted' }, `Old placeholder tiles (${empties.length})${photos.length ? ', not shown on the site' : ''}`), h('div', { class: 'pf-grid', style: 'margin-top:10px' }, empties.map(emptyCard))) : null,
    ];
  }

  // ===================================================================
  //  SUPPLIES
  // ===================================================================
  function viewSupplies() {
    const rows = D.inventory.slice().sort(by('name'));
    const edit = isAdmin();
    const num = (i, f) => edit ? h('input', { class: 'inp', type: 'number', min: '0', step: 'any', value: String(+(+i[f]).toFixed(2)), 'aria-label': f.replace('_', ' '), onchange: async e => { await run(() => LC.update('inventory', i.id, { [f]: +e.target.value || 0 }), 'Saved'); refresh(['inventory']); } }) : String(+(+i[f]).toFixed(2));
    const nm = h('input', { id: 'ivName', placeholder: 'Neck strips' }), un = h('input', { id: 'ivUnit', placeholder: 'strips' }), q = h('input', { id: 'ivQty', type: 'number', min: '0', step: 'any' }), pc = h('input', { id: 'ivPer', type: 'number', min: '0', step: 'any', value: '1' }), pa = h('input', { id: 'ivPerAdd', type: 'number', min: '0', step: 'any', value: '0' }), ro = h('input', { id: 'ivRe', type: 'number', min: '0', step: 'any' });
    return [
      h('p', { class: 'hint', style: 'margin-bottom:12px' }, 'Every checkout subtracts what one cut (and each add-on) uses. Anything at or below its reorder level shows up in Heads up on the Today page.'),
      h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'In stock'), h('th', {}, 'Per cut'), h('th', {}, 'Per add-on'), h('th', {}, 'Reorder at'), h('th', {}, 'Lasts about'), h('th', {}, 'Status'), edit ? h('th', {}) : null)),
        h('tbody', {}, rows.length ? rows.map(i => { const per = +i.per_cut || 0; const left = per ? Math.floor(+i.qty / per) : null; const low = +i.qty <= +i.reorder_at;
          return h('tr', {}, h('td', {}, h('b', {}, i.name), i.unit ? h('div', { class: 'small muted' }, i.unit) : null), h('td', {}, num(i, 'qty')), h('td', {}, num(i, 'per_cut')), h('td', {}, num(i, 'per_addon')), h('td', {}, num(i, 'reorder_at')), h('td', { class: 'num' }, left != null ? `${left} cuts` : '—'), h('td', {}, h('span', { class: 'pill ' + (low ? 'no_show' : 'confirmed') }, low ? 'Reorder' : 'OK')), edit ? h('td', {}, armBtn('✕', async () => { await run(() => LC.remove('inventory', i.id), 'Removed'); refresh(['inventory']); }, 'btn sm ghost danger', 'Delete?')) : null); })
          : [h('tr', {}, h('td', { colspan: '8' }, h('div', { class: 'empty' }, 'Add the supplies you go through, like neck strips, blades or product.')))]))),
      edit ? h('section', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-h' }, h('h2', {}, 'Add an item')),
        h('form', { class: 'row', style: 'align-items:end', onsubmit: async e => { e.preventDefault(); if (!nm.value.trim()) return; await run(() => LC.insert('inventory', { name: nm.value.trim(), unit: un.value.trim(), qty: +q.value || 0, per_cut: +pc.value || 0, per_addon: +pa.value || 0, reorder_at: +ro.value || 0 }), 'Item added'); refresh(['inventory']); } },
          field('Item', nm), field('Unit', un), field('In stock', q), field('Per cut', pc), field('Per add-on', pa), field('Reorder at', ro), h('button', { class: 'btn dark', type: 'submit' }, 'Add'))) : null,
    ];
  }

  // ===================================================================
  //  SETTINGS
  // ===================================================================
  function viewSettings() {
    const tabs = [
      isAdmin() && ['business', 'Business'], isAdmin() && ['services', 'Services & prices'], ['hours', 'Hours & time off'], isOwner() && ['team', 'Team & access'], ['security', 'My account'], isOwner() && ['activity', 'Activity log'],
    ].filter(Boolean);
    tabs.splice(isAdmin() ? 2 : 0, 0, ...(isAdmin() ? [['texts', 'Texts']] : []), ['notify', 'Notifications']);
    if (!tabs.some(t => t[0] === UI.setupTab)) UI.setupTab = tabs[0][0];
    const body = { business: setBusiness, texts: setTexts, notify: setNotify, services: setServices, hours: setHours, team: setTeam, security: setSecurity, activity: setActivity }[UI.setupTab]();
    return [h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(UI.setupTab === k), onclick: () => { UI.setupTab = k; render(); } }, l))), body].flat();
  }
  // Phone notifications (web push). Each phone turns them on for itself.
  function setNotify() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const device = () => ios ? (/iPad/.test(ua) || !/iPhone/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : 'device';
    const u8 = b64 => { const p = '='.repeat((4 - b64.length % 4) % 4), s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
    const status = h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Checking this phone…'));
    const devices = h('div', { class: 'stack' });
    const err = h('p', { class: 'hint', style: 'color:var(--danger, #b3261e)', hidden: true });
    const put = (...k) => { status.replaceChildren(...k.filter(Boolean)); status.append(err); };
    const reg = () => navigator.serviceWorker.register('/owner-sw.js', { scope: '/owner' });
    const mySub = async () => { if (!can) return null; const r = await navigator.serviceWorker.getRegistration('/owner'); return r ? r.pushManager.getSubscription() : null; };
    const rows = async () => { try { return await LC.list('push_subscriptions', { order: 'created_at' }); } catch { return []; } };

    async function turnOn(btn) {
      btn.disabled = true; err.hidden = true; let step = 'asking for permission';
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error(ios ? 'Allow notifications in iPhone Settings → Notifications → Lopezcuts.' : 'Notifications are blocked for this site. Click the icon left of the web address and allow Notifications.');
        step = 'starting the notification helper'; const r = await reg(); await navigator.serviceWorker.ready;
        step = 'reaching the notify-owner function'; const res = await LC.fn('notify-owner', { action: 'setup' });
        if (!res || !res.publicKey) throw new Error('notify-owner answered without a key: ' + JSON.stringify(res).slice(0, 120));
        step = 'subscribing this device'; let sub = await r.pushManager.getSubscription();
        if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(res.publicKey) });
        const j = sub.toJSON();
        step = 'saving this device'; await LC.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device: device() });
        toast('Notifications are on for this ' + device());
        LC.fn('notify-owner', { action: 'test' }).catch(() => { });
      } catch (e) { console.error(e); err.textContent = `Didn't work while ${step}: ${e.message || e}`; err.hidden = false; }
      finally { btn.disabled = false; await paint(); }
    }
    async function turnOff() {
      const sub = await mySub(); if (!sub) return;
      const ep = sub.endpoint; await sub.unsubscribe().catch(() => { });
      await run(() => LC.remove('push_subscriptions', ep, 'endpoint'), 'Notifications off for this ' + device()); paint();
    }
    async function paint() {
      const sub = await mySub().catch(() => null); const list = await rows();
      const mine = sub && list.find(r => r.endpoint === sub.endpoint);
      const tog = (row, key, label) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!row[key], onchange: async e => { await run(() => LC.update('push_subscriptions', row.id, { [key]: e.target.checked }), 'Saved'); } }), h('span', {}, label));
      if (LC.mode === 'demo') put(h('p', { class: 'hint' }, 'This is the preview. On the live owner app, this is where you turn on booking alerts for your phone.'));
      else if (ios && !installed) put(
        h('p', {}, h('b', {}, 'First, add this page to your Home Screen.'), ' iPhones only allow notifications from apps on the Home Screen.'),
        h('ol', { class: 'small', style: 'margin:0;padding-left:20px;line-height:1.7' }, h('li', {}, 'Open this page in Safari.'), h('li', {}, 'Tap the Share button (square with an arrow).'), h('li', {}, 'Tap Add to Home Screen, then Add.'), h('li', {}, 'Open Lopezcuts from your Home Screen, sign in, and come back here.')));
      else if (!can) put(h('p', { class: 'hint' }, 'This browser can\'t show notifications. On iPhone, update to iOS 16.4 or newer and use the Home Screen app.'));
      else if (mine && Notification.permission === 'granted') put(
        h('p', {}, h('span', { class: 'pill confirmed' }, 'On'), ` This ${device()} gets notifications.`),
        tog(mine, 'notify_bookings', 'Someone books online'), tog(mine, 'notify_cancels', 'A client cancels'),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => { const r = await run(() => LC.fn('notify-owner', { action: 'test' })); if (r) toast(r.sent ? 'Test sent. Check your phone.' : 'No phones got it. Try turning it off and on.'); } }, 'Send a test'),
          h('button', { class: 'btn sm', type: 'button', onclick: turnOff }, 'Turn off on this phone')));
      else { const b = h('button', { class: 'btn gold', type: 'button' }, icon('check'), 'Turn on notifications'); b.onclick = () => turnOn(b);
        put(h('p', {}, `Get a notification on this ${device()} every time someone books with you.`), b,
          Notification.permission === 'denied' ? h('p', { class: 'hint' }, ios ? 'Notifications are blocked. Turn them on in iPhone Settings → Notifications → Lopezcuts.' : 'Notifications are blocked for this site in your browser settings.') : null); }
      const others = list.filter(r => !sub || r.endpoint !== sub.endpoint);
      devices.replaceChildren(...(list.length ? list.map(r => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { class: 't' }, r.device || 'Device', sub && r.endpoint === sub.endpoint ? ' (this one)' : ''),
        h('div', { class: 's' }, `Added ${T.date(r.created_at, { month: 'short', day: 'numeric' })}${r.last_ok_at ? ' · last sent ' + T.date(r.last_ok_at, { month: 'short', day: 'numeric' }) : ''}`)),
        others.includes(r) ? armBtn('Remove', async () => { await run(() => LC.remove('push_subscriptions', r.id), 'Removed'); paint(); }) : null)) : [h('div', { class: 'empty' }, 'No phones yet.')]));
    }
    paint();
    return h('div', { class: 'grid2' },
      h('section', { class: 'card stack' }, h('h2', {}, 'Phone notifications'), status),
      h('section', { class: 'card stack' }, h('h2', {}, 'Your phones'), h('p', { class: 'hint' }, 'Turn notifications on from each phone you use. You only get alerts for bookings online, not ones you add yourself.'), devices));
  }
  function setTexts() {
    const s = S(); let mode = s.text_mode || 'manual';
    const opt = (val, title, sub) => h('label', { class: 'toggle', style: 'align-items:flex-start' }, h('input', { type: 'radio', name: 'tmode', value: val, checked: mode === val, onchange: () => { mode = val; } }),
      h('span', {}, h('b', {}, title), h('br'), h('span', { class: 'small muted' }, sub)));
    const hour = h('select', { id: 'st_smsHour' }, Array.from({ length: 16 }, (_, i) => i + 6).map(hr => h('option', { value: String(hr), selected: hr === (s.sms_followup_hour ?? 11) }, T.time(T.zoned(T.today(), T.hm(hr * 60))))));
    const site = h('input', { id: 'st_site', value: s.site_url || 'https://www.lopezcuts.com' });
    const save = async () => {
      const url = site.value.trim().replace(/\/$/, ''); if (!/^https:\/\/[^\s]+$/.test(url)) { toast('Website must start with https://'); return; }
      await run(() => LC.update('settings', 1, { text_mode: mode, sms_followup_hour: +hour.value, site_url: url, updated_at: new Date().toISOString() }), 'Saved'); refresh(['settings']);
    };
    const log = (D.sms_outbox || []).filter(m => m.status !== 'queued');
    const kinds = { booked: 'Booking confirmed', rescheduled: 'You moved it', cancelled: 'You cancelled', followup: 'Thank-you' };
    const stPill = st => h('span', { class: 'pill plain ' + ({ sent: 'completed', failed: 'no_show', sending: 'booked' }[st] || '') }, { sent: 'Sent', failed: 'Failed', sending: 'Sending', skipped: 'Skipped' }[st] || st);
    return h('div', { class: 'grid2' },
      h('section', { class: 'card stack' }, h('h2', {}, 'Client texts'),
        h('p', { class: 'hint' }, 'Clients get a text when they book, when you cancel or move their appointment, and a thank-you after their cut (rebook, refer a friend, leave a review). Clients who cancel themselves are not texted.'),
        opt('manual', 'I send them from my phone (free)', 'Texts line up on your Today page. Send them at the end of the day with one tap each.'),
        opt('auto', 'Send automatically (Twilio, about $3–6/month)', 'Needs a Twilio account. See TEXTS-SETUP.md. Thank-yous go out the day after at the time below.'),
        opt('off', 'Off', 'No client texts.'),
        field('Automatic thank-you time', hour, 'Only used in automatic mode'),
        field('Website in texts', site),
        h('button', { class: 'btn gold', type: 'button', onclick: save }, 'Save')),
      h('section', { class: 'card stack' }, h('h2', {}, 'Recent texts'),
        log.length ? h('div', { class: 'list' }, log.map(m => h('div', { class: 'li' },
          h('div', { class: 'main' }, h('div', { class: 't' }, `${kinds[m.kind] || m.kind} · ${client(m.client_id).full_name}`),
            h('div', { class: 's' }, `${T.date(m.created_at)} ${T.time(m.created_at)}${m.error ? ' · ' + m.error : ''}`),
            h('details', {}, h('summary', { class: 'small muted' }, 'Show text'), h('div', { class: 'small', style: 'white-space:pre-wrap' }, m.body))),
          stPill(m.status)))) : h('div', { class: 'empty' }, 'No texts yet.')));
  }
  function setBusiness() {
    const s = S(); const v = {};
    const inp = (k, attrs = {}) => (v[k] = h('input', { id: 'st_' + k, value: s[k] ?? '', ...attrs }));
    const tz = h('select', { id: 'st_timezone' }, ['America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Chicago', 'America/New_York'].map(z => h('option', { selected: z === s.timezone }, z)));
    const open = h('input', { type: 'checkbox', id: 'st_open', checked: s.booking_open });
    const gaps = h('input', { type: 'checkbox', id: 'st_gaps', checked: s.avoid_gaps !== false });
    const save = async () => {
      const patch = { business_name: v.business_name.value.trim(), phone: v.phone.value.trim(), address: v.address.value.trim(), instagram: v.instagram.value.trim().replace(/^@/, ''), timezone: tz.value, booking_open: open.checked, avoid_gaps: gaps.checked };
      ['slot_interval_min', 'buffer_min', 'booking_window_days', 'max_active_bookings', 'cancel_cutoff_hours', 'booksy_review_count'].forEach(k => { patch[k] = parseInt(v[k].value, 10) || 0; });
      patch.min_notice_min = Math.round((+v.min_notice_hours.value || 0) * 60); patch.booksy_rating = +v.booksy_rating.value || 5; patch.updated_at = new Date().toISOString();
      await run(() => LC.update('settings', 1, patch), 'Settings saved'); refresh(['settings']);
    };
    v.min_notice_hours = h('input', { id: 'st_notice', type: 'number', min: '0', step: '0.5', value: String((s.min_notice_min || 0) / 60) });
    return h('div', { class: 'grid2' },
      h('section', { class: 'card stack' }, h('h2', {}, 'Shop'),
        field('Business name', inp('business_name')), h('div', { class: 'row' }, field('Phone', inp('phone')), field('Instagram', inp('instagram'))),
        field('Address', inp('address', { placeholder: 'Street, city' }), 'Private. Only sent in confirmation texts, never shown on the site.'),
        field('Time zone', tz),
        h('h2', { style: 'margin-top:8px' }, 'Booksy reviews'), h('div', { class: 'row' }, field('Booksy rating', inp('booksy_rating', { type: 'number', min: '1', max: '5', step: '0.1' })), field('Booksy review count', inp('booksy_review_count', { type: 'number', min: '0' })))),
      h('section', { class: 'card stack' }, h('h2', {}, 'Online booking'),
        h('label', { class: 'toggle' }, open, 'Accept online bookings'),
        h('p', { class: 'hint' }, 'Online bookings are confirmed automatically, like Booksy. Clients can still tap Confirm in the morning text.'),
        h('label', { class: 'toggle' }, gaps, 'Avoid gaps between services'),
        h('p', { class: 'hint' }, 'Offers times right before and after your bookings, and hides times that would leave a gap too short for a cut.'),
        h('div', { class: 'row' }, field('Start times every', inp('slot_interval_min', { type: 'number', min: '5', max: '120', step: '5' }), 'minutes'), field('Gap between clients', inp('buffer_min', { type: 'number', min: '0', max: '60', step: '5' }), 'minutes')),
        h('div', { class: 'row' }, field('Book at least', v.min_notice_hours, 'hours in advance'), field('Book up to', inp('booking_window_days', { type: 'number', min: '1', max: '180' }), 'days in the future (90 = 3 months)')),
        h('div', { class: 'row' }, field('Max upcoming per client', inp('max_active_bookings', { type: 'number', min: '1', max: '10' })), field('Cancel / reschedule', inp('cancel_cutoff_hours', { type: 'number', min: '0', max: '72' }), 'up to this many hours before')),
        h('button', { class: 'btn gold', type: 'button', onclick: save }, 'Save settings'),
        h('div', { class: 'alert info' }, icon('copy'), h('span', {}, 'Your booking link: ', h('b', {}, siteBase())), h('button', { class: 'btn sm', type: 'button', onclick: () => copy(siteBase()) }, 'Copy'))));
  }
  function setServices() {
    const rows = D.services.slice().sort(by('sort'));
    const row = sv => {
      const f = { name: h('input', { class: 'inp', value: sv.name, style: 'width:140px', 'aria-label': 'Name' }), price: h('input', { class: 'inp', type: 'number', min: '0', step: '1', value: String(+sv.price), 'aria-label': 'Price' }), new_client_price: h('input', { class: 'inp', type: 'number', min: '0', step: '1', value: sv.new_client_price == null ? '' : String(+sv.new_client_price), placeholder: '—', 'aria-label': 'First visit price' }), duration_min: h('input', { class: 'inp', type: 'number', min: '0', step: '5', value: String(sv.duration_min), 'aria-label': 'Minutes' }), description: h('input', { class: 'inp', value: sv.description, style: 'width:240px', 'aria-label': 'Description' }) };
      const ck = k => h('input', { type: 'checkbox', checked: sv[k], 'aria-label': k, 'data-k': k });
      const checks = { first_visit_only: ck('first_visit_only'), is_addon: ck('is_addon'), bookable: ck('bookable'), active: ck('active') };
      return h('tr', {}, h('td', {}, f.name), h('td', {}, f.description), h('td', {}, f.price), h('td', {}, f.new_client_price), h('td', {}, f.duration_min), h('td', {}, checks.first_visit_only), h('td', {}, checks.is_addon), h('td', {}, checks.bookable), h('td', {}, checks.active),
        h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          await run(() => LC.update('services', sv.id, { name: f.name.value.trim(), description: f.description.value, price: +f.price.value || 0, new_client_price: f.new_client_price.value === '' ? null : +f.new_client_price.value, duration_min: parseInt(f.duration_min.value, 10) || 0, first_visit_only: checks.first_visit_only.checked, is_addon: checks.is_addon.checked, bookable: checks.bookable.checked, active: checks.active.checked }), 'Saved'); refresh(['services']);
        } }, 'Save'), armBtn('✕', async () => { await run(() => LC.update('services', sv.id, { active: false, bookable: false }), 'Turned off (kept for history)'); refresh(['services']); }, 'btn sm ghost danger', 'Turn off?'))));
    };
    return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'Changes show on the public site right away. "New clients only" means only people who have never been in can book it online (like First Time Haircut). "First visit" is an optional lower price for new clients on any service. Add-ons attach to a main service. Turn off "Online" to list a service without letting people book it.'),
      h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Description', 'Price', 'First visit', 'Minutes', 'New clients only', 'Add-on', 'Online', 'Active', ''].map(t => h('th', {}, t)))), h('tbody', {}, rows.map(row)))),
      h('button', { class: 'btn', type: 'button', style: 'justify-self:start', onclick: async () => { await run(() => LC.insert('services', { name: 'New service', description: '', is_addon: false, duration_min: 30, price: 0, new_client_price: null, bookable: false, active: true, sort: rows.length * 10 }), 'Added. Fill it in and save.'); refresh(['services']); } }, icon('plus'), 'Add service'));
  }
  function setHours() {
    const choices = isAdmin() ? D.staff.filter(s => s.active) : D.staff.filter(s => s.id === ME.staff_id);
    if (!choices.length) return h('div', { class: 'empty' }, 'Your login isn\'t linked to a chair yet. Ask the owner to link it under Team & access.');
    UI.hoursStaff = choices.some(s => s.id === UI.hoursStaff) ? UI.hoursStaff : choices[0].id;
    const sid = UI.hoursStaff; const wh = D.working_hours.filter(w => w.staff_id === sid);
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; const order = [1, 2, 3, 4, 5, 6, 0];
    const rowsEls = order.map((d, i) => {
      const cur = wh.filter(w => w.weekday === d).sort(by('start_time'))[0];
      const on = h('input', { type: 'checkbox', checked: !!cur, 'data-day': d });
      const a = h('input', { class: 'inp', type: 'time', value: cur ? cur.start_time.slice(0, 5) : '14:00', 'aria-label': names[i] + ' start' });
      const b = h('input', { class: 'inp', type: 'time', value: cur ? cur.end_time.slice(0, 5) : '20:00', 'aria-label': names[i] + ' end' });
      const extra = wh.filter(w => w.weekday === d).length > 1 ? h('span', { class: 'small muted' }, '(has a split shift; saving keeps one block)') : null;
      return { d, on, a, b, el: h('div', { class: 'hours-row' }, h('b', {}, names[i]), h('label', { class: 'toggle' }, on, h('span', { class: 'small' }, 'Open')), h('div', { class: 'times' }, a, '–', b, extra)) };
    });
    const save = async () => {
      for (const r of rowsEls) if (r.on.checked && r.b.value <= r.a.value) { toast(`Closing time must be after opening time on ${names[order.indexOf(r.d)]}.`); return; }
      try {
        for (const w of wh) await LC.remove('working_hours', w.id);
        for (const r of rowsEls) if (r.on.checked) await LC.insert('working_hours', { staff_id: sid, weekday: r.d, start_time: r.a.value + ':00', end_time: r.b.value + ':00' });
        toast('Hours saved. The booking page updates right away.');
      } catch (e) { toast(e.message); }
      refresh(['working_hours']);
    };
    const offs = D.time_off.filter(o => o.staff_id === sid && +new Date(o.ends_at) > Date.now()).sort(by('starts_at'));
    return h('div', { class: 'grid2' },
      h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Weekly hours'), choices.length > 1 ? h('select', { class: 'inp', style: 'width:auto', onchange: e => { UI.hoursStaff = e.target.value; render(); } }, choices.map(s => h('option', { value: s.id, selected: s.id === sid }, s.display_name))) : null),
        rowsEls.map(r => r.el), h('button', { class: 'btn gold', type: 'button', style: 'margin-top:12px', onclick: save }, 'Save hours')),
      h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Time off'), h('button', { class: 'btn sm', type: 'button', onclick: () => openTimeOff() }, icon('plus'), 'Block time')),
        offs.length ? h('div', { class: 'list' }, offs.map(o => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { class: 't' }, o.reason || 'Time off'), h('div', { class: 's' }, `${T.date(o.starts_at)} ${T.time(o.starts_at)} → ${T.date(o.ends_at)} ${T.time(o.ends_at)}`)), h('button', { class: 'btn sm', type: 'button', onclick: () => openTimeOff(o) }, 'Edit')))) : h('div', { class: 'empty' }, 'No upcoming time off.')));
  }
  function setTeam() {
    const em = h('input', { id: 'invEmail', type: 'email', placeholder: 'name@example.com' }), nm = h('input', { id: 'invName', placeholder: 'Full name' });
    const rl = h('select', { id: 'invRole' }, h('option', { value: 'employee' }, 'Employee'), h('option', { value: 'manager' }, 'Manager'), h('option', { value: 'owner' }, 'Owner'));
    const chair = (val, id) => h('select', { class: 'inp', id }, h('option', { value: '' }, 'No chair'), D.staff.map(s => h('option', { value: s.id, selected: s.id === val }, s.display_name)));
    const ch = chair('', 'invChair');
    const roleDesc = { owner: 'Everything, including team access and the activity log', manager: 'Everything except team access and the activity log', employee: 'Own calendar and clients. Never sees money.' };
    return h('div', { class: 'section-gap' },
      h('div', { class: 'alert info' }, icon('shield'), h('span', {}, 'Only invited emails can create an account. Owners and managers must use 2-step verification. Removing access here locks the person out on their next action.')),
      h('div', { class: 'grid2' },
        h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'People with access')),
          h('div', { class: 'list' }, D.profiles.map(p => h('div', { class: 'li', style: 'flex-wrap:wrap' },
            h('span', { class: 'avatar' }, initials(p.full_name || p.email)), h('div', { class: 'main' }, h('div', { class: 't' }, (p.full_name || p.email) + (p.id === ME.id ? ' (you)' : '')), h('div', { class: 's' }, p.email)),
            p.id === ME.id ? h('span', { class: 'pill gold plain' }, p.role) : [
              h('select', { class: 'inp', style: 'width:auto', 'aria-label': 'Role', onchange: async e => { await run(() => LC.update('profiles', p.id, { role: e.target.value }), 'Role changed'); refresh(['profiles']); } }, ['employee', 'manager', 'owner'].map(r => h('option', { value: r, selected: r === p.role }, r[0].toUpperCase() + r.slice(1)))),
              (() => { const c = chair(p.staff_id || '', 'ch-' + p.id); c.style.width = 'auto'; c.addEventListener('change', async () => { await run(() => LC.update('profiles', p.id, { staff_id: c.value || null }), 'Chair linked'); refresh(['profiles']); }); return c; })(),
              h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: p.active, onchange: async e => { await run(() => LC.update('profiles', p.id, { active: e.target.checked }), e.target.checked ? 'Access restored' : 'Access removed'); refresh(['profiles']); } }), 'Access')])))),
        h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Invite someone')),
          h('form', { class: 'stack', onsubmit: async e => { e.preventDefault(); const email = em.value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email'); return; } await run(() => LC.upsert('staff_invites', { email, role: rl.value, staff_id: ch.value || null, full_name: nm.value.trim() }, 'email'), 'Invited. Tell them to go to the staff sign-in page.'); refresh(['staff_invites']); } },
            h('div', { class: 'row' }, field('Email', em), field('Name', nm)), h('div', { class: 'row' }, field('Role', rl), field('Their chair', ch, 'Link a barber so their calendar works')),
            h('p', { class: 'hint' }, roleDesc.employee), h('button', { class: 'btn gold', type: 'submit' }, 'Send invite')),
          h('p', { class: 'hint', style: 'margin-top:10px' }, `They sign in at ${new URL('./', location.href).href} with "Email me a sign-in link", then set a password${''}. Managers and owners set up 2-step verification on first sign-in.`),
          D.staff_invites.length ? h('div', { class: 'list', style: 'margin-top:10px' }, D.staff_invites.map(i => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { class: 't' }, i.email), h('div', { class: 's' }, `${i.role}${i.accepted_at ? ' · joined ' + T.date(i.accepted_at) : ' · not signed in yet'}`)), armBtn('Revoke', async () => { await run(() => LC.remove('staff_invites', i.email, 'email'), 'Invite removed'); refresh(['staff_invites']); }, 'btn sm danger', 'Sure?')))) : null)),
      h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, 'Chairs'), h('div', { class: 'sub' }, 'Each barber who takes appointments. "Online" chairs show up on the booking page.')), h('button', { class: 'btn sm', type: 'button', onclick: async () => { await run(() => LC.insert('staff', { display_name: 'New barber', title: 'Barber', bio: '', color: '#6f8fb8', active: true, accepts_online: false, sort: D.staff.length }), 'Chair added'); refresh(['staff']); } }, icon('plus'), 'Add chair')),
        h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Title', 'Color', 'Online', 'Active', ''].map(t => h('th', {}, t)))), h('tbody', {}, D.staff.map(s => {
          const n = h('input', { class: 'inp', value: s.display_name, style: 'width:160px', 'aria-label': 'Name' }), t = h('input', { class: 'inp', value: s.title, style: 'width:150px', 'aria-label': 'Title' }), c = h('input', { type: 'color', value: s.color || '#c9a24a', 'aria-label': 'Color' }), o = h('input', { type: 'checkbox', checked: s.accepts_online, 'aria-label': 'Online' }), a = h('input', { type: 'checkbox', checked: s.active, 'aria-label': 'Active' });
          return h('tr', {}, h('td', {}, n), h('td', {}, t), h('td', {}, c), h('td', {}, o), h('td', {}, a), h('td', {}, h('button', { class: 'btn sm', type: 'button', onclick: async () => { await run(() => LC.update('staff', s.id, { display_name: n.value.trim(), title: t.value.trim(), color: c.value, accepts_online: o.checked, active: a.checked }), 'Saved'); refresh(['staff']); } }, 'Save')));
        }))))));
  }
  function setSecurity() {
    const p1 = h('input', { id: 'pw1', type: 'password', autocomplete: 'new-password', minlength: '10' }), p2 = h('input', { id: 'pw2', type: 'password', autocomplete: 'new-password' });
    const out = h('div');
    return h('div', { class: 'grid2' },
      h('section', { class: 'card stack' }, h('h2', {}, 'Your account'),
        h('dl', { class: 'dl' }, h('dt', {}, 'Name'), h('dd', {}, ME.full_name || '—'), h('dt', {}, 'Email'), h('dd', {}, ME.email), h('dt', {}, 'Role'), h('dd', { style: 'text-transform:capitalize' }, ME.role), h('dt', {}, 'Chair'), h('dd', {}, staffName(ME.staff_id) || 'Not linked'),
          h('dt', {}, '2-step'), h('dd', {}, ME.role === 'employee' ? 'Optional for employees' : h('span', { class: 'pill confirmed' }, 'On'))),
        h('p', { class: 'hint' }, 'You\'re signed out automatically after 30 minutes without activity.'),
        h('button', { class: 'btn', type: 'button', style: 'justify-self:start', onclick: signOut }, icon('out'), 'Sign out')),
      h('section', { class: 'card stack' }, h('h2', {}, 'Set a password'), h('p', { class: 'hint' }, 'Use at least 10 characters. A password manager makes this easy.'),
        field('New password', p1), field('Type it again', p2), out,
        h('button', { class: 'btn gold', type: 'button', style: 'justify-self:start', onclick: async () => {
          out.replaceChildren();
          if (p1.value.length < 10) { out.replaceChildren(h('div', { class: 'err' }, 'Use at least 10 characters.')); return; }
          if (p1.value !== p2.value) { out.replaceChildren(h('div', { class: 'err' }, 'The two passwords don\'t match.')); return; }
          try { await LC.auth.setPassword(p1.value); p1.value = p2.value = ''; out.replaceChildren(h('div', { class: 'okmsg' }, LC.mode === 'demo' ? 'Demo mode: nothing was changed.' : 'Password saved.')); } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); }
        } }, 'Save password')));
  }
  function setActivity() {
    const who = id => { const p = D.prof.get(id); return p ? (p.full_name || p.email) : (id ? 'Someone' : 'Client (online)'); };
    const desc = e => { const d = e.new_data || e.old_data || {}; switch (e.table_name) {
      case 'payments': return `${e.action === 'delete' ? 'Removed' : 'Recorded'} payment ${money(d.amount)} + ${money(d.tip)} tip (${d.method})`;
      case 'expenses': return `${e.action === 'delete' ? 'Deleted' : e.action === 'insert' ? 'Added' : 'Edited'} expense "${d.description}" ${money(d.amount)}`;
      case 'budgets': return `Budget ${d.category}: ${money(d.monthly_limit)}`;
      case 'profiles': return `${e.action === 'update' ? 'Changed access for' : e.action === 'insert' ? 'New login' : 'Removed login'} ${d.email} (${d.role}${d.active === false ? ', access off' : ''})`;
      case 'staff_invites': return `${e.action === 'delete' ? 'Revoked invite for' : 'Invited'} ${d.email} as ${d.role}`;
      case 'settings': return 'Changed business settings';
      case 'services': return `${e.action === 'insert' ? 'Added' : e.action === 'delete' ? 'Deleted' : 'Edited'} service "${d.name}"${d.price != null ? ' ' + money(d.price) : ''}`;
      default: return `${e.action} ${e.table_name}`; } };
    return h('section', { class: 'card audit' }, h('div', { class: 'card-h' }, h('div', {}, h('h2', {}, 'Activity log'), h('div', { class: 'sub' }, 'Every change to money, prices, settings and team access. Nobody can edit or delete this log.'))),
      D.audit_log.length ? h('div', { class: 'list' }, D.audit_log.map(e => h('div', { class: 'li' }, h('div', { class: 'main' }, h('div', { style: 'font-weight:500' }, desc(e)), h('div', { class: 's' }, `${T.date(e.at, { month: 'short', day: 'numeric' })} ${T.time(e.at)} · ${who(e.actor)}`))))) : h('div', { class: 'empty' }, 'Nothing logged yet.'));
  }

  // ===================================================================
  //  BOOT
  // ===================================================================
  LC.onData(t => { if (entered && t === '*') refresh(); });
  if (LC.mode === 'live') LC.auth.onChange((ev) => { if (ev === 'SIGNED_IN' && !entered) gate(); if (ev === 'SIGNED_OUT' && entered) { entered = false; showLogin(); } });
  (async () => {
    try {
      await LC.ready;
      const s = await LC.auth.session();
      if (!s) return LC.mode === 'demo' ? showDemoLogin() : showLogin();
      await gate();
    } catch (e) { showLogin(e.message); }
  })();
  addEventListener('resize', () => { if (entered && UI.view === 'calendar') { clearTimeout(window.__rz); window.__rz = setTimeout(render, 200); } });
})();
