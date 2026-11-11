/* Lopezcuts public site: portfolio, prices, reviews, live next opening, booking sheet. */
(function () {
  'use strict';
  const { T, money, fmtPhone } = LC;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // Years of experience: started in 2022, goes up by one every January 1st (Salt Lake time).
  const STARTED = 2022;
  const yearsCutting = (+new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric' }).format(new Date())) - STARTED;
  $$('[data-years]').forEach(el => { if ('count' in el.dataset) { el.dataset.count = yearsCutting; el.textContent = yearsCutting + (el.dataset.suffix || ''); } else el.textContent = yearsCutting; });
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
  // Section headlines slide up word by word as they come into view.
  function setupHeadlines() {
    if (reduced || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('go'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    $$('main section h2').forEach(h2 => {
      if (h2.closest('.hero') || h2.getBoundingClientRect().top < innerHeight) return;
      let n = 0; const walk = node => [...node.childNodes].forEach(c => {
        if (c.nodeType === 3) { const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(t => { if (!t) return; if (/^\s+$/.test(t)) { frag.append(t); return; }
            const w = document.createElement('span'); w.className = 'w'; const inner = document.createElement('span'); inner.textContent = t; inner.style.setProperty('--i', n++); w.append(inner); frag.append(w); });
          c.replaceWith(frag); }
        else if (c.nodeType === 1) walk(c); });
      walk(h2); h2.classList.add('split'); io.observe(h2);
    });
  }
  // A soft gold light follows the pointer across cards (desktop only).
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointermove', e => { const c = e.target.closest?.('.fit-card, .price-card, .review'); if (!c) return;
      const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); }, { passive: true });
  }
  // Barber-pole progress bar along the top as you scroll.
  { const bar = h('div', { class: 'pole-bar', 'aria-hidden': 'true' }); document.body.append(bar); let tick = false;
    const upd = () => { tick = false; const max = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`; };
    addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true }); upd(); }
  function countUp(root) {
    $$('[data-count]', root).forEach(el => {
      const to = +el.dataset.count, suf = el.dataset.suffix || '', plain = 'plain' in el.dataset; const from = plain ? to - 6 : 0; const t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / 1100); const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); el.textContent = v + suf; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ---------------- Portfolio ----------------
  const LOOKS = ['Fades', 'Tapers', 'Lineups', 'Curly', 'Beards'];
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
  // Photos are grouped into boxes by their category. The first photo (lowest sort) is the cover;
  // tapping a box opens all of its photos. Tiles without a photo only show while there are no real photos.
  function galleryBoxes() {
    const withImg = state.portfolio.filter(p => p.image_url);
    if (!withImg.length) return state.portfolio.map(p => ({ title: p.title, desc: p.description, photos: [], ph: p }));
    const map = new Map();
    withImg.slice().sort((x, y) => (x.sort || 0) - (y.sort || 0)).forEach(p => {
      const key = (p.category || p.title || 'Cuts').trim();
      if (!map.has(key)) map.set(key, { title: key, photos: [] });
      map.get(key).photos.push(p);
    });
    return [...map.values()];
  }
  // One category at a time: chips on top pick the box, the strip auto-advances through that box,
  // then moves on to the next box. Photos never mix between categories.
  let carTimer = null;
  function renderGallery() {
    const boxes = galleryBoxes(), real = boxes.filter(b => b.photos.length);
    $('#placeholderNote').hidden = !!real.length || !boxes.length;
    if (!real.length) {
      $('#gallery').className = 'gallery';
      $('#gallery').replaceChildren(...boxes.map((b, i) => h('button', { class: 'tile', type: 'button', 'aria-label': `${b.title} (placeholder)`, onclick: () => openLightbox(b, i) }, placeholderArt(i), icon('scissors', 'scissor'), h('span', { class: 'badge' }, 'Placeholder'), h('span', { class: 'cap' }, h('b', {}, b.title)))));
      return;
    }
    // Smooth nonstop glide: the strip drifts left at a steady speed, looping through one category.
    // After a full loop it fades into the next category. Hover slows it to a stop; fingers can drag it.
    let cur = -1, swapT = 0, swapN = 0, setW = 0, x = 0, v = 0, loops = 0, last = 0, raf = 0, drag = null, moved = 0, nudge = null;
    let visible = false, hovering = false, resumeAt = 0;
    const phone = matchMedia('(max-width: 600px)').matches;
    const SPEED = phone ? 42 : 56; // pixels per second
    const chipEls = real.map((b, i) => h('button', { class: 'car-chip', type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => { show(i); } },
      h('span', {}, b.title), h('small', {}, String(b.photos.length)), h('i', { class: 'car-prog', 'aria-hidden': 'true' })));
    const chips = h('div', { class: 'car-chips', role: 'tablist', 'aria-label': 'Portfolio categories' }, chipEls);
    const row = h('div', { class: 'car-row' });
    const track = h('div', { class: 'car-track glide', 'aria-label': 'Portfolio photos' }, row);
    const card = (b, p, k, clone) => h('button', { class: 'car-card', type: 'button', tabindex: clone ? '-1' : '0', 'aria-hidden': clone ? 'true' : null, style: clone ? '' : `--d:${Math.min(k, 5) * 60}ms`, 'aria-label': `${b.title}, photo ${k + 1} of ${b.photos.length}`,
      onclick: e => { if (moved > 6) { e.preventDefault(); return; } LB = { box: b, i: k }; lbShow(); lb.showModal(); } },
      h('img', { src: p.image_url, alt: clone ? '' : `${b.title} by Lopez Cuts, barber in Salt Lake City`, loading: 'eager', decoding: 'async', draggable: 'false' }),
      h('span', { class: 'car-cap' }, h('b', {}, b.title), h('small', {}, `${k + 1}/${b.photos.length}`)));
    let lastP = -1;
    const place = () => { if (setW) { x = ((x % setW) + setW) % setW; } row.style.transform = `translate3d(${(-x).toFixed(2)}px,0,0)`;
      const c = chipEls[cur]; if (c && setW) { const pr = Math.round(Math.min(1, (loops * setW + x) / setW) * 200) / 200; if (pr !== lastP) { lastP = pr; c.style.setProperty('--p', pr); } } };
    // Decode the next category's photos before swapping so the switch never stutters or flashes.
    const preload = b => Promise.race([Promise.all(b.photos.slice(0, 8).map(p => { const im = new Image(); im.decoding = 'async'; im.src = p.image_url; return (im.decode ? im.decode() : Promise.resolve()).catch(() => { }); })), new Promise(res => setTimeout(res, 900))]);
    function build() {
      const b = real[cur]; const base = b.photos.map((p, k) => card(b, p, k, false));
      row.replaceChildren(...base);
      const gap = 14, cw = base[0].getBoundingClientRect().width || 260;
      setW = (cw + gap) * base.length;
      // Add copies until the strip is long enough to loop with no gap.
      let copies = 0; while ((copies + 1) * setW < track.clientWidth + setW + cw) { copies++; b.photos.forEach((p, k) => row.append(card(b, p, k, true))); }
      x = 0; loops = 0; lastP = -1; place();
    }
    function show(i) {
      cur = (i + real.length) % real.length;
      chipEls.forEach((c, k) => { c.classList.toggle('on', k === cur); c.setAttribute('aria-selected', String(k === cur)); if (k !== cur) c.style.removeProperty('--p'); });
      const chip = chipEls[cur]; chips.scrollTo({ left: chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
      clearTimeout(swapT); const token = ++swapN; const first = !row.children.length;
      preload(real[cur]).then(() => {
        if (token !== swapN) return;
        if (first || reduced) { build(); return; }
        track.classList.add('swap');
        swapT = setTimeout(() => { build(); requestAnimationFrame(() => track.classList.remove('swap')); resumeAt = performance.now() + 500; }, 380);
      });
    }
    const stepBy = dir => { const c = row.querySelector('.car-card'); const w = c ? c.getBoundingClientRect().width + 14 : 280;
      if (reduced) { x += dir * w; place(); return; }
      nudge = { from: x, to: x + dir * w, t0: performance.now() }; resumeAt = performance.now() + 2500; };
    function frame(now) {
      raf = 0; const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (nudge) { const k = Math.min(1, (now - nudge.t0) / 450), e = 1 - Math.pow(1 - k, 3); x = nudge.from + (nudge.to - nudge.from) * e; if (k >= 1) nudge = null; v = 0; }
      else if (!drag) {
        const target = hovering || now < resumeAt || reduced ? 0 : SPEED;
        const k = Math.abs(v) > SPEED * 1.5 ? 2.2 : 1.6; // friction for flings, softer ease for cruising
        v += (target - v) * (1 - Math.exp(-dt * k)); // frame-rate independent ease
        const before = x; x += v * dt;
        if (setW && x >= setW) { loops++; }
        if (setW && before < setW && x >= setW && loops >= 1 && real.length > 1) { place(); show(cur + 1); }
      }
      place();
      if (visible && !document.hidden && !lb.open) raf = requestAnimationFrame(frame); else last = 0;
    }
    const kick = () => { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } };
    // Drag / swipe
    track.addEventListener('pointerdown', e => { drag = { x0: e.clientX, y0: e.clientY, start: x, id: e.pointerId, lock: null, samples: [[performance.now(), x]] }; moved = 0; nudge = null; });
    track.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (drag.lock == null && Math.abs(dx) + Math.abs(dy) > 6) drag.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.lock === 'x') { moved = Math.abs(dx); x = drag.start - dx; place(); const t = performance.now(); drag.samples.push([t, x]); while (drag.samples.length > 2 && t - drag.samples[0][0] > 100) drag.samples.shift(); if (e.pointerType !== 'touch') track.setPointerCapture?.(drag.id); }
      if (drag.lock === 'y') drag = null; });
    const endDrag = () => { if (!drag) return;
      // Keep the swipe's momentum and let it glide down smoothly instead of stopping dead.
      const sm = drag.samples, a = sm[0], b = sm[sm.length - 1], dtS = (b[0] - a[0]) / 1000;
      const fling = drag.lock === 'x' && dtS > 0.01 && performance.now() - b[0] < 80 ? (b[1] - a[1]) / dtS : 0;
      drag = null; v = Math.max(-2600, Math.min(2600, fling)); resumeAt = performance.now() + (Math.abs(v) > 200 ? 900 : 1400); kick(); };
    // Trackpad / shift-wheel side scrolling moves the strip too.
    track.addEventListener('wheel', e => { if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; e.preventDefault(); nudge = null; x += e.deltaX; v = 0; resumeAt = performance.now() + 1200; place(); kick(); }, { passive: false });
    ['pointerup', 'pointercancel'].forEach(ev => track.addEventListener(ev, endDrag));
    track.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hovering = true; });
    track.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hovering = false; endDrag(); kick(); });
    track.addEventListener('focusin', () => { hovering = true; });
    track.addEventListener('focusout', () => { hovering = false; kick(); });
    const wrap = h('div', { class: 'carousel' }, track,
      h('button', { class: 'icon-btn car-nav prev', type: 'button', 'aria-label': 'Previous photos', onclick: () => { stepBy(-1); kick(); } }, icon('back')),
      h('button', { class: 'icon-btn car-nav next', type: 'button', 'aria-label': 'Next photos', onclick: () => { stepBy(1); kick(); } }, icon('arrow')));
    $('#gallery').className = 'gallery-car';
    $('#gallery').replaceChildren(chips, wrap);
    show(0);
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(wrap); else { visible = true; kick(); }
    document.addEventListener('visibilitychange', kick);
    lb.addEventListener('close', kick);
    let rw = innerWidth; addEventListener('resize', () => { if (Math.abs(innerWidth - rw) > 40) { rw = innerWidth; build(); } });
    clearInterval(carTimer);
  }
  const lb = $('#lightbox'); let LB = { box: null, i: 0 };
  function lbShow() {
    const { box, i } = LB, p = box.photos[i];
    $('#lbMedia').replaceChildren(h('img', { src: p.image_url, alt: `${box.title}, photo ${i + 1}` }),
      box.photos.length > 1 ? h('button', { class: 'icon-btn lb-nav prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => lbStep(-1) }, icon('back')) : null,
      box.photos.length > 1 ? h('button', { class: 'icon-btn lb-nav next', type: 'button', 'aria-label': 'Next photo', onclick: () => lbStep(1) }, icon('arrow')) : null);
    const label = LB.labels ? LB.labels[i] : box.title;
    $('#lbCap').textContent = box.photos.length > 1 ? `${label} · ${i + 1} of ${box.photos.length}` : label;
    const nx = box.photos[(i + 1) % box.photos.length]; if (nx) { const pre = new Image(); pre.src = nx.image_url; }
  }
  function lbStep(d) { const n = LB.box.photos.length; LB.i = (LB.i + d + n) % n; lbShow(); }
  function openLightbox(box, idx) {
    if (!box.photos.length) {
      $('#lbMedia').replaceChildren(placeholderArt(idx), h('div', { class: 'lb-ph-text' }, h('div', {}, h('b', {}, box.title), 'Placeholder tile. Real photo coming soon.')));
      $('#lbCap').textContent = box.title; lb.showModal(); return;
    }
    LB = { box, i: 0 }; lbShow(); lb.showModal();
  }
  lb.addEventListener('keydown', e => { if (!LB.box || LB.box.photos.length < 2) return; if (e.key === 'ArrowRight') lbStep(1); if (e.key === 'ArrowLeft') lbStep(-1); });
  let tx = null;
  lb.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => { if (tx == null || !LB.box || LB.box.photos.length < 2) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 40) lbStep(dx < 0 ? 1 : -1); });
  $('#lbClose').addEventListener('click', () => lb.close());
  lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });

  // ---------------- Reviews ----------------
  function renderReviews() {
    const withText = state.reviews.filter(r => (r.body || '').trim());
    const list = state.showAllReviews ? withText : withText.slice(0, 6);
    const more = $('#moreReviews');
    if (more) { more.hidden = withText.length <= 6; more.textContent = state.showAllReviews ? 'Show fewer' : `See all ${withText.length} reviews`; more.onclick = () => { state.showAllReviews = !state.showAllReviews; renderReviews(); if (!state.showAllReviews) $('#reviews').scrollIntoView({ behavior: 'smooth' }); }; }
    $('#reviewList').replaceChildren(...list.map(r => h('article', { class: 'review', 'data-reveal': '' },
      h('span', { class: 'stars', 'aria-label': `${r.rating} out of 5 stars` }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)),
      h('q', {}, r.body),
      r.reply ? h('p', { class: 'reply' }, 'Miguel: ' + r.reply) : null,
      h('div', { class: 'who' }, h('span', { class: 'av', 'aria-hidden': 'true' }, (r.display_name || 'C')[0]), h('span', {}, h('b', {}, r.display_name), h('br'), h('span', { class: 'src' }, [r.label, r.created_at ? T.date(r.created_at, { month: 'short', year: 'numeric' }) : '', r.source === 'booksy' ? 'via Booksy' : 'via Lopezcuts'].filter(Boolean).join(' · ')))))));
    const s = state.settings; if (!s) return;
    const site = state.reviews.filter(r => r.source === 'site');
    const count = (+s.booksy_review_count || 0) + site.length;
    const avg = count ? (((+s.booksy_rating || 5) * (+s.booksy_review_count || 0)) + site.reduce((t, r) => t + r.rating, 0)) / count : 5;
    $('#ratingBadge .rating-n').textContent = avg.toFixed(1);
    $('#ratingCount').textContent = site.length ? `${count} reviews (Booksy + Lopezcuts)` : `${count} reviews on Booksy`;
    $('#heroRating').textContent = `${avg.toFixed(1)} · ${count} reviews`;
    const ha = $('#heroAvg'); if (ha) ha.textContent = avg.toFixed(1);
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
    }
    if (home) {
      const hp = $('.ht-price'); if (hp) hp.textContent = `${money(home.price)} · up to ${home.duration_min} min`;
      const hb = $('#homeBook'); if (hb) { hb.dataset.svc = home.id; hb.textContent = 'Book a hometown cut'; }
      $$('[data-home]').forEach(x => { x.dataset.svc = home.id; });
    }
    const adds = state.services.filter(s => s.is_addon && s.active);
    if (adds.length) $('.addon-list').replaceChildren(...adds.map(a => h('li', {}, h('span', {}, a.name), h('b', {}, '+' + money(a.price)))));
  }

  // ---------------- Booksy notice + fully booked ----------------
  // Until Thanksgiving 2026, clients still book on Booksy. From Nov 27 (Salt Lake time) this goes away on its own.
  const BOOKSY_UNTIL = '2026-11-27', BOOKSY_URL = 'https://lopezcuts140.booksy.com/k';
  const onBooksy = () => T.today() < BOOKSY_UNTIL;
  const IG = 'https://instagram.com/lopezcuts.dmv';
  function showNotice() {
    const n = $('#siteNotice'); if (!n) return;
    const parts = [];
    if (onBooksy()) parts.push(h('span', {}, h('b', {}, 'Booking through Booksy until Thanksgiving.'), ' ', h('a', { href: BOOKSY_URL, target: '_blank', rel: 'noopener' }, 'Book on Booksy')));
    else if (state.full) parts.push(h('span', {}, h('b', {}, 'No open times right now.'), ' Text Miguel or ', h('a', { href: IG, target: '_blank', rel: 'noopener' }, 'DM @lopezcuts.dmv'), ' to get on the list.'));
    n.hidden = !parts.length; n.replaceChildren(...parts);
  }
  // When nothing is open, every booking button says Fully booked and can't be tapped.
  function setFull(on) {
    state.full = on; document.body.classList.toggle('is-full', on);
    const st = $('#seeTimes'); if (st) st.hidden = on;  // only shown when there are open times
    $$('[data-book]').forEach(b => {
      if (on) {
        if (!('origHtml' in b.dataset)) b.dataset.origHtml = b.innerHTML;
        b.setAttribute('aria-disabled', 'true'); b.tabIndex = -1; if (b.tagName === 'BUTTON') b.disabled = true;
        if (b.classList.contains('fit-row')) { const p = b.querySelector('.fit-p'); if (p) p.textContent = 'Fully booked'; }
        else if (b.classList.contains('btn') || b.classList.contains('link-btn')) b.textContent = 'Fully booked';
      } else if ('origHtml' in b.dataset) {
        b.innerHTML = b.dataset.origHtml; delete b.dataset.origHtml; b.removeAttribute('aria-disabled'); b.removeAttribute('tabindex'); if (b.tagName === 'BUTTON') b.disabled = false;
      }
    });
    showNotice();
  }
  document.addEventListener('click', e => { if (state.full && e.target.closest('[data-book]')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // ---------------- Next opening ----------------
  async function nextOpening() {
    const staff = state.staff[0]; const cut = state.services.find(s => !s.is_addon && s.bookable);
    showNotice();
    if (!staff || !cut) return;
    const noTimes = () => {
      setFull(true); window.LC_NEXT = { full: true }; dispatchEvent(new CustomEvent('lc:next', { detail: window.LC_NEXT }));
      if (onBooksy()) { $('#nextWhen').textContent = 'Booking on Booksy'; $('#nextSub').replaceChildren('Until Thanksgiving. ', h('a', { href: BOOKSY_URL, target: '_blank', rel: 'noopener' }, 'Book on Booksy')); }
      else { $('#nextWhen').textContent = 'No open times right now'; $('#nextSub').replaceChildren('Text Miguel or ', h('a', { href: IG, target: '_blank', rel: 'noopener' }, 'DM @lopezcuts.dmv'), ' to get on the list'); }
    };
    if (state.settings && !state.settings.booking_open) { noTimes(); return; }
    try {
      const days = await LC.rpc('get_open_days', { p_staff_id: staff.id, p_from: T.today(), p_days: Math.min(90, +state.settings?.booking_window_days || 90), p_duration: cut.duration_min });
      const d = days.find(x => x.openings > 0);
      if (!d) { noTimes(); return; }
      setFull(false);
      const slots = await LC.rpc('get_available_slots', { p_staff_id: staff.id, p_day: d.day, p_duration: cut.duration_min });
      const s = slots[0]; if (!s) return;
      const rel = d.day === T.today() ? 'Today' : d.day === T.addDays(T.today(), 1) ? 'Tomorrow' : T.dayLabel(d.day, { weekday: 'long' });
      const date = rel === 'Today' || rel === 'Tomorrow' ? `${rel}, ${T.dayLabel(d.day, { month: 'short', day: 'numeric' })}` : T.dayLabel(d.day, { weekday: 'short', month: 'short', day: 'numeric' });
      $('#nextWhen').replaceChildren(h('small', {}, date), h('em', {}, T.time(s)));
      const left = `${d.openings} ${d.openings === 1 ? 'spot' : 'spots'} left that day`;
      const sub = $('#nextSub'), cd = h('b', {}); sub.replaceChildren('Opens in ', cd, ' · ' + left);
      const at = new Date(s).getTime();
      const tick = () => { const ms = at - Date.now(); if (ms <= 0) { cd.textContent = 'now'; return; }
        const dd = Math.floor(ms / 864e5), hh = Math.floor(ms % 864e5 / 36e5), mm = Math.floor(ms % 36e5 / 6e4), ss = Math.floor(ms % 6e4 / 1e3);
        const th = dd * 24 + hh; cd.textContent = th >= 48 ? `${dd} days` : th ? `${th}h ${String(mm).padStart(2, '0')}m` : `${mm}m ${String(ss).padStart(2, '0')}s`; };
      tick(); clearInterval(nextOpening.t); nextOpening.t = setInterval(tick, 1000);
      const btn = $('#nextBtn'); btn.dataset.slot = s; btn.dataset.day = d.day;
      window.LC_NEXT = { at: s, when: rel, time: T.time(s) }; dispatchEvent(new CustomEvent('lc:next', { detail: window.LC_NEXT }));
      btn.replaceChildren(`Grab ${T.time(s)}`, icon('arrow'));
    } catch (e) { $('#nextWhen').textContent = 'Book online'; $('#nextSub').textContent = 'See all open times'; }
  }

  // =====================================================================
  //  Booking sheet
  // =====================================================================
  const sheet = $('#sheet'), body = $('#sheetBody'), nextBtn = $('#sheetNext'), backBtn = $('#sheetBack');
  const B = { step: 0, serviceId: null, addons: new Set(), staffId: null, day: null, slot: null, days: [], slots: null, form: { name: '', phone: '', email: '', note: '', remember: true }, result: null, error: '' };
  // "How did you find me?" Links like lopezcuts.com/?src=ig (Instagram bio) or ?src=flyer (QR code) pre-fill the answer.
  const FOUND = [['instagram', 'Instagram'], ['friend', 'A friend told me'], ['snapchat', 'Snapchat'], ['tiktok', 'TikTok'], ['google', 'Google search'], ['flyer', 'Flyer or QR code'], ['booksy', 'Booksy'], ['other', 'Something else']];
  const SRC_ALIAS = { ig: 'instagram', insta: 'instagram', instagram: 'instagram', friend: 'friend', ref: 'friend', referral: 'friend', snap: 'snapchat', snapchat: 'snapchat', tiktok: 'tiktok', tt: 'tiktok', google: 'google', gbp: 'google', maps: 'google', qr: 'flyer', flyer: 'flyer', poster: 'flyer', booksy: 'booksy' };
  try {
    const qs = new URLSearchParams(location.search); const raw = String(qs.get('src') || qs.get('utm_source') || '').toLowerCase();
    if (SRC_ALIAS[raw]) sessionStorage.setItem('lopezcuts-src', SRC_ALIAS[raw]);
    B.form.found = sessionStorage.getItem('lopezcuts-src') || '';
  } catch { B.form.found = ''; }
  const STEPS = ['Choose your service', 'Pick a time', 'Your details', 'You\'re booked'];
  const svc = () => state.services.find(s => s.id === B.serviceId);
  const addonList = () => state.services.filter(s => s.is_addon && s.active && s.bookable);
  const duration = () => (svc()?.duration_min || 40) + addonList().filter(a => B.addons.has(a.id)).reduce((t, a) => t + a.duration_min, 0);
  const addonsPrice = () => addonList().filter(a => B.addons.has(a.id)).reduce((t, a) => t + +a.price, 0);

  try { const saved = JSON.parse(localStorage.getItem('lopezcuts-me') || 'null'); if (saved) Object.assign(B.form, saved); } catch { }
  // Returning on the same device: details are already filled in, so the last step shows a short "Welcome back" card instead of the form.
  const validEmail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());
  const knownClient = () => B.form.name.trim().length >= 2 && !!LC.normPhone(B.form.phone) && validEmail(B.form.email);
  B.known = knownClient(); B.editMe = false;
  // Reference photo: picked on /portfolio ("Use as my reference") or inside the booking sheet.
  // It rides along in the booking note as "Reference photo: <url>", and the owner dashboard shows the picture.
  const readRef = () => { try { const r = JSON.parse(localStorage.getItem('lopezcuts-ref') || 'null'); return r && r.url ? r : null; } catch { return null; } };
  const saveRef = r => { B.ref = r; try { r ? localStorage.setItem('lopezcuts-ref', JSON.stringify(r)) : localStorage.removeItem('lopezcuts-ref'); } catch { } };
  B.ref = readRef(); B.picking = false; B.pickCat = 'All';
  const absUrl = u => { try { return new URL(u, location.origin).href; } catch { return u; } };

  function openBooking(opts = {}) {
    if (!state.services.length) { toast('Loading services, try again in a second'); return; }
    const mains = state.services.filter(s => !s.is_addon && s.bookable && s.active);
    // People who booked from this phone before start on the returning option; everyone else on first time.
    const pick = B.form.phone ? mains.find(s => !s.first_visit_only && !/hometown/i.test(s.name)) : mains.find(s => s.first_visit_only);
    if (opts.serviceId) { B.serviceId = opts.serviceId; B.slot = null; }
    B.serviceId = B.serviceId || (pick || mains[0])?.id;
    B.staffId = B.staffId || state.staff[0]?.id;
    B.error = ''; B.result = null; B.step = 0; B.picking = false; B.ref = readRef() || B.ref;
    if (opts.day && opts.slot) { B.day = opts.day; B.slot = opts.slot; }
    sheet.showModal(); render();
    if (opts.day && opts.slot) go(1);
  }
  $$('[data-book]').forEach(b => b.addEventListener('click', e => { if (b.id === 'homeBook' && !b.dataset.svc) return; if ('home' in b.dataset && !b.dataset.svc) { e.preventDefault(); document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' }); return; } e.preventDefault(); openBooking(b.dataset.slot ? { day: b.dataset.day, slot: b.dataset.slot } : b.dataset.svc ? { serviceId: b.dataset.svc } : {}); }));
  $('#sheetClose').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  sheet.addEventListener('close', () => { if (location.hash.startsWith('#manage-') || location.hash === '#book' || location.hash === '#appointment') history.replaceState(null, '', location.pathname + location.search); });
  backBtn.addEventListener('click', () => go(B.step - 1));
  nextBtn.addEventListener('click', () => next());

  function go(step) { B.step = Math.max(0, step); B.error = ''; render(); body.scrollTop = 0; if (B.step === 1) loadDays(); }

  function header(title, stepTxt, pct) {
    $('#sheetTitle').textContent = title; $('#sheetStep').textContent = stepTxt; $('#progressBar').style.width = pct + '%';
  }
  function render() {
    const s = B.step;
    backBtn.hidden = !(s === 1 || s === 2);
    $('#sheetFoot').hidden = s === 3 || s === 9 || (s === 2 && B.picking);
    header(s === 2 && B.picking ? 'Pick your reference' : (STEPS[s] || 'Your booking'), s < 3 ? `Step ${s + 1} of 3` : (s === 3 ? 'Confirmed' : 'Manage'), s < 3 ? (s + 1) * 33.4 : 100);
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
      B.ref ? h('div', { class: 'ref-box', style: 'margin-bottom:12px' }, h('div', { class: 'ref-row' }, h('img', { src: B.ref.url, alt: '' }), h('div', {}, h('b', {}, 'Reference added'), h('span', { class: 'muted small' }, `${B.ref.cat || 'Your pick'}. You can change it on the last step.`)))) : null,
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
      h('span', { class: 'dw' }, d.day === T.today() ? 'Today' : T.dayLabel(d.day, { weekday: 'short' })), h('span', { class: 'dn' }, T.dayLabel(d.day, { day: 'numeric' })), h('span', { class: 'do' }, d.openings ? `${d.openings} open` : 'No times'))))
      : h('div', { class: 'days' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: 'width:70px;height:84px;flex:none' }))));
    if (!B.days.length) return out;
    if (!B.day) { out.push(h('div', { class: 'empty-slots' }, 'No openings in the next few weeks. DM @lopezcuts.dmv on Instagram and Miguel will try to fit you in.')); return out; }
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
  function refField() {
    const pick = () => { B.picking = true; render(); body.scrollTop = 0; };
    if (B.ref) return h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Reference photo'),
      h('div', { class: 'ref-box' }, h('div', { class: 'ref-row' }, h('img', { src: B.ref.url, alt: `Reference: ${B.ref.cat || 'haircut'}` }), h('div', {}, h('b', {}, B.ref.cat || 'Your reference'), h('span', { class: 'muted small' }, 'Miguel will see this photo with your booking.'))),
        h('div', { class: 'ref-tools' }, h('button', { class: 'btn sm', type: 'button', onclick: pick }, 'Change'), h('button', { class: 'btn sm', type: 'button', onclick: () => { saveRef(null); render(); } }, 'Remove'))));
    return h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Reference photo (recommended)'),
      h('div', { class: 'ref-box' }, h('span', { class: 'muted small' }, 'Got a cut in mind? Pick one from Miguel\'s portfolio so he knows exactly what you want. You can also bring or text your own pic.'),
        h('div', { class: 'ref-tools' }, (state.portfolioAll || []).length ? h('button', { class: 'btn gold sm', type: 'button', onclick: pick }, 'Pick from portfolio') : null)));
  }
  function stepPick() {
    const all = state.portfolioAll || [];
    const cat = p => (p.category || p.title || 'Cuts').trim();
    const cats = ['All', ...new Set(all.map(cat))];
    const list = (B.pickCat === 'All' ? all : all.filter(p => cat(p) === B.pickCat)).slice().sort((a, b) => (new Date(b.created_at || 0) - new Date(a.created_at || 0)) || ((b.sort || 0) - (a.sort || 0)));
    return h('div', { class: 'ref-pick' },
      h('p', { class: 'muted small', style: 'margin:0' }, 'Tap the cut you want. Newest first.'),
      h('div', { class: 'ref-chips', role: 'group', 'aria-label': 'Filter by cut' }, cats.map(c => h('button', { type: 'button', 'aria-pressed': String(B.pickCat === c), onclick: () => { B.pickCat = c; render(); } }, c))),
      h('div', { class: 'ref-grid' }, list.map(p => h('button', { type: 'button', 'aria-pressed': String(B.ref?.url === absUrl(p.image_url)), 'aria-label': `Use this ${cat(p)} as my reference`, onclick: () => { saveRef({ id: p.id, url: absUrl(p.image_url), cat: cat(p) }); B.picking = false; render(); body.scrollTop = body.scrollHeight; } },
        h('img', { src: p.image_url, alt: cat(p), loading: 'lazy' })))),
      h('button', { class: 'btn sm', type: 'button', style: 'justify-self:start', onclick: () => { B.picking = false; render(); } }, 'Back to my details'));
  }
  function stepDetails() {
    if (B.picking) return stepPick();
    const f = B.form;
    const bind = (k) => e => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const short = B.known && !B.editMe && knownClient();
    const who = short
      ? [h('div', { class: 'welcome-back' },
          h('div', {}, h('b', {}, `Welcome back, ${f.name.trim().split(' ')[0]}!`), h('span', { class: 'muted small' }, [fmtPhone(LC.normPhone(f.phone)) || f.phone, f.email].filter(Boolean).join(' · '))),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { B.editMe = true; render(); $('#bName')?.focus(); } }, 'Not you? Edit'))]
      : [h('div', { class: 'field' }, h('label', { for: 'bName' }, 'Full name'), h('input', { id: 'bName', autocomplete: 'name', required: true, value: f.name, oninput: bind('name'), maxlength: '80' })),
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('label', { for: 'bPhone' }, 'Mobile number'), h('input', { id: 'bPhone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true, placeholder: '(801) 555-1234', value: f.phone, oninput: bind('phone') }), h('span', { class: 'hint' }, 'For your confirmation text. Never shared.')),
          h('div', { class: 'field' }, h('label', { for: 'bEmail' }, 'Email'), h('input', { id: 'bEmail', type: 'email', inputmode: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com', value: f.email, oninput: bind('email'), maxlength: '200' }), h('span', { class: 'hint' }, 'For your confirmation and reminder. Never shared.')))];
    return [
      B.error ? h('div', { class: 'err', role: 'alert' }, B.error) : null,
      ...who,
      refField(),
      h('div', { class: 'field' }, h('label', { for: 'bNote' }, 'Anything Miguel should know? (optional)'), h('textarea', { id: 'bNote', maxlength: '300', placeholder: 'Style you want, how short on the sides, first time, etc.', oninput: bind('note') }, f.note)),
      // Only asked on the First Time Haircut (most clients are regulars).
      svc().first_visit_only ? h('div', { class: 'field' }, h('label', { for: 'bFound' }, 'How did you find Miguel? (optional)'), h('select', { id: 'bFound', onchange: bind('found') }, h('option', { value: '' }, 'Pick one'), FOUND.map(([v, l]) => h('option', { value: v, selected: f.found === v }, l)))) : null,
      short ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'bRemember', checked: f.remember, onchange: bind('remember') }), 'Remember me on this device so booking is faster next time'),
      h('div', { class: 'summary' },
        h('div', { class: 'row' }, h('span', {}, 'When'), h('b', {}, `${T.dayLabel(B.day, { weekday: 'long', month: 'short', day: 'numeric' })}, ${T.time(B.slot)}`)),
        h('div', { class: 'row' }, h('span', {}, 'Service'), h('b', {}, svc().name + (B.addons.size ? ' + ' + addonList().filter(a => B.addons.has(a.id)).map(a => a.name).join(' + ') : ''))),
        h('div', { class: 'row' }, h('span', {}, 'Barber'), h('b', {}, (state.staff.find(s => s.id === B.staffId) || {}).display_name)),
        h('div', { class: 'row' }, h('span', {}, 'Price'), h('b', {}, svc().new_client_price != null ? `${money(+svc().new_client_price + addonsPrice())} if it's your first visit, ${money(+svc().price + addonsPrice())} if you've been before` : money(+svc().price + addonsPrice())))),
      h('p', { class: 'muted small' }, `Pay at your appointment. Need to cancel? Use your booking link up to ${state.settings?.cancel_cutoff_hours ?? 6} hours before, or reply to Miguel's text.`),
    ];
  }
  async function next() {
    if (B.step === 0) return go(1);
    if (B.step === 1) { if (B.slot) go(2); return; }
    if (B.step === 2) {
      const f = B.form;
      if (f.name.trim().length < 2) { B.error = 'Please enter your full name.'; B.editMe = true; render(); $('#bName')?.focus(); return; }
      if (!LC.normPhone(f.phone)) { B.error = 'Please enter a valid mobile number.'; B.editMe = true; render(); $('#bPhone')?.focus(); return; }
      if (!validEmail(f.email)) { B.error = f.email.trim() ? 'That email address doesn\'t look right.' : 'Please enter your email so we can send your confirmation.'; B.editMe = true; render(); $('#bEmail')?.focus(); return; }
      B.busy = true; nextBtn.disabled = true; nextBtn.textContent = 'Booking…';
      try {
        const r = await LC.rpc('book_appointment', { p_name: f.name.trim(), p_phone: f.phone, p_email: f.email.trim() || null, p_service_id: B.serviceId, p_addon_ids: [...B.addons], p_staff_id: B.staffId, p_starts_at: B.slot, p_note: (f.note.trim().slice(0, 300) + (B.ref ? `\nReference photo: ${B.ref.url}` : '')).trim().slice(0, 500) });
        try { if (f.remember) localStorage.setItem('lopezcuts-me', JSON.stringify({ name: f.name, phone: f.phone, email: f.email, remember: true })); else localStorage.removeItem('lopezcuts-me'); } catch { }
        if (f.found && svc().first_visit_only && r?.token) LC.rpc('set_heard_from', { p_token: r.token, p_heard_from: f.found }).catch(() => { });
        B.known = !!f.remember && knownClient(); B.editMe = false;
        rememberBooking(r); B.result = r; B.form.note = ''; saveRef(null); B.busy = false; go(3); nextOpening();
      } catch (e) {
        B.busy = false; B.error = e.message;
        if (/taken/i.test(e.message)) { B.slot = null; go(1); B.error = e.message; } else { if (/name|number|email/i.test(e.message)) B.editMe = true; render(); }
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
      h('p', { class: 'muted small' }, 'Save it to confirm, change your time, cancel or leave a review later. Forgot your time? Tap My appointment at the top of the site and enter your number and first name.'),
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
    if (!bk) { forgetBooking(token); }
    else if (['booked', 'confirmed', 'completed'].includes(bk.status) && bk.starts_at) rememberBooking({ token, starts_at: bk.starts_at, ends_at: bk.ends_at }, bk.reviewed ? { reviewed: true } : {});
    else forgetBooking(token);
    if (!bk) { body.replaceChildren(h('div', { class: 'err' }, 'We couldn\'t find that booking. Check the link or DM @lopezcuts.dmv on Instagram.')); return; }
    const label = { booked: 'Booked', confirmed: 'Confirmed', completed: 'Completed', no_show: 'Missed', cancelled: 'Cancelled' }[bk.status];
    const view = [
      h('div', { class: 'big-ticket' }, h('span', { class: 'price' }, money(bk.price)), h('span', { class: 'when' }, T.date(bk.starts_at, { weekday: 'long', month: 'short', day: 'numeric' })), h('span', { style: 'font:400 1.6rem/1 var(--display)' }, `${T.time(bk.starts_at)} – ${T.time(bk.ends_at)}`), h('span', { class: 'what' }, `${bk.service}${bk.addons?.length ? ' + ' + bk.addons.join(' + ') : ''} · ${bk.staff}`)),
      h('p', {}, h('span', { class: 'status-pill ' + bk.status }, label), '  ', h('span', { class: 'muted' }, `Hi ${bk.first_name}. ` + ({ cancelled: 'This appointment is cancelled. Nothing else to do.', completed: 'Thanks for coming in!', no_show: 'We missed you at this one.' }[bk.status] || 'You\'re all set.'))),
    ];
    const msg = h('div', { role: 'status' });
    const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); openManage(token); } catch (e) { msg.replaceChildren(h('div', { class: 'err' }, e.message)); } };
    if (bk.can_confirm) view.push(h('button', { class: 'btn gold block', type: 'button', onclick: () => act(() => LC.rpc('confirm_booking', { p_token: token }), 'Confirmed. See you then!') }, icon('check'), 'Confirm I\'ll be there'));
    if (bk.can_reschedule && bk.staff_id) view.push(h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => openReschedule(token, bk) }, icon('cal'), 'Change day or time'));
    if (bk.can_cancel) {
      const reason = h('input', { id: 'cReason', placeholder: 'Reason (optional)', maxlength: '300' });
      const confirmRow = h('div', { class: 'field', hidden: true }, h('label', { for: 'cReason' }, 'Cancel this appointment?'), reason,
        h('div', { class: 'done-actions', style: 'justify-content:flex-start' }, h('button', { class: 'btn ink', type: 'button', onclick: () => act(() => LC.rpc('cancel_booking', { p_token: token, p_reason: reason.value }), 'Cancelled') }, 'Yes, cancel it'), h('button', { class: 'btn ghost-dark', type: 'button', onclick: () => { confirmRow.hidden = true; } }, 'Keep it')));
      view.push(h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => { confirmRow.hidden = false; reason.focus(); } }, 'Cancel appointment'), confirmRow);
    } else if (['booked', 'confirmed'].includes(bk.status)) view.push(h('p', { class: 'muted small' }, 'It\'s too close to your appointment to cancel online. Please reply to Miguel\'s text.'));
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
  // Move a booking to another open time (same cutoff as cancelling).
  async function openReschedule(token, bk) {
    header('Change your time', 'Manage', 100); $('#sheetFoot').hidden = true; backBtn.hidden = true;
    const R = { days: [], day: null, slots: null, slot: null, busy: false, error: '' };
    const dur = +bk.duration_min || 40;
    const paint = () => {
      const out = [h('div', { class: 'big-ticket' }, h('span', { class: 'what' }, 'Current time'), h('span', { class: 'when' }, T.date(bk.starts_at, { weekday: 'long', month: 'short', day: 'numeric' })), h('span', { style: 'font:400 1.6rem/1 var(--display)' }, `${T.time(bk.starts_at)} – ${T.time(bk.ends_at)}`))];
      if (R.error) out.push(h('div', { class: 'err', role: 'alert' }, R.error));
      out.push(h('p', { class: 'opt-label' }, 'Pick a new day'));
      if (!R.days.length) out.push(h('div', { class: 'days' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: 'width:70px;height:84px;flex:none' }))));
      else {
        out.push(h('div', { class: 'days', role: 'group', 'aria-label': 'Choose a day' }, R.days.map(d => h('button', { class: 'day', type: 'button', disabled: !d.openings, 'aria-pressed': String(R.day === d.day), 'aria-label': `${T.dayLabel(d.day, { weekday: 'long', month: 'long', day: 'numeric' })}, ${d.openings ? d.openings + ' open' : 'no openings'}`, onclick: () => pickDay(d.day) },
          h('span', { class: 'dw' }, d.day === T.today() ? 'Today' : T.dayLabel(d.day, { weekday: 'short' })), h('span', { class: 'dn' }, T.dayLabel(d.day, { day: 'numeric' })), h('span', { class: 'do' }, d.openings ? `${d.openings} open` : 'No times')))));
        if (!R.day) out.push(h('div', { class: 'empty-slots' }, 'No other openings right now. DM @lopezcuts.dmv on Instagram and Miguel will try to fit you in.'));
        else if (!R.slots) out.push(h('div', { class: 'slots' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton' }))));
        else if (!R.slots.length) out.push(h('div', { class: 'empty-slots' }, 'That day just filled up. Try another day.'));
        else out.push(h('p', { class: 'opt-label' }, T.dayLabel(R.day, { weekday: 'long', month: 'long', day: 'numeric' })),
          h('div', { class: 'slots' }, R.slots.map(s => h('button', { class: 'slot', type: 'button', 'aria-pressed': String(R.slot === s), onclick: () => { R.slot = s; R.error = ''; paint(); } }, T.time(s)))));
      }
      out.push(h('button', { class: 'btn gold block', type: 'button', disabled: !R.slot || R.busy, onclick: save }, icon('check'), R.busy ? 'Moving…' : (R.slot ? `Move to ${T.dayLabel(R.day, { weekday: 'short', month: 'short', day: 'numeric' })} at ${T.time(R.slot)}` : 'Pick a new time')),
        h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => openManage(token) }, 'Keep my current time'));
      body.replaceChildren(h('div', { class: 'step-anim' }, out));
    };
    const pickDay = async day => {
      R.day = day; R.slot = null; R.slots = null; paint();
      try { const list = await LC.rpc('get_available_slots', { p_staff_id: bk.staff_id, p_day: day, p_duration: dur }); if (R.day === day) R.slots = (list || []).filter(s => +new Date(s) !== +new Date(bk.starts_at)); }
      catch (e) { R.slots = []; R.error = e.message; }
      paint();
    };
    const save = async () => {
      if (!R.slot || R.busy) return; R.busy = true; R.error = ''; paint();
      try {
        const nb = await LC.rpc('reschedule_booking', { p_token: token, p_starts_at: R.slot });
        if (nb && nb.starts_at) rememberBooking({ token, starts_at: nb.starts_at, ends_at: nb.ends_at });
        toast('Moved. See you then!'); nextOpening(); openManage(token);
      } catch (e) { R.busy = false; R.error = e.message || 'Something went wrong. Please try again.'; R.slot = null; if (R.day) pickDay(R.day); else paint(); }
    };
    paint();
    try {
      const days = await LC.rpc('get_open_days', { p_staff_id: bk.staff_id, p_from: T.today(), p_days: Math.min((+state.settings?.booking_window_days || 90) + 1, 93), p_duration: dur });
      R.days = (days || []).filter(d => d.openings || d.day >= T.today()).slice(0, 93);
      const first = R.days.find(d => d.openings);
      if (first) await pickDay(first.day); else paint();
    } catch (e) { R.error = e.message; R.days = [{ day: T.today(), openings: 0 }]; paint(); }
  }
  // This device remembers upcoming bookings so "My booking" in the top bar opens them.
  // Past visits stay for 60 days so the same device can leave a review.
  const allBookings = () => { try { return (JSON.parse(localStorage.getItem('lopezcuts-bookings') || '[]') || []).filter(b => b && b.token && new Date(b.ends_at || b.starts_at) > Date.now() - 60 * 864e5); } catch { return []; } };
  const savedBookings = () => allBookings().filter(b => !b.cancelled && new Date(b.ends_at || b.starts_at) > Date.now());
  const pastBookings = () => allBookings().filter(b => !b.cancelled && !b.reviewed && new Date(b.ends_at || b.starts_at) <= Date.now()).sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at));
  function saveBookings(list) { try { localStorage.setItem('lopezcuts-bookings', JSON.stringify(list.slice(-8))); } catch { } showMyBooking(); }
  function rememberBooking(r, extra = {}) { saveBookings([...allBookings().filter(b => b.token !== r.token), { token: r.token, starts_at: r.starts_at, ends_at: r.ends_at, ...extra }]); }
  function forgetBooking(token) { saveBookings(allBookings().filter(b => b.token !== token)); }
  function showMyBooking() { }  // the My appointment button is always shown; its sheet lists this device's bookings
  function checkHash() { if (location.hash === '#book') { openBooking(); return; } if (location.hash === '#appointment') { openLookup(); return; } const m = location.hash.match(/^#manage-([0-9a-f-]{36})$/i); if (m) openManage(m[1]); }
  addEventListener('hashchange', checkHash);
  // ---------------- My appointment (lookup) ----------------
  // Anyone can check their upcoming cut with the mobile number + first name they booked with.
  // It only shows the time (no booking link), so nobody can change someone else's booking.
  const ticket = (a, extra) => h('div', { class: 'big-ticket' },
    h('span', { class: 'when' }, T.date(a.starts_at, { weekday: 'long', month: 'short', day: 'numeric' })),
    h('span', { style: 'font:400 1.6rem/1 var(--display)' }, `${T.time(a.starts_at)} – ${T.time(a.ends_at)}`),
    h('span', { class: 'what' }, `${a.service || 'Haircut'}${a.addons?.length ? ' + ' + a.addons.join(' + ') : ''}${a.staff ? ' · ' + a.staff : ''}`), extra || null);
  function openLookup() {
    B.step = 9; if (!sheet.open) sheet.showModal(); header('My appointment', 'Look it up', 100); $('#sheetFoot').hidden = true; backBtn.hidden = true;
    if (location.hash !== '#appointment') history.replaceState(null, '', '#appointment');
    const saved = savedBookings().sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    const me = (() => { try { return JSON.parse(localStorage.getItem('lopezcuts-me') || 'null') || {}; } catch { return {}; } })();
    const ph = h('input', { id: 'luPhone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '(801) 555-1234', value: me.phone || '' });
    const nm = h('input', { id: 'luName', autocomplete: 'given-name', maxlength: '40', placeholder: 'e.g. Jordan', value: (me.name || '').split(' ')[0] });
    const out = h('div', { role: 'status', 'aria-live': 'polite', class: 'lookup-out' });
    const goLabel = h('span', {}, 'Find my appointment');
    const go = h('button', { class: 'btn gold block', type: 'submit' }, icon('cal'), goLabel);
    const form = h('form', { class: 'lookup-form', novalidate: true },
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'luPhone' }, 'Mobile number'), ph),
        h('div', { class: 'field' }, h('label', { for: 'luName' }, 'First name'), nm)),
      h('span', { class: 'hint' }, 'Use the number and first name you booked with.'), go);
    // Changing or cancelling needs the private link, which is only ever emailed to the address on the booking.
    const linkBtn = () => {
      const label = h('span', {}, 'Email me my change or cancel link');
      const btn = h('button', { class: 'btn ghost-dark block', type: 'button' }, icon('cal'), label);
      btn.addEventListener('click', async () => {
        btn.disabled = true; label.textContent = 'Sending…';
        try {
          const r = await LC.rpc('request_booking_link', { p_phone: ph.value, p_first_name: nm.value });
          if (r && r.sent) btn.replaceWith(h('div', { class: 'note-ok', role: 'status' }, 'Sent! Check your email for the link (and your spam folder). It can take a minute.'));
          else { btn.disabled = false; label.textContent = 'Email me my change or cancel link'; toast('We couldn\'t send it. Please DM @lopezcuts.dmv on Instagram.'); }
        } catch (err) { btn.replaceWith(h('div', { class: 'err', role: 'alert' }, err.message || 'Something went wrong. Please try again.')); }
      });
      return btn;
    };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!LC.normPhone(ph.value)) { toast('Please enter a valid mobile number'); ph.focus(); return; }
      if (nm.value.trim().length < 1) { toast('Please enter your first name'); nm.focus(); return; }
      go.disabled = true; goLabel.textContent = 'Looking…';
      try {
        const r = await LC.rpc('find_appointment', { p_phone: ph.value, p_first_name: nm.value });
        const list = (r && r.appointments) || [];
        if (!r || !r.found) out.replaceChildren(h('div', { class: 'err' }, 'We couldn\'t find a booking with that number and first name. Check for typos, or DM @lopezcuts.dmv on Instagram.', onBooksy() ? ' Booked through Booksy? Your time is in the Booksy app.' : ''));
        else if (!list.length) out.replaceChildren(h('p', { class: 'muted' }, `Hi ${r.first_name}! You don't have an upcoming appointment right now.`), h('button', { class: 'btn gold block', type: 'button', onclick: () => { sheet.close(); openBooking(); } }, icon('cal'), 'Book a cut'));
        else out.replaceChildren(h('p', {}, h('b', {}, `Hi ${r.first_name}! `), list.length > 1 ? `You have ${list.length} upcoming appointments.` : 'Here\'s your next appointment.'),
          ...list.flatMap(a => [ticket(a, h('span', { class: 'status-pill ' + a.status, style: 'justify-self:start;margin-top:6px' }, a.status === 'confirmed' ? 'Confirmed' : 'Booked')),
          ]),
          list.some(a => a.can_email) ? linkBtn() : null,
          h('p', { class: 'muted small' }, list.some(a => a.can_email)
            ? `Miguel texts you the address the morning of. To change or cancel, we email your private link to the address you booked with, so only you can make changes. You can do it up to ${state.settings?.cancel_cutoff_hours ?? 6} hours before.`
            : 'Miguel texts you the address the morning of. To cancel or change your time, use the link in your confirmation text or email, or DM @lopezcuts.dmv.'));
      } catch (err) { out.replaceChildren(h('div', { class: 'err' }, err.message || 'Something went wrong. Please try again.')); }
      go.disabled = false; goLabel.textContent = 'Find my appointment';
    });
    const link = h('input', { id: 'findLink', placeholder: 'Paste your booking link' });
    body.replaceChildren(h('div', { class: 'step-anim' },
      saved.length ? [h('p', { class: 'opt-label' }, 'Booked on this device'), ...saved.slice(0, 3).map(b => h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => openManage(b.token) }, icon('cal'), `${T.date(b.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} at ${T.time(b.starts_at)}`)), h('p', { class: 'opt-label' }, 'Or look it up')] : null,
      form, out,
      h('details', { class: 'lookup-link' }, h('summary', {}, 'Have your booking link? Paste it to confirm, change or cancel'),
        h('div', { class: 'field' }, h('label', { for: 'findLink' }, 'Booking link'), link),
        h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => { const m = link.value.match(/manage-([0-9a-f-]{36})/i); if (m) openManage(m[1]); else toast('That link doesn\'t look right'); } }, 'Open booking'))));
    if (!me.phone) setTimeout(() => ph.focus(), 50);
  }
  $$('[data-lookup]').forEach(b => b.addEventListener('click', openLookup));

  // ---------------- Leave a review ----------------
  function openReview() {
    const past = pastBookings();
    B.step = 9; sheet.showModal(); header('Leave a review', 'Reviews', 100); $('#sheetFoot').hidden = true; backBtn.hidden = true;
    let rating = 5; const stars = h('div', { class: 'star-pick', role: 'radiogroup', 'aria-label': 'Rating' });
    const paint = () => [...stars.children].forEach((b, i) => { b.classList.toggle('on', i < rating); b.setAttribute('aria-checked', String(i + 1 === rating)); });
    for (let i = 1; i <= 5; i++) stars.append(h('button', { type: 'button', role: 'radio', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, onclick: () => { rating = i; paint(); } }, icon('star')));
    paint();
    const text = h('textarea', { id: 'orBody', maxlength: '1000', placeholder: 'How was your cut?' });
    const nm = h('input', { id: 'orName', maxlength: '40', autocomplete: 'name', placeholder: 'e.g. Jordan M.' });
    const ph = h('input', { id: 'orPhone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: 'Optional' });
    const send = h('button', { class: 'btn gold block', type: 'button' }, icon('star'), 'Post review');
    send.onclick = async () => {
      if (nm.value.trim().length < 2) { toast('Please add your name'); nm.focus(); return; }
      send.disabled = true;
      try {
        await LC.rpc('submit_open_review', { p_rating: rating, p_body: text.value, p_display_name: nm.value, p_phone: ph.value });
        body.replaceChildren(h('div', { class: 'step-anim' }, h('div', { class: 'done' }, h('div', { class: 'done-check' }, icon('check')), h('h3', {}, 'Thank you!'),
          h('p', { class: 'muted' }, 'Your review will show up on the site once Miguel approves it.'),
          h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => sheet.close() }, 'Done'))));
      } catch (e) { toast(e.message || 'Something went wrong. Please try again.'); send.disabled = false; }
    };
    const recent = past.length ? [h('p', { class: 'opt-label' }, 'Your recent visits'), ...past.slice(0, 2).map(b => h('button', { class: 'btn ghost-dark block', type: 'button', onclick: () => openManage(b.token) }, icon('star'), `Review my ${T.date(b.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} cut`)), h('p', { class: 'opt-label' }, 'Or write one here')] : [];
    body.replaceChildren(h('div', { class: 'step-anim' },
      h('p', { class: 'muted' }, 'Thanks for taking a minute! Reviews help other people find me.'),
      ...recent, stars,
      h('div', { class: 'field' }, h('label', { for: 'orBody' }, 'Your review'), text),
      h('div', { class: 'field' }, h('label', { for: 'orName' }, 'Name to show'), nm),
      h('div', { class: 'field' }, h('label', { for: 'orPhone' }, 'Phone you booked with'), ph, h('p', { class: 'muted small' }, 'Optional. Marks you as a verified client. Never shown on the site.')),
      send));
  }
  document.addEventListener('click', e => { const t = e.target.closest('[data-review]'); if (t) { e.preventDefault(); openReview(); } });
  if (location.hash === '#review') setTimeout(openReview, 0);

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
      // Homepage shows only the picked photos; everything else lives on /portfolio.
      Object.assign(state, { settings, services, staff, reviews, portfolioAll: portfolio.filter(p => p.image_url), portfolio: portfolio.filter(p => p.on_homepage !== false) });
      if (settings?.timezone) T.tz = settings.timezone;
      renderGallery(); renderReviews(); renderPrices(); nextOpening(); setupReveal(); setupHeadlines(); showMyBooking(); checkHash();
    } catch (e) {
      console.error(e);
      $('#nextWhen').textContent = 'DM to book'; $('#nextSub').textContent = '@lopezcuts.dmv on Instagram';
      toast('Online booking is having trouble. DM @lopezcuts.dmv on Instagram to book.');
      setupReveal(); setupHeadlines();
    }
  }
  LC.onData(t => { if (t === '*' || t === 'appointments') nextOpening(); });
  load();
})();
