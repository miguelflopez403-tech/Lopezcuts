/* Live rating on pages without the full site script (About, U of U).
 * Same math as the homepage: Booksy count (Settings) + published reviews left on lopezcuts.com.
 * Fills elements like <span data-rating="count">35 reviews on Booksy</span>; the static text stays if anything fails. */
(function () {
  'use strict';
  const els = [...document.querySelectorAll('[data-rating]')];
  if (!els.length || !window.LC) return;
  Promise.all([LC.rpc('get_public_settings'), LC.list('reviews', { eq: { status: 'published' } })]).then(([s, reviews]) => {
    if (!s) return;
    const bc = +s.booksy_review_count || 0;
    const site = (reviews || []).filter(r => r.source === 'site');
    const count = bc + site.length;
    const avg = count ? (((+s.booksy_rating || 5) * bc) + site.reduce((t, r) => t + (+r.rating || 0), 0)) / count : 5;
    const where = site.length ? 'reviews' : 'reviews on Booksy';
    els.forEach(el => {
      const k = el.dataset.rating;
      if (k === 'avg') el.textContent = avg.toFixed(1);
      else if (k === 'count') el.textContent = `${count} ${where}`;
      else if (k === 'from') el.textContent = `${avg.toFixed(1)} from ${count}${site.length ? ' reviews' : ' on Booksy'}`;
    });
  }).catch(() => { });
})();
