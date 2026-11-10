// Opening animation, once per visit: hair clippings fall and gather into the clipper-and-comb
// logo, then a razor edge lines up the LOPEZ CUTS wordmark and it fills in gold. About 4.5 s.
// Skipped on deep links (booking, manage links), for reduced motion, and by any tap or key.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false; try { seen = sessionStorage.getItem('lc-intro') === '1'; } catch (e) {}
  if (seen || reduce || (location.hash && location.hash !== '#top')) return;
  try { sessionStorage.setItem('lc-intro', '1'); } catch (e) {}

  const el = document.createElement('div'); el.className = 'intro';
  el.innerHTML = '<canvas aria-hidden="true"></canvas><button class="intro-skip" type="button">Skip</button>';
  document.body.prepend(el); document.documentElement.classList.add('intro-on');
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  let closed = false, raf = 0;
  const close = () => { if (closed) return; closed = true; cancelAnimationFrame(raf); el.classList.add('out'); document.documentElement.classList.remove('intro-on'); setTimeout(() => el.remove(), 700); };
  el.addEventListener('click', close); addEventListener('keydown', close, { once: true });
  const bail = setTimeout(close, 2500); // logo never loaded

  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a);
  const sm = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x), eo = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
  const SPLIT = 335 / 435; // the logo image: clipper + comb above, wordmark below
  const img = new Image(); img.src = 'assets/img/logo-full.png';
  img.decode().then(start, close);

  function start() {
    clearTimeout(bail); if (closed) return;
    const d = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = Math.round(W * d); cv.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0);
    const lh = Math.min(H * .5, W * .7 * img.height / img.width), lw = lh * img.width / img.height, lx = (W - lw) / 2, ly = (H - lh) / 2;
    const iw = img.width, ih = img.height, sy = ih * SPLIT;
    const drawIcon = c => c.drawImage(img, 0, 0, iw, sy, lx, ly, lw, lh * SPLIT);
    const drawWord = c => c.drawImage(img, 0, sy, iw, ih - sy, lx, ly + lh * SPLIT, lw, lh * (1 - SPLIT));
    const sample = (draw, step) => { const o = document.createElement('canvas'); o.width = Math.ceil(W); o.height = Math.ceil(H); const x = o.getContext('2d'); draw(x);
      const px = x.getImageData(0, 0, o.width, o.height).data, pts = [];
      for (let y = 0; y < o.height; y += step) for (let i = 0; i < o.width; i += step) { const k = (y * o.width + i) * 4; if (px[k + 3] > 128) pts.push([i, y, (px[k] + px[k + 1] + px[k + 2]) / 3]); }
      return { pts, px, w: o.width, h: o.height }; };

    // clippings that will build the icon
    const ic = sample(drawIcon, Math.max(2, Math.round(lh / 110)));
    const cols = [0, 1, 2, 3, 4, 5].map(i => { const l = i / 5; return `rgb(${Math.round(90 + 150 * l)},${Math.round(70 + 145 * l)},${Math.round(30 + 110 * l)})`; });
    const ps = ic.pts.map(([tx, ty, L]) => ({ tx, ty, b: Math.min(5, Math.floor(L / 46)), x: rnd(0, W), y: rnd(-H * .7, H * .35), a: rnd(0, TAU), va: rnd(-3, 3), sw: rnd(0, TAU), dl: rnd(0, .6), l: rnd(3, 8), fx: 0, fy: 0 }));
    // the wordmark's outline, left to right, for the razor
    const wm = sample(drawWord, 1), on = (i, j) => i >= 0 && j >= 0 && i < wm.w && j < wm.h && wm.px[(j * wm.w + i) * 4 + 3] > 128;
    const edge = wm.pts.filter(([i, j]) => !on(i - 1, j) || !on(i + 1, j) || !on(i, j - 1) || !on(i, j + 1)).sort((a, b) => a[0] - b[0]);
    const ex0 = edge.length ? edge[0][0] : lx, ex1 = edge.length ? edge[edge.length - 1][0] : lx + lw, wy0 = ly + lh * SPLIT, wy1 = ly + lh;
    let sparks = [];
    const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height; const ox = off.getContext('2d'); ox.setTransform(d, 0, 0, d, 0, 0);
    const sheen = u => { if (u <= 0 || u >= 1) return; ox.clearRect(0, 0, W, H); ox.globalCompositeOperation = 'source-over'; drawIcon(ox); drawWord(ox); ox.globalCompositeOperation = 'source-in';
      const x = lx - lw * .3 + u * lw * 1.6, g = ox.createLinearGradient(x - lw * .12, 0, x + lw * .12, 0);
      g.addColorStop(0, 'rgba(255,250,240,0)'); g.addColorStop(.5, 'rgba(255,250,240,.6)'); g.addColorStop(1, 'rgba(255,250,240,0)'); ox.fillStyle = g; ox.fillRect(0, 0, W, H);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore(); };

    let t = 0, last = 0;
    const frame = now => {
      const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; t += dt;
      ctx.clearRect(0, 0, W, H);
      // 1) clippings drift, then gather into the icon
      const B = cols.map(() => []);
      for (const p of ps) {
        const g = eo((t - .7 - p.dl) / 1.2);
        if (g <= 0) { p.y += (90 + 60 * Math.sin(p.sw)) * dt; p.x += Math.sin(t * 2 + p.sw) * 30 * dt; p.a += p.va * dt; p.fx = p.x; p.fy = p.y; }
        const sw = g > 0 && g < 1 ? Math.sin(g * Math.PI) * 36 : 0;
        const x = g > 0 ? p.fx + (p.tx - p.fx) * g + Math.cos(p.sw + g * 4) * sw : p.x, y = g > 0 ? p.fy + (p.ty - p.fy) * g + Math.sin(p.sw + g * 4) * sw : p.y;
        B[g > .98 ? p.b : 1].push(x, y, p.a * (1 - g), p.l * (1 - g * .75));
      }
      const iconIn = sm((t - 2.1) / .5);
      ctx.save(); ctx.globalAlpha = 1 - iconIn * .9; ctx.lineCap = 'round'; ctx.lineWidth = 1.6;
      B.forEach((L, i) => { if (!L.length) return; ctx.strokeStyle = cols[i]; ctx.beginPath(); for (let k = 0; k < L.length; k += 4) { const dx = Math.cos(L[k + 2]) * L[k + 3] / 2, dy = Math.sin(L[k + 2]) * L[k + 3] / 2; ctx.moveTo(L[k] - dx, L[k + 1] - dy); ctx.lineTo(L[k] + dx + .01, L[k + 1] + dy); } ctx.stroke(); });
      ctx.restore();
      if (iconIn > 0) { ctx.save(); ctx.globalAlpha = iconIn; ctx.shadowColor = 'rgba(241,220,156,.45)'; ctx.shadowBlur = 28; drawIcon(ctx); ctx.restore(); }
      // 2) razor lines up the wordmark, then it fills in
      const k = sm((t - 2.2) / 1.2), sx = ex0 - 6 + k * (ex1 - ex0 + 12), fill = sm((t - 3.3) / .5);
      if (fill > 0) { ctx.save(); ctx.globalAlpha = fill; ctx.shadowColor = 'rgba(241,220,156,.4)'; ctx.shadowBlur = 22; drawWord(ctx); ctx.restore(); }
      if (t > 2.2) {
        ctx.fillStyle = `rgba(241,220,156,${(.95 - .7 * fill).toFixed(3)})`; ctx.beginPath(); let n = 0;
        for (; n < edge.length && edge[n][0] <= sx; n++) ctx.rect(edge[n][0], edge[n][1], 1.2, 1.2); ctx.fill();
        if (k > 0 && k < 1) for (let i = Math.max(0, n - 40); i < n; i += 7) if (Math.random() < .5) sparks.push({ x: edge[i][0], y: edge[i][1], vx: rnd(-40, 160), vy: rnd(-180, 40), l: 1 });
        if (k > 0 && k < 1) { const g = ctx.createLinearGradient(0, wy0 - 10, 0, wy1 + 10); g.addColorStop(0, 'rgba(255,250,240,0)'); g.addColorStop(.5, 'rgba(255,250,240,.95)'); g.addColorStop(1, 'rgba(255,250,240,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(241,220,156,.9)'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.moveTo(sx, wy0 - 10); ctx.lineTo(sx, wy1 + 10); ctx.stroke(); ctx.shadowBlur = 0; }
      }
      sparks = sparks.filter(s => (s.l -= dt * 2.2) > 0);
      if (sparks.length) { ctx.fillStyle = 'rgba(255,246,220,1)'; ctx.shadowColor = 'rgba(241,220,156,1)'; ctx.shadowBlur = 8; ctx.beginPath();
        for (const s of sparks) { s.vy += 500 * dt; s.x += s.vx * dt; s.y += s.vy * dt; ctx.rect(s.x, s.y, 1.6 * s.l + .4, 1.6 * s.l + .4); } ctx.fill(); ctx.shadowBlur = 0; }
      // 3) one shine across the finished logo, then reveal the site
      sheen((t - 3.75) / .7);
      if (t > 4.6) { close(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
})();
