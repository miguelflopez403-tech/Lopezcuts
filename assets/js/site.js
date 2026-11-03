/* Lopezcuts public site: portfolio, prices, reviews, live next opening, booking sheet. */
(function () {
  'use strict';
  const { T, money, fmtPhone } = LC;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(9).forEach(k => { if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); });
    return e;
  }
  const icon = (id, cls = 'ic') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + id); s.append(u); return s; };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy: ' + text); } }

  const state = { settings: null, services: [], staff: [], reviews: [], portfolio: [], filter: 'All' };
  $('#year').textContent = new Date().getFullYear();
  if (LC.mode === 'demo') $('#demoPill').hidden = false;

  // ---------------- Nav ----------------
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if ('IntersectionObserver' in window) {
    const links = new Map($$('.nav-links a').map(a => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { links.forEach(a => a.classList.remove('active')); links.get(e.target.id)?.classList.add('active'); } }), { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }
  $$('[data-copy]').forEach(b => b.addEventListener('click', () => copy(b.dataset.copy)));

  // ---------------- Reveal + count-up (only for content below the fold) ----------------
  function setupReveal() {
    if (reduced || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return; const el = e.target; io.unobserve(el);
      el.classList.add('revealed'); el.classList.remove('pre'); countUp(el);
    }), { rootMargin: '0px 0px -8% 0px' });
    $$('[data-reveal]').forEach((el, i) => {
      if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('pre'); el.style.transitionDelay = (i % 4) * 70 + 'ms'; io.observe(el); }
    });
  }
  function countUp(root) {
    $$('[data-count]', root).forEach(el => {
      const to = +el.dataset.count, suf = el.dataset.suffix || '', plain = 'plain' in el.dataset; const from = plain ? to - 6 : 0; const t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 1100); const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); el.textContent = v + suf; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ---------------- Portfolio ----------------
  const LOOKS = ['Fades', 'Tapers', 'Lineups', 'Curly', 'Designs', 'Beards'];
  function placeholderArt(i) {
    const cat = LOOKS[i % LOOKS.length];
    const g = {
      Fades: `linear-gradient(180deg, #4a3f2c 0%, #2a251c 45%, #15130f 100%), repeating-linear-gradient(0deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 5px)`,
      Tapers: `linear-gradient(160deg, #3b3427 0%, #1d1a15 60%), repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 7px)`,
      Lineups: `linear-gradient(135deg, transparent 49.6%, rgb(227 196 122 / 55%) 49.8% 50.2%, transparent 50.4%), linear-gradient(180deg, #2c271f, #121110)`,
      Curly: `radial-gradient(circle at 30% 30%, rgb(255 255 255 / 6%) 0 2px, transparent 3px) 0 0 / 14px 14px, radial-gradient(circle at 70% 70%, rgb(201 162 74 / 10%) 0 3px, transparent 4px) 0 0 / 18px 18px, linear-gradient(200deg, #3d3326, #15130f)`,
      Designs: `repeating-linear-gradient(60deg, transparent 0 18px, rgb(227 196 122 / 14%) 18px 19px), repeating-linear-gradient(-60deg, transparent 0 18px, rgb(227 196 122 / 10%) 18px 19px), linear-gradient(180deg, #27231c, #121110)`,
      Beards: `conic-gradient(from 200deg at 50% 110%, #463b29, #1b1915 40%, #2e281e 60%, #15130f), repeating-linear-gradient(90deg, rgb(255 255 255 / 3%) 0 1px, transparent 1px 4px)`,
    };
    const hue = (i * 23) % 40 - 20;
    return h('div', { class: 'ph', style: `background:${g[cat] || g.Fades};filter:hue-rotate(${hue}deg)` });
  }
  function renderGallery() {
    const items = state.portfolio;
    $('#placeholderNote').hidden = !items.some(p => !p.image_url);
    const tiles = items.map((p, i) => {
      return h('button', { class: 'tile', type: 'button', 'aria-label': `${p.title}${p.image_url ? '' : ' (placeholder)'}`, onclick: () => openLightbox(p, i) },
        p.image_url ? h('img', { src: p.image_url, alt: p.title, loading: 'lazy' }) : [placeholderArt(i), icon('scissors', 'scissor')],
        !p.image_url && h('span', { class: 'badge' }, 'Placeholder'),
        h('span', { class: 'cap' }, h('b', {}, p.title), p.description && !/^placeholder/i.test(p.description) ? h('span', {}, p.description) : null));
    });
    $('#gallery').replaceChildren(...tiles);
  }
  const lb = $('#lightbox');
  function openLightbox(p, i) {
    $('#lbMedia').replaceChildren(p.image_url ? h('img', { src: p.image_url, alt: p.title }) : [placeholderArt(i), h('div', { class: 'lb-ph-text' }, h('div', {}, h('b', {}, p.title), 'Placeholder tile. Real photo coming soon.'))]);
    $('#lbCap').textContent = p.title; lb.showModal();
  }
  $('#lbClose').addEventListener('click', () => lb.close());
  lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });

  // ---------------- Reviews ----------------
  function renderReviews() {
    const list = state.reviews.slice(0, 9);
    $('#reviewList').replaceChildren(...list.map(r => h('article', { class: 'review', 'data-reveal': '' },
      h('span', { class: 'stars', 'aria-label': `${r.rating} out of 5 stars` }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)),
      h('q', {}, r.body),
      r.reply ? h('p', { class: 'reply' }, 'Miguel: ' + r.reply) : null,
      h('div', { class: 'who' }, h('span', { class: 'av', 'aria-hidden': 'true' }, (r.display_name || 'C')[0]), h('span', {}, h('b', {}, r.display_name), h('br'), h('span', { class: 'src' }, `${r.label || 'Client'} · via ${r.source === 'booksy' ? 'Booksy' : 'Lopezcuts'}`))))));
    const s = state.settings; if (!s) return;
    const site = state.reviews.filter(r => r.source === 'site');
    const count = (+s.booksy_review_count || 0) + site.length;
    const avg = count ? (((+s.booksy_rating || 5) * (+s.booksy_review_count || 0)) + site.reduce((t, r) => t + r.rating, 0)) / count : 5;
    $('#ratingBadge .rating-n').textContent = avg.toFixed(1);
    $('#ratingCount').textContent = site.length ? `${count} reviews (Booksy + Lopezcuts)` : `${count} reviews on Booksy`;
    $('#heroRating').textContent = `${count} reviews`;
    $('.hero-facts li:last-child b').textContent = avg.toFixed(1);
  }

  // ---------------- Prices from the database ----------------
  function renderPrices() {
    const mains = state.services.filter(s => !s.is_addon && s.bookable && s.active);
    const first = mains.find(s => s.first_visit_only) || mains.find(s => s.new_client_price != null);
    const back = mains.find(s => !s.first_visit_only && !/hometown/i.test(s.name)) || first;
    const home = mains.find(s => /hometown/i.test(s.name));
    if (first || back) {
      const feat = $('.price-card.feature'); const b = $$('.pc-prices .big', feat);
      const firstPrice = first ? (first.first_visit_only ? first.price : (first.new_client_price ?? first.price)) : back.price;
      if (b[0]) b[0].textContent = money(firstPrice);
      if (b[1] && back) b[1].textContent = money(back.price);
      $('.tag', feat).textContent = `Up to ${(back || first).duration_min} min`;
      $('.hero-facts li:first-child b').textContent = money(firstPrice);
    }
    if (home) {
      const hp = $('.ht-price'); if (hp) hp.textContent = `${money(home.price)} · ${home.duration_min} min`;
      const hb = $('#homeBook'); if (hb) { hb.dataset.svc = home.id; hb.textContent = 'Book a hometown cut'; }
    }
    const adds = state.services.filter(s => s.is_addon && s.active);
    if (adds.length) $('.addon-list').replaceChildren(...adds.map(a => h('li', {}, h('span', {}, a.name), h('b', {}, '+' + money(a.price)))));
  }

  // ---------------- Next opening ----------------
  async function nextOpening() {
    const staff = state.staff[0]; const cut = state.services.find(s => !s.is_addon && s.bookable);
    if (!staff || !cut) return;
    if (state.settings && !state.settings.booking_open) { $('#nextWhen').textContent = 'Booking paused'; $('#nextSub').textContent = 'Text (571) 599-9297 to book'; return; }
    try {
      const days = await LC.rpc('get_open_days', { p_staff_id: staff.id, p_from: T.today(), p_days: 14, p_duration: cut.duration_min });
      const d = days.find(x => x.openings > 0);
      if (!d) { $('#nextWhen').textContent = 'Fully booked'; $('#nextSub').textContent = 'Text to get on the waitlist'; return; }
      const slots = await LC.rpc('get_available_slots', { p_staff_id: staff.id, p_day: d.day, p_duration: cut.duration_min });
      const s = slots[0]; if (!s) return;
      const rel = d.day === T.today() ? 'Today' : d.day === T.addDays(T.today(), 1) ? 'Tomorrow' : T.dayLabel(d.day, { weekday: 'long' });
      $('#nextWhen').replaceChildren(h('small', {}, rel === 'Today' || rel === 'Tomorrow' ? `${rel}, ${T.dayLabel(d.day, { month: 'short', day: 'numeric' })}` : T.dayLabel(d.day, { weekday: 'long', month: 'short', day: 'numeric' })), T.time(s));
      $('#nextSub').textContent = `${staff.display_name} · ${cut.name} · ${d.openings} open ${d.openings === 1 ? 'spot' : 'spots'} that day`;
      const btn = $('#nextBtn'); btn.dataset.slot = s; btn.dataset.day = d.day;
    } catch (e) { $('#nextWhen').textContent = 'Book online'; $('#nextSub').textContent = 'See all open times'; }
  }

  // =====================================================================
  //  Booking sheet
  // =====================================================================
  const sheet = $('#sheet'), body = $('#sheetBody'), nextBtn = $('#sheetNext'), backBtn = $('#sheetBack');
  const B = { step: 0, serviceId: null, addons: new Set(), staffId: null, day: null, slot: null, days: [], slots: null, form: { name: '', phone: '', email: '', note: '', remember: true }, result: null, error: '' };
  const STEPS = ['Choose your service', 'Pick a time', 'Your details', 'You\'re booked'];
  const svc = () => state.services.find(s => s.id === B.serviceId);
  const addonList = () => state.services.filter(s => s.is_addon && s.active && s.bookable);
  const duration = () => (svc()?.duration_min || 40) + addonList().filter(a => B.addons.has(a.id)).reduce((t, a) => t + a.duration_min, 0);
  const addonsPrice = () => addonList().filter(a => B.addons.has(a.id)).reduce((t, a) => t + +a.price, 0);

  try { const saved = JSON.parse(localStorage.getItem('lopezcuts-me') || 'null'); if (saved) Object.assign(B.form, saved); } catch { }

  function openBooking(opts = {}) {
    if (!state.services.length) { toast('Loading services, try again in a second'); return; }
    const mains = state.services.filter(s => !s.is_addon && s.bookable && s.active);
    // People who booked from this phone before start on the returning option; everyone else on first time.
    const pick = B.form.phone ? mains.find(s => !s.first_visit_only && !/hometown/i.test(s.name)) : mains.find(s => s.first_visit_only);
    if (opts.serviceId) { B.serviceId = opts.serviceId; B.slot = null; }
    B.serviceId = B.serviceId || (pick || mains[0])?.id;
    B.staffId = B.staffId || state.staff[0]?.id;
    B.error = ''; B.result = null; B.step = 0;
    if (opts.day && opts.slot) { B.day = opts.day; B.slot = opts.slot; }
    sheet.showModal(); render();
    if (opts.day && opts.slot) go(1);
  }
  $$('[data-book]').forEach(b => b.addEventListener('click', e => { if (b.id === 'homeBook' && !b.dataset.svc) return; e.preventDefault(); openBooking(b.dataset.slot ? { day: b.dataset.day, slot: b.dataset.slot } : b.dataset.svc ? { serviceId: b.dataset.svc } : {}); }));
  $('#sheetClose').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  sheet.addEventListener('close', () => { if (location.hash.startsWith('#manage-')) history.replaceState(null, '', location.pathname + location.search); });
  backBtn.addEventListener('click', () => go(B.step - 1));
  nextBtn.addEventListener('click', () => next());

  function go(step) { B.step = Math.max(0, step); B.error = ''; render(); body.scrollTop = 0; if (B.step === 1) loadDays(); }

  function header(title, stepTxt, pct) {
    $('#sheetTitle').textContent = title; $('#sheetStep').textContent = stepTxt; $('#progressBar').style.width = pct + '%';
  }
  function render() {
    const s = B.step;
    backBtn.hidden = !(s === 1 || s === 2);
    $('#sheetFoot').hidden = s === 3 || s === 9;
    header(STEPS[s] || 'Your booking', s < 3 ? `Step ${s + 1} of 3` : (s === 3 ? 'Confirmed' : 'Manage'), s < 3 ? (s + 1) * 33.4 : 100);
    const view = s === 0 ? stepService() : s === 1 ? stepTime() : s === 2 ? stepDetails() : s === 3 ? stepDone() : null;
    if (view) { const wrap = h('div', { class: 'step-anim' }, view); body.replaceChildren(wrap); }
    paintFoot();
  }
  function paintFoot() {
    const s = svc(); if (!s) return;
    const base = s.new_client_price != null ? `${money(s.new_client_price + addonsPrice())} first visit · ${money(+s.price + addonsPrice())} after` : money(+s.price + addonsPrice());
    const when = B.slot ? `${T.dayLabel(B.day, { weekday: 'short', month: 'short', day: 'numeric' })} at ${T.time(B.slot)}` : `${duration()} min`;
    $('#footSum').replaceChildren(h('b', {}, s.name + (B.addons.size ? ' + ' + addonList().filter(a => B.addons.has(a.id)).map(a => a.name).join(' + ') : '')), h('br'), `${when} · ${base}`);
    nextBtn.textContent = B.step === 2 ? 'Book it' : 'Continue';
    nextBtn.disabled = (B.step === 1 && !B.slot) || B.busy;
  }

  function stepService() {
    const mains = state.services.filter(s => !s.is_addon && s.bookable && s.active);
    const adds = addonList();
    return [
      h('p', { class: 'opt-label' }, 'Service'),
      h('div', { class: 'svc-list', role: 'radiogroup', 'aria-label': 'Service' }, mains.map(s => h('button', { class: 'svc', type: 'button', role: 'radio', 'aria-checked': String(B.serviceId === s.id), onclick: () => { B.serviceId = s.id; B.slot = null; render(); } },
        h('span', { class: 'box' }, icon('check')),
        h('span', { class: 'grow' }, h('span', { class: 'nm' }, s.name), h('span', { class: 'ds' }, s.description)),
        h('span', { class: 'pr' }, s.new_client_price != null ? [money(s.new_client_price), h('small', {}, `first visit · ${money(s.price)} after`)] : money(s.price))))),
      adds.length ? h('p', { class: 'opt-label' }, 'Add-ons (optional)') : null,
      adds.length ? h('div', { class: 'svc-list' }, adds.map(a => h('button', { class: 'svc multi', type: 'button', 'aria-pressed': String(B.addons.has(a.id)), onclick: () => { B.addons.has(a.id) ? B.addons.delete(a.id) : B.addons.add(a.id); B.slot = null; render(); } },
        h('span', { class: 'box' }, icon('check')),
        h('span', { class: 'grow' }, h('span', { class: 'nm' }, a.name), h('span', { class: 'ds' }, a.description)),
        h('span', { class: 'pr' }, '+' + money(a.price))))) : null,
      state.staff.length > 1 ? [h('p', { class: 'opt-label' }, 'Barber'), h('div', { class: 'chips' }, state.staff.map(st => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(B.staffId === st.id), onclick: () => { B.staffId = st.id; B.slot = null; render(); } }, st.display_name)))] : null,
    ];
  }

  async function loadDays() {
    B.days = []; B.slots = null; render();
    try {
      const sp = state.settings?.booking_window_days || 90;
      B.days = await LC.rpc('get_open_days', { p_staff_id: B.staffId, p_from: T.today(), p_days: Math.min(sp + 1, 93), p_duration: duration() });
      if (!B.day || !B.days.some(d => d.day === B.day && d.openings)) B.day = (B.days.find(d => d.openings) || {}).day || null;
      if (B.step !== 1) return; render(); if (B.day) loadSlots();
    } catch (e) { B.error = e.message; render(); }
  }
  async function loadSlots() {
    B.slots = null; render();
    try {
      B.slots = await LC.rpc('get_available_slots', { p_staff_id: B.staffId, p_day: B.day, p_duration: duration() });
      if (B.slot && !B.slots.includes(B.slot)) B.slot = null;
      if (B.step === 1) render();
      const sel = $('.day[aria-pressed="true"]', body); sel?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
    } catch (e) { B.error = e.message; render(); }
  }
  function stepTime() {
    const out = [];
    if (B.error) out.push(h('div', { class: 'err', role: 'alert' }, B.error));
    out.push(h('p', { class: 'opt-label' }, 'Day'));
    out.push(B.days.length ? h('div', { class: 'days', role: 'group', 'aria-label': 'Choose a day' }, B.days.map(d => h('button', { class: 'day', type: 'button', disabled: !d.openings, 'aria-pressed': String(B.day === d.day), 'aria-label': `${T.dayLabel(d.day, { weekday: 'long', month: 'long', day: 'numeric' })}, ${d.openings ? d.openings + ' open' : 'no openings'}`, onclick: () => { B.day = d.day; B.slot = null; loadSlots(); } },
      h('span', { class: 'dw' }, d.day === T.today() ? 'Today' : T.dayLabel(d.day, { weekday: 'short' })), h('span', { class: 'dn' }, T.dayLabel(d.day, { day: 'numeric' })), h('span', { class: 'do' }, d.openings ? `${d.openings} open` : (T.weekday(d.day) === 0 ? 'Closed' : 'Full')))))
      : h('div', { class: 'days' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: 'width:70px;height:84px;flex:none' }))));
    if (!B.days.length) return out;
    if (!B.day) { out.push(h('div', { class: 'empty-slots' }, 'No openings in the next few weeks. Text (571) 599-9297 and Miguel will try to fit you in.')); return out; }
    out.push(h('p', { class: 'opt-label' }, T.dayLabel(B.day, { weekday: 'long', month: 'long', day: 'numeric' })));
    if (!B.slots) { out.push(h('div', { class: 'slots' }, Array.from({ length: 8 }, () => h('div', { class: 'skeleton' })))); return out; }
    if (!B.slots.length) { out.push(h('div', { class: 'empty-slots' }, 'That day just filled up. Try another day.')); return out; }
    const groups = { Morning: [], Afternoon: [], Evening: [] };
    B.slots.forEach(s => { const m = T.minutes(s); (m < 720 ? groups.Morning : m < 1020 ? groups.Afternoon : groups.Evening).push(s); });
    Object.entries(groups).forEach(([g, list]) => {
      if (!list.length) return;
      out.push(h('div', { class: 'slot-group' }, h('span', { class: 'muted small' }, g), h('div', { class: 'slots' }, list.map(s => h('button', { class: 'slot', type: 'button', 'aria-pressed': String(B.slot === s), onclick: ev => { B.slot = s; $$('.slot', body).forEach(x => x.setAttribute('aria-pressed', 'false')); ev.currentTarget.setAttribute('aria-pressed', 'true'); paintFoot(); } }, T.time(s))))));
    });
    return out;
  }
  function stepDetails() {
    const f = B.form;
    const bind = (k) => e => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    return [
      B.error ? h('div', { class: 'err', role: 'alert' }, B.error) : null,
      h('div', { class: 'field' }, h('label', { for: 'bName' }, 'Full name'), h('input', { id: 'bName', autocomplete: 'name', required: true, value: f.name, oninput: bind('name'), maxlength: '80' })),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'bPhone' }, 'Mobile number'), h('input', { id: 'bPhone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true, placeholder: '(801) 555-1234', value: f.phone, oninput: bind('phone') }), h('span', { class: 'hint' }, 'For your confirmation text. Never shared.')),
        h('div', { class: 'field' }, h('label', { for: 'bEmail' }, 'Email (optional)'), h('input', { id: 'bEmail', type: 'email', autocomplete: 'email', value: f.email, oninput: bind('email') }))),
      h('div', { class: 'field' }, h('label', { for: 'bNote' }, 'Anything Miguel should know? (optional)'), h('textarea', { id: 'bNote', maxlength: '500', placeholder: 'Style you want, reference photo on IG, first time, etc.', oninput: bind('note') }, f.note)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'bRemember', checked: f.remember, onchange: bind('remember') }), 'Remember my name and number on this device'),
      h('div', { class: 'summary' },
        h('div', { class: 'row' }, h('span', {}, 'When'), h('b', {}, `${T.dayLabel(B.day, { weekday: 'long', month: 'short', day: 'numeric' })}, ${T.time(B.slot)}`)),
        h('div', { class: 'row' }, h('span', {}, 'Service'), h('b', {}, svc().name + (B.addons.size ? ' + ' + addonList().filter(a => B.addons.has(a.id)).map(a => a.name).join(' + ') : ''))),
        h('div', { class: 'row' }, h('span', {}, 'Barber'), h('b', {}, (state.staff.find(s => s.id === B.staffId) || {}).display_name)),
        h('div', { class: 'row' }, h('span', {}, 'Price'), h('b', {}, svc().new_client_price != null ? `${money(+svc().new_client_price + addonsPrice())} if it's your first visit, ${money(+svc().price + addonsPrice())} if you've been before` : money(+svc().price + addonsPrice())))),
      h('p', { class: 'muted small' }, `Pay at your appointment. Need to cancel? Use your booking link up to ${state.settings?.cancel_cutoff_hours ?? 6} hours before, or text Miguel.`),
    ];
  }
  async function next() {
    if (B.step === 0) return go(1);
    if (B.step === 1) { if (B.slot) go(2); return; }
    if (B.step === 2) {
      const f = B.form;
      if (f.name.trim().length < 2) { B.error = 'Please enter your full name.'; render(); $('#bName')?.focus(); return; }
      if (!LC.normPhone(f.phone)) { B.error = 'Please enter a valid mobile number.'; render(); $('#bPhone')?.focus(); return; }
      B.busy = true; nextBtn.disabled = true; nextBtn.textContent = 'Booking…';
      try {
        const r = await LC.rpc('book_appointment', { p_name: f.name.trim(), p_phone: f.phone, p_email: f.email.trim() || null, p_service_id: B.serviceId, p_addon_ids: [...B.addons], p_staff_id: B.staffId, p_starts_at: B.slot, p_note: f.note.trim() });
        try { if (f.remember) localStorage.setItem('lopezcuts-me', JSON.stringify({ name: f.name, phone: f.phone, email: f.email, remember: true })); else localStorage.removeItem('lopezcuts-me'); } catch { }
        B.result = r; B.form.note = ''; B.busy = false; go(3); nextOpening();
      } catch (e) {
        B.busy = false; B.error = e.message;
        if (/taken/i.test(e.message)) { B.slot = null; go(1); B.error = e.message; } else render();
      }
    }
  }
  const manageUrl = token => (LC.mode === 'live' && LC.config.siteUrl && !/localhost|127\.0\.0\.1/.test(location.host) ? location.origin + location.pathname : location.href.split('#')[0]) + '#manage-' + token;
  function gcal(r) {
    const f = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const p = new URLSearchParams({ action: 'TEMPLATE', text: `Lopezcuts: ${r.service}${r.addons?.length ? ' + ' + r.addons.join(' + ') : ''}`, dates: `${f(r.starts_at)}/${f(r.ends_at)}`, details: `With ${r.staff}. Miguel texts the address the morning of. Manage your booking: ${manageUrl(r.token)}`, location: 'Salt Lake City, UT' });
    return 'https://calendar.google.com/calendar/render?' + p;
  }
  function stepDone() {
    const r = B.result;
    return h('div', { class: 'done' },
      h('div', { class: 'done-check' }, icon('check')),
      h('h3', {}, `See you soon, ${B.form.name.split(' ')[0]}!`),
      h('p', { class: 'muted' }, `Miguel will text you the morning of your appointment with the address. ${r.new_client ? 'First visit, so you get the first-cut price.' : 'Welcome back.'}`),
      h('div', { class: 'big-ticket' },
        h('span', { class: 'price' }, money(r.price)),
        h('span', { class: 'when' }, `${T.date(r.starts_at, { weekday: 'long', month: 'short', day: 'numeric' })}`),
        h('span', { style: 'font:400 1.6rem/1 var(--display)' }, `${T.time(r.starts_at)} – ${T.time(r.ends_at)}`),
        h('span', { class: 'what' }, `${r.service}${r.addons?.length ? ' + ' + r.addons.join(' + ') : ''} · ${r.staff}`)),
      h('p', { class: 'opt-label', style: 'margin-top:6px' }, 'Your booking link'),
      h('div', { class: 'linkbox' }, h('code', {}, manageUrl(r.token)), h('button', { class: 'btn sm ghost-dark', type: 'button', onclick: () => copy(manageUrl(r.token)) }, icon('copy'), 'Copy')),
      h('p', { class: 'muted small' }, 'Save it to confirm, cancel or leave a review later.'),
      h('div', { class: 'done-actions' },
        h('a', { class: 'btn gold', href: gcal(r), target: '_blank', rel: 'noopener' }, icon('cal'), 'Add to Google Calendar'),
        h('button', { class: 'btn ghost-dark', type: 'button', onclick: () => sheet.close() }, 'Done')));
  }

  // ---------------- Manage a booking (#manage-<token>) ----------------
  async function openManage(token) {
    B.step = 9; sheet.showModal(); render(); header('Your booking', 'Manage', 100); $('#sheetFoot').hidden = true; backBtn.hidden = true;
    body.replaceChildren(h('div', { class: 'skeleton', style: 'height:160px' }));
    let bk;
    try { bk = await LC.rpc('get_booking', { p_token: token }); } catch (e) { body.replaceChildren(h('div', { class: 'err' }, e.message)); return; }
    if (!bk) { body.replaceChildren(h('div', { class: 'err' }, 'We couldn\'t find that booking. Check the link or text (571) 599-9297.')); return; }
    const label = { booked: 'Booked', confirmed: 'Confirmed', completed: 'Completed', no_show: 'Missed', cancelled: 'Cancelled' }[bk.status];
    const view = [
      h('div', { class: 'big-ticket' }, h('span', { class: 'price' }, money(bk.price)), h('span', { class: 'when' }, T.date(bk.starts_at, { weekday: 'long', month: 'short', day: 'numeric' })), h('span', { style: 'font:400 1.6rem/1 var(--display)' }, `${T.time(bk.starts_at)} – ${T.time(bk.ends_at)}`), h('span', { class: 'what' }, `${bk.service}${bk.addons?.length ? ' + ' + bk.addons.join(' + ') : ''} · ${bk.staff}`)),
      h('p', {}, h('span', { class: 'status-pill ' + bk.status }, label), '  ', h('span', { class: 'muted' }, `Hi ${bk.first_name}.`)),
    ];
    const msg = h('div', { role: 'status' });
    const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); openManage(token); } catch (e) { msg.replaceChildren(h('div', { class: 'err' }, e.message)); } };
    if (bk.can_confirm) view.push(h('button', { class: 'btn gold block', type: 'button', onclick: () => act(() => LC.rpc('confirm_booking', { p_token: token }), 'Confirmed. See you then!') }, icon('check'), 'Confirm I\'ll be there'));
    if (bk.can_cancel) {
      const reason = h('input', { id: 'cReason', placeholder: 'Reason (optional)', maxlength: '300' });
      const confirmRow = h('div', { class: 'field', hidden: true }, h('label', { for: 'cReason' }, 'Cancel this appointment?'), reason,
        h('div', { class: 'done-actions', style: 'justify-content:flex-start' }, h('button', { class: 'btn ink', type: 'button', onclick: () => act(() => LC.rpc('cancel_booking', { p_token: token, p_reason: reason.value }), 'Cancelled') }, 'Yes, cancel it'), h('button', { class: 'btn ghost-dark', type: 'button', onclick: () => { confirmRow.hidden = true; } }, 'Keep it')));
      view.push(h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => { confirmRow.hidden = false; reason.focus(); } }, 'Cancel appointment'), confirmRow);
    } else if (['booked', 'confirmed'].includes(bk.status)) view.push(h('p', { class: 'muted small' }, 'It\'s too close to your appointment to cancel online. Please text (571) 599-9297.'));
    if (bk.can_review) {
      let rating = 5; const stars = h('div', { class: 'star-pick', role: 'radiogroup', 'aria-label': 'Rating' });
      const paint = () => [...stars.children].forEach((b, i) => { b.classList.toggle('on', i < rating); b.setAttribute('aria-checked', String(i + 1 === rating)); });
      for (let i = 1; i <= 5; i++) stars.append(h('button', { type: 'button', role: 'radio', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, onclick: () => { rating = i; paint(); } }, icon('star')));
      paint();
      const text = h('textarea', { id: 'rvBody', maxlength: '1000', placeholder: 'How was your cut?' });
      const nm = h('input', { id: 'rvName', maxlength: '40', value: bk.first_name || '' });
      view.push(h('p', { class: 'opt-label' }, 'Leave a review'), stars, h('div', { class: 'field' }, h('label', { for: 'rvBody' }, 'Your review'), text), h('div', { class: 'field' }, h('label', { for: 'rvName' }, 'Name to show'), nm),
        h('button', { class: 'btn gold block', type: 'button', onclick: () => act(() => LC.rpc('submit_review', { p_token: token, p_rating: rating, p_body: text.value, p_display_name: nm.value }), 'Thanks! Your review will show up once Miguel approves it.') }, 'Post review'));
    }
    if (bk.reviewed) view.push(h('p', { class: 'muted' }, 'Thanks for your review!'));
    view.push(msg, h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => { sheet.close(); openBooking(); } }, icon('cal'), 'Book another cut'));
    body.replaceChildren(h('div', { class: 'step-anim' }, view));
  }
  function checkHash() { const m = location.hash.match(/^#manage-([0-9a-f-]{36})$/i); if (m) openManage(m[1]); }
  addEventListener('hashchange', checkHash);
  $('#findBooking').addEventListener('click', () => {
    B.step = 9; sheet.showModal(); header('Find my booking', 'Manage', 100); $('#sheetFoot').hidden = true; backBtn.hidden = true;
    const inp = h('input', { id: 'findLink', placeholder: 'Paste your booking link' });
    body.replaceChildren(h('div', { class: 'step-anim' }, h('p', { class: 'muted' }, 'Your booking link was shown when you booked and is in the confirmation text from Miguel.'), h('div', { class: 'field' }, h('label', { for: 'findLink' }, 'Booking link'), inp),
      h('button', { class: 'btn gold block', type: 'button', onclick: () => { const m = inp.value.match(/manage-([0-9a-f-]{36})/i); if (m) openManage(m[1]); else toast('That link doesn\'t look right'); } }, 'Open booking'),
      h('p', { class: 'muted small' }, 'Lost it? Text (571) 599-9297.')));
  });

  // ---------------- Load ----------------
  async function load() {
    try {
      const [settings, services, staff, reviews, portfolio] = await Promise.all([
        LC.rpc('get_public_settings'),
        LC.list('services', { eq: { active: true }, order: 'sort' }),
        LC.list('staff', { eq: { active: true, accepts_online: true }, order: 'sort' }),
        LC.list('reviews', { eq: { status: 'published' }, order: 'created_at', asc: false }),
        LC.list('portfolio_items', { eq: { published: true }, order: 'sort' }),
      ]);
      Object.assign(state, { settings, services, staff, reviews, portfolio });
      if (settings?.timezone) T.tz = settings.timezone;
      renderGallery(); renderReviews(); renderPrices(); nextOpening(); setupReveal(); checkHash();
    } catch (e) {
      console.error(e);
      $('#nextWhen').textContent = 'Text to book'; $('#nextSub').textContent = '(571) 599-9297';
      toast('Online booking is having trouble. Text (571) 599-9297 to book.');
      setupReveal();
    }
  }
  LC.onData(t => { if (t === '*' || t === 'appointments') nextOpening(); });
  load();
})();
