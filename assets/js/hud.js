// Hologram barber pole in the hero. One canvas draws a full pole (finial, dome, collars,
// glass tube with spiral stripes, tapered base) in the logo gold, with calm motion.
// Signature feature: like a real shop pole, it turns when the chair is open. It reads Miguel's
// real next opening from the booking calendar (site.js sends 'lc:next'): an open slot today or
// tomorrow spins it at full speed; booked up slows it to a crawl.
// Tapping the pole grabs that opening.
(() => {
  const root = document.getElementById('hudGlobe'); if (!root) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hero = root.closest('.hero'), cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
  const RAD = Math.PI / 180, TAU = Math.PI * 2;
  const col = (getComputedStyle(hero).getPropertyValue('--holo').trim() || '232 205 130').split(/\s+/).join(',');
  const C = a => `rgba(${col},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const ease = (dt, k) => 1 - Math.exp(-dt * k);
  const WORDS = ['Taper fades', 'Burst fades', 'Modern mullets', 'Free Touch-Ups'];
  // live chair status from the booking calendar
  let live = { state: 'wait', top: 'CHECKING THE CHAIR', bot: '' }, gPower = .7, power = .7;
  const onNext = d => {
    if (d.full) { live = { state: 'full', top: 'BOOKED UP', bot: d.note || 'JOIN THE LIST' }; gPower = .25; }
    else if (d.at) {
      const ms = new Date(d.at) - Date.now(), soon = ms < 36 * 36e5;
      live = { state: 'open', top: soon ? 'CHAIR OPEN' : 'NEXT CHAIR', bot: `${d.when} · ${d.time}`.toUpperCase(), soon }; gPower = soon ? 1 : .65;
    }
    root.style.cursor = live.state === 'open' ? 'pointer' : '';
    if (!raf) draw(0);
  };
  addEventListener('lc:next', e => onNext(e.detail || {}));

  // Motion, calm but alive.
  const STRIPE_SPEED = 22;  // degrees per second the stripes turn
  const ORBIT_SPEED = 7;    // degrees per second the words drift
  const SCAN_PERIOD = 8;    // seconds per scan line pass

  let W = 0, H = 0, dpr = Math.min(fine ? 2 : 1.5, devicePixelRatio || 1);
  const size = () => { const c = cv.getBoundingClientRect(); W = c.width; H = c.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(0); };

  const GLINTS = Array.from({ length: 16 }, () => ({ y: Math.random(), a: Math.random() * TAU, s: .05 + Math.random() * .07 }));
  let t = 0, spd = 0, stripe = 0, orbit = 0, tilt = .2, gTilt = .2, lean = 0, gLean = 0;
  if (fine) {
    hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); gTilt = .2 + ((e.clientY - r.top) / r.height - .5) * .08; gLean = ((e.clientX - r.left) / r.width - .5) * 6; });
    hero.addEventListener('pointerleave', () => { gTilt = .2; gLean = 0; });
  }

  // Geometry helpers. A point on a vertical circle of radius r at height y and angle a:
  // x = cx + r sin(a); y shifts by e*r*cos(a) because we look at the pole slightly from above.
  const ring = (cx, y, r, e, front, a0 = 0, a1 = TAU) => { ctx.beginPath(); ctx.ellipse(cx, y, r, Math.max(.5, r * e), 0, front ? 0 : Math.PI, front ? Math.PI : TAU); };
  const glowText = (txt, x, y, a, size, hot) => {
    ctx.font = `600 ${size}px Rajdhani, Archivo, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (size * .22).toFixed(1) + 'px';
    ctx.shadowColor = C(hot ? .8 : .5 * a); ctx.shadowBlur = hot ? 14 : 6; ctx.fillStyle = hot ? `rgba(255,250,240,${a.toFixed(3)})` : C(a);
    ctx.fillText(txt.toUpperCase(), x, y); ctx.shadowBlur = 0; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  };

  function draw(dt) {
    if (!reduce) { spd += (1 - spd) * ease(dt, .9); t += dt; power += (gPower - power) * ease(dt, .6); stripe += dt * STRIPE_SPEED * spd * power; orbit += dt * ORBIT_SPEED * spd; }
    const k = ease(dt, 1.6); tilt += (gTilt - tilt) * k; lean += (gLean - lean) * k;
    ctx.clearRect(0, 0, W, H);
    const S = Math.min(W, H), cx = W / 2 + lean, e = tilt;
    const r = S * .085;                       // tube radius
    const tubeTop = H * .5 - S * .25, tubeBot = H * .5 + S * .25, tubeH = tubeBot - tubeTop;
    const breathe = .9 + .1 * Math.sin(t * .5);

    // soft halo behind the pole
    const halo = ctx.createRadialGradient(cx, H / 2, r * .5, cx, H / 2, S * .42);
    halo.addColorStop(0, C(.10 * breathe)); halo.addColorStop(1, C(0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);

    const fy = tubeBot + S * .17; // where the light under the pole fades out
    const ch = S * .028, cr = r * 1.22, domeH = S * .075, neckY = tubeTop - ch - domeH, ballR = r * .42, ballY = neckY - S * .018 - ballR;
    const skY = tubeBot + ch, skH = S * .06, footY = skY + skH + r * .44;

    // slow light rays from the finial, brighter when the chair is open
    ctx.save(); ctx.translate(cx, ballY); ctx.rotate(t * .12);
    const rays = ctx.createRadialGradient(0, 0, ballR, 0, 0, S * .25); rays.addColorStop(0, C(.11 * power)); rays.addColorStop(1, C(0));
    ctx.fillStyle = rays; ctx.beginPath();
    for (let i = 0; i < 7; i++) { const a = i * TAU / 7, w = .07 + .03 * Math.sin(t * .7 + i * 1.7); ctx.moveTo(0, 0); ctx.arc(0, 0, S * .25, a - w, a + w); ctx.closePath(); }
    ctx.fill(); ctx.restore();

    // soft pool of light on the floor (no ring)
    const pool = ctx.createRadialGradient(cx, footY + S * .012, 0, cx, footY + S * .012, r * 3.4);
    pool.addColorStop(0, C(.2 * breathe)); pool.addColorStop(1, C(0));
    ctx.save(); ctx.translate(0, footY + S * .012); ctx.scale(1, .22); ctx.translate(0, -(footY + S * .012)); ctx.fillStyle = pool; ctx.fillRect(cx - r * 3.4, footY + S * .012 - r * 3.4, r * 6.8, r * 6.8); ctx.restore();


    // words behind the pole
    const orbitY = H * .5, orbitR = r * 3.4, items = WORDS.map((w, i) => { const a = (orbit + i * 360 / WORDS.length) * RAD; return { w, x: cx + Math.sin(a) * orbitR, y: orbitY + Math.cos(a) * orbitR * e * 1.6 + (i % 2 ? -1 : 1) * S * .12, z: Math.cos(a) }; });
    const best = items.reduce((b, it) => (it.z > b.z ? it : b), items[0]);
    const fs = Math.max(11, S * .03);
    items.filter(it => it.z < 0).forEach(it => glowText(it.w, it.x, it.y, .08 + .2 * (1 + it.z), fs, false));

    // ---------- tube: back wall, stripes, glass ----------
    const N = 96, bands = 3, bandW = 46, turns = 2.4;
    // inner back wall
    ctx.fillStyle = C(.04); ctx.fillRect(cx - r, tubeTop, r * 2, tubeH);
    // stripes as shaded quads, back faces first then front faces
    const NB = 8, buckets = [Array.from({ length: NB }, () => []), Array.from({ length: NB }, () => [])];
    for (let i = 0; i < N; i++) {
      const y0 = tubeTop + tubeH * i / N, y1 = tubeTop + tubeH * (i + 1) / N;
      for (let b = 0; b < bands; b++) {
        const base = b * 360 / bands - stripe + (i / N) * turns * 360;
        for (let s = 0; s < 3; s++) {
          const a0 = (base + s * bandW / 3) * RAD, a1 = (base + (s + 1) * bandW / 3) * RAD, da = (turns * 360 / N) * RAD;
          const z = Math.cos((a0 + a1) / 2 + da / 2), front = z > 0 ? 1 : 0;
          const lit = front ? Math.pow(z, .7) : -z;
          buckets[front][Math.min(NB - 1, Math.floor(lit * NB))].push([
            cx + Math.sin(a0) * r, y0 + Math.cos(a0) * r * e, cx + Math.sin(a1) * r, y0 + Math.cos(a1) * r * e,
            cx + Math.sin(a1 + da) * r, y1 + Math.cos(a1 + da) * r * e, cx + Math.sin(a0 + da) * r, y1 + Math.cos(a0 + da) * r * e]);
        }
      }
    }
    const rgb = col.split(',').map(Number), solid = l => `rgb(${rgb.map(v => Math.round(5 + (v - 5) * l)).join(',')})`; // opaque, so slices never double up
    const fillBuckets = (list, lo, hi) => list.forEach((qs, bi) => { if (!qs.length) return; ctx.fillStyle = solid(lo + (hi - lo) * (bi / (NB - 1))); ctx.beginPath();
      for (const q of qs) { ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); ctx.lineTo(q[4], q[5]); ctx.lineTo(q[6], q[7]); ctx.closePath(); } ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = .7; ctx.stroke(); }); // the stroke hides hairline seams between slices
    ctx.save(); ctx.beginPath(); ctx.rect(cx - r - 1, tubeTop, r * 2 + 2, tubeH); ctx.clip();
    fillBuckets(buckets[0], .05, .16);
    fillBuckets(buckets[1], .3, .95 * breathe);
    ctx.restore();
    // glass: side edges, cross-section rings, a highlight streak
    ctx.lineWidth = 1.2; ctx.strokeStyle = C(.55);
    ctx.beginPath(); ctx.moveTo(cx - r, tubeTop); ctx.lineTo(cx - r, tubeBot); ctx.moveTo(cx + r, tubeTop); ctx.lineTo(cx + r, tubeBot); ctx.stroke();
    ctx.lineWidth = .8; ctx.strokeStyle = C(.12); for (let i = 1; i < 6; i++) { ring(cx, tubeTop + tubeH * i / 6, r, e, true); ctx.stroke(); }
    const gl = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    gl.addColorStop(0, 'rgba(255,250,240,0)'); gl.addColorStop(.22, 'rgba(255,250,240,.16)'); gl.addColorStop(.3, 'rgba(255,250,240,0)'); gl.addColorStop(.78, 'rgba(255,250,240,0)'); gl.addColorStop(.86, 'rgba(255,250,240,.07)'); gl.addColorStop(1, 'rgba(255,250,240,0)');
    ctx.fillStyle = gl; ctx.fillRect(cx - r, tubeTop, r * 2, tubeH);
    // glints rising inside the glass
    ctx.save(); ctx.beginPath(); ctx.rect(cx - r, tubeTop, r * 2, tubeH); ctx.clip(); ctx.fillStyle = 'rgba(255,250,240,.9)'; ctx.shadowColor = C(1); ctx.shadowBlur = 6; ctx.beginPath();
    for (const g of GLINTS) { g.y -= dt * g.s * (.4 + .6 * power); if (g.y < 0) { g.y = 1; g.a = Math.random() * TAU; } const z = Math.cos(g.a + t * .3); if (z < .1) continue;
      const gx = cx + Math.sin(g.a + t * .3) * r * .78, gy = tubeTop + g.y * tubeH, gr = S * .0035 * z * (.6 + .4 * Math.sin(g.y * Math.PI)); ctx.moveTo(gx + gr, gy); ctx.arc(gx, gy, gr, 0, TAU); }
    ctx.fill(); ctx.restore();

    // ---------- collars, dome, finials, base ----------
    const collar = (y, h, rr) => { // a metal band: back rim, body, front rim
      const g = ctx.createLinearGradient(cx - rr, 0, cx + rr, 0); g.addColorStop(0, C(.18)); g.addColorStop(.35, C(.65)); g.addColorStop(.55, C(.35)); g.addColorStop(1, C(.15));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, y + h, rr, rr * e, 0, 0, Math.PI); ctx.lineTo(cx - rr, y); ctx.ellipse(cx, y, rr, rr * e, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = C(.75); ctx.lineWidth = 1; ring(cx, y, rr, e, true); ctx.stroke(); ring(cx, y, rr, e, false); ctx.stroke(); ring(cx, y + h, rr, e, true); ctx.stroke();
    };
    // top: collar, dome, neck, finial ball
    collar(tubeTop - ch, ch, cr);
    const dg = ctx.createLinearGradient(cx - cr, 0, cx + cr, 0);
    dg.addColorStop(0, C(.08)); dg.addColorStop(.35, C(.45)); dg.addColorStop(.6, C(.2)); dg.addColorStop(1, C(.06));
    ctx.fillStyle = dg; ctx.beginPath(); ctx.moveTo(cx - cr, tubeTop - ch); ctx.bezierCurveTo(cx - cr, tubeTop - ch - domeH * .9, cx - cr * .35, tubeTop - ch - domeH, cx, tubeTop - ch - domeH); ctx.bezierCurveTo(cx + cr * .35, tubeTop - ch - domeH, cx + cr, tubeTop - ch - domeH * .9, cx + cr, tubeTop - ch); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C(.6); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = C(.5); ctx.fillRect(cx - r * .12, neckY - S * .018, r * .24, S * .018);
    const bg = ctx.createRadialGradient(cx - ballR * .35, neckY - S * .018 - ballR * 1.35, ballR * .1, cx, neckY - S * .018 - ballR, ballR * 1.1);
    bg.addColorStop(0, 'rgba(255,250,240,.95)'); bg.addColorStop(.35, C(.85)); bg.addColorStop(1, C(.15));
    ctx.shadowColor = C(.7); ctx.shadowBlur = 16 * breathe; ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, neckY - S * .018 - ballR, ballR, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    // bottom: collar, tapered skirt, small ball
    collar(tubeBot, ch, cr);
    const sg = ctx.createLinearGradient(cx - cr, 0, cx + cr, 0);
    sg.addColorStop(0, C(.06)); sg.addColorStop(.35, C(.4)); sg.addColorStop(.6, C(.18)); sg.addColorStop(1, C(.05));
    ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(cx - cr, skY); ctx.bezierCurveTo(cx - cr, skY + skH * .6, cx - r * .3, skY + skH * .8, cx - r * .14, skY + skH); ctx.lineTo(cx + r * .14, skY + skH); ctx.bezierCurveTo(cx + r * .3, skY + skH * .8, cx + cr, skY + skH * .6, cx + cr, skY); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C(.55); ctx.stroke();
    ctx.fillStyle = C(.7); ctx.beginPath(); ctx.arc(cx, skY + skH + r * .22, r * .22, 0, TAU); ctx.fill();
    // soft light fading below the pole
    const beam = ctx.createLinearGradient(0, skY + skH, 0, fy); beam.addColorStop(0, C(.18)); beam.addColorStop(1, C(0));
    ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(cx - r * .3, skY + skH + r * .4); ctx.lineTo(cx + r * .3, skY + skH + r * .4); ctx.lineTo(cx + r * 2.6, fy); ctx.lineTo(cx - r * 2.6, fy); ctx.closePath(); ctx.fill();

    // slow scan line over the tube
    const sp = (t / SCAN_PERIOD) % 1, sy = tubeTop + sp * tubeH, sa = .5 * Math.pow(Math.sin(sp * Math.PI), 2);
    const sl = ctx.createLinearGradient(cx - r * 1.6, 0, cx + r * 1.6, 0); sl.addColorStop(0, C(0)); sl.addColorStop(.5, C(sa)); sl.addColorStop(1, C(0));
    ctx.strokeStyle = sl; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - r * 1.6, sy); ctx.lineTo(cx + r * 1.6, sy); ctx.stroke();

    // mirror reflection on the floor, fading out
    const srcTop = ballY - ballR, srcH = footY - srcTop, refH = srcH * .42, ry = footY + 2;
    ctx.save(); ctx.globalAlpha = .2; ctx.translate(0, ry); ctx.scale(1, -1);
    ctx.drawImage(cv, Math.max(0, (cx - cr * 1.3) * dpr), srcTop * dpr, cr * 2.6 * dpr, srcH * dpr, cx - cr * 1.3, -refH, cr * 2.6, refH); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; const fadeR = ctx.createLinearGradient(0, ry, 0, ry + refH);
    fadeR.addColorStop(0, 'rgba(0,0,0,.2)'); fadeR.addColorStop(1, 'rgba(0,0,0,1)'); ctx.fillStyle = fadeR; ctx.fillRect(cx - cr * 1.4, ry, cr * 2.8, refH + 2); ctx.restore();

    // words in front of the pole
    items.filter(it => it.z >= 0).sort((a, b) => a.z - b.z).forEach(it => glowText(it.w, it.x, it.y, .3 + .7 * it.z, fs, it === best && it.z > .8));

  }

  let visible = true, last = 0, raf = 0;
  const loop = now => { raf = 0; const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; draw(dt); if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop); else last = 0; };
  const kick = () => { if (!raf && visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop); };
  root.addEventListener('click', () => { if (live.state === 'open') document.getElementById('nextBtn')?.click(); });
  size(); if (window.LC_NEXT) onNext(window.LC_NEXT); addEventListener('resize', size); document.fonts?.ready.then(size);
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(root);
  document.addEventListener('visibilitychange', kick);
  kick();
})();
