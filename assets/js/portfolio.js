/* Lopezcuts full portfolio page: every published photo, newest first, with cut filters and a lightbox.
 * Reads the same portfolio_items table the owner dashboard uploads to, so new photos show up on their own. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const PAGE = 24, NEW_DAYS = 7;
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(9).forEach(k => { if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); });
    return e;
  }
  const icon = id => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + id); s.append(u); return s; };
  const catOf = p => (p.category || p.title || 'Cuts').trim();
  const fmtDate = d => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' }).format(d);

  let all = [], view = [], shown = 0, filter = 'All';
  const grid = $('#pfGrid'), more = $('#pfMore'), count = $('#pfCount'), bar = $('#pfBar');

  function chips() {
    const counts = new Map();
    all.forEach(p => counts.set(catOf(p), (counts.get(catOf(p)) || 0) + 1));
    const names = ['All', ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))];
    bar.replaceChildren(...names.map(n => h('button', { class: 'pf-chip', type: 'button', 'aria-pressed': String(n === filter), onclick: () => { filter = n; chips(); apply(); } },
      n, h('small', {}, String(n === 'All' ? all.length : counts.get(n))))));
  }
  function apply() {
    view = filter === 'All' ? all : all.filter(p => catOf(p) === filter);
    shown = 0; grid.replaceChildren(); page();
    count.textContent = view.length ? `${view.length} photo${view.length === 1 ? '' : 's'}${filter === 'All' ? '' : ' · ' + filter}, newest first` : '';
  }
  function page() {
    const now = Date.now();
    const slice = view.slice(shown, shown + PAGE);
    grid.append(...slice.map((p, k) => {
      const i = shown + k, d = p.created_at ? new Date(p.created_at) : null;
      const fresh = d && p._real && now - d.getTime() < NEW_DAYS * 864e5;
      return h('li', {}, h('button', { class: 'pf-tile', type: 'button', 'aria-label': `${catOf(p)}, open photo`, onclick: () => open(i) },
        h('img', { src: p.image_url, alt: `${catOf(p)} by Miguel Lopez, Lopez Cuts barber in Salt Lake City`, loading: i < 8 ? 'eager' : 'lazy', decoding: 'async', width: '480', height: '600' }),
        fresh ? h('span', { class: 'pf-new' }, 'New') : null,
        h('span', { class: 'pf-cap' }, h('b', {}, catOf(p)), d && p._real ? h('small', {}, fmtDate(d)) : null)));
    }));
    shown += slice.length;
    more.hidden = shown >= view.length;
  }
  more.addEventListener('click', page);

  // Lightbox: steps through whatever is filtered right now.
  const lb = $('#lightbox'); let at = 0;
  function lbShow() {
    const p = view[at];
    $('#lbMedia').replaceChildren(h('img', { src: p.image_url, alt: `${catOf(p)}, photo ${at + 1}` }),
      view.length > 1 ? h('button', { class: 'icon-btn lb-nav prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => step(-1) }, icon('back')) : null,
      view.length > 1 ? h('button', { class: 'icon-btn lb-nav next', type: 'button', 'aria-label': 'Next photo', onclick: () => step(1) }, icon('arrow')) : null);
    $('#lbCap').textContent = `${catOf(p)} · ${at + 1} of ${view.length}`;
    const nx = view[(at + 1) % view.length]; if (nx) { const im = new Image(); im.src = nx.image_url; }
  }
  function step(d) { at = (at + d + view.length) % view.length; lbShow(); }
  function open(i) { at = i; lbShow(); lb.showModal(); }
  lb.addEventListener('keydown', e => { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); });
  let tx = null;
  lb.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); });
  $('#lbClose').addEventListener('click', () => lb.close());
  // "Use as my reference": remember the photo and open booking; the booking sheet shows it and sends it to Miguel.
  $('#lbUse').addEventListener('click', () => {
    const p = view[at]; if (!p) return;
    try { localStorage.setItem('lopezcuts-ref', JSON.stringify({ id: p.id, url: new URL(p.image_url, location.origin).href, cat: catOf(p) })); } catch { }
    location.href = '/#book';
  });
  if (location.hash === '#pick') document.body.classList.add('picking');
  lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });

  async function load() {
    try {
      const rows = await LC.list('portfolio_items', { eq: { published: true }, order: 'created_at', asc: false });
      const withImg = rows.filter(p => p.image_url);
      // Photos uploaded from the dashboard have their own upload time. Older starter photos share one,
      // so within the same moment keep the dashboard order (highest sort = added last = first here).
      const stamps = new Map(); withImg.forEach(p => stamps.set(p.created_at, (stamps.get(p.created_at) || 0) + 1));
      withImg.forEach(p => { p._real = stamps.get(p.created_at) < 4; });
      all = withImg.sort((a, b) => (new Date(b.created_at) - new Date(a.created_at)) || ((b.sort || 0) - (a.sort || 0)));
      if (!all.length) { count.textContent = ''; grid.replaceChildren(h('li', { class: 'pf-empty' }, 'New photos are on the way. Check Instagram @lopezcuts.dmv in the meantime.')); return; }
      chips(); apply();
    } catch (e) {
      console.error(e);
      count.textContent = 'Photos are having trouble loading. See the latest on Instagram @lopezcuts.dmv.';
    }
  }
  load();
})();
