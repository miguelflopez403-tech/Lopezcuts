// Hologram word globe in the hero. Words ride a slowly spinning 3D globe (CSS 3D),
// and a canvas draws the wireframe, tick rings, scan line and the SLC / DMV readouts.
(() => {
  const root = document.getElementById('hudGlobe'); if (!root) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hero = root.closest('.hero'), inner = root.querySelector('.g-in'), cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
  const RAD = Math.PI / 180, P = 1600;
  const col = (getComputedStyle(hero).getPropertyValue('--holo').trim() || '232 205 130').split(/\s+/).join(',');
  const C = a => `rgba(${col},${a.toFixed(3)})`;
  const rings = [
    [-52, ['Salt Lake', 'DMV', 'Salt Lake', 'DMV']],
    [-24, ['Taper fades', 'Lineups', 'Beards', 'Curly hair', 'Designs']],
    [0, ['Lopez Cuts', 'Burst fades', 'Scissor work', 'Mod cuts', 'Skin fades']],
    [24, ['Modern mullets', 'Burst mullets', 'Tapers', '$0 touch-ups', 'Fades']],
    [52, ['Look good', 'Feel better', 'Look good', 'Feel better']],
  ];
  const items = [];
  rings.forEach(([lat, words], ri) => words.forEach((w, k) => {
    const s = document.createElement('span'); s.textContent = w; inner.append(s);
    items.push({ s, lat, th: k * 360 / words.length + ri * 23, z: 0 });
  }));

  let R = 220, W = 0, H = 0, cx = 0, cy = 0, dpr = Math.min(fine ? 2 : 1.5, devicePixelRatio || 1);
  const size = () => {
    const g = inner.getBoundingClientRect(); R = g.width / 2;
    root.style.setProperty('--fs', Math.max(11, R * .085) + 'px');
    const c = cv.getBoundingClientRect(); W = c.width; H = c.height; cx = W / 2; cy = H / 2;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size(); addEventListener('resize', size);
  document.fonts?.ready.then(size);

  let spin = 0, t = 0, tx = -14, ty = 0, gx = -14, gy = 0;
  if (fine) {
    hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); gx = -14 + ((e.clientY - r.top) / r.height - .5) * -14; gy = ((e.clientX - r.left) / r.width - .5) * 20; });
    hero.addEventListener('pointerleave', () => { gx = -14; gy = 0; });
  }
  const proj = (la, lo, cX, sX, cZ, sZ) => {
    const a = lo * RAD, l = la * RAD;
    const x = Math.sin(a) * Math.cos(l) * R, y = -Math.sin(l) * R, z = Math.cos(a) * Math.cos(l) * R;
    const x1 = x * cZ - y * sZ, y1 = x * sZ + y * cZ, y2 = y1 * cX - z * sX, z2 = y1 * sX + z * cX, k = P / (P - z2);
    return [cx + x1 * k, cy + y2 * k, z2 / R];
  };
  const line = pts => { for (let i = 1; i < pts.length; i++) { const [x0, y0, f0] = pts[i - 1], [x1, y1, f1] = pts[i], f = (f0 + f1) / 2;
    ctx.strokeStyle = C(f > 0 ? .1 + .38 * f : .05); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); } };

  function frame(dt) {
    if (!reduce) { spin += dt * 8; t += dt; }
    tx += (gx - tx) * Math.min(1, dt * 3); ty += (gy - ty) * Math.min(1, dt * 3);
    const rz = -8 + ty * .25;
    inner.style.transform = `rotateX(${tx}deg) rotateZ(${rz}deg)`;
    let best = null;
    for (const it of items) {
      const a = it.th + spin + ty; it.z = Math.cos(a * RAD) * Math.cos(it.lat * RAD);
      it.s.style.transform = `translate(-50%,-50%) rotateY(${a}deg) rotateX(${it.lat}deg) translateZ(${R * 1.02}px)`;
      const flick = .92 + .08 * Math.sin(t * 23 + it.th);
      it.s.style.opacity = ((0.04 + 0.96 * Math.pow(Math.max(0, it.z), 1.6)) * flick).toFixed(3);
      if (!best || it.z > best.z) best = it;
    }
    for (const it of items) it.s.classList.toggle('hot', it === best);

    ctx.clearRect(0, 0, W, H); ctx.lineWidth = .8;
    const cX = Math.cos(tx * RAD), sX = Math.sin(tx * RAD), cZ = Math.cos(rz * RAD), sZ = Math.sin(rz * RAD), step = fine ? 6 : 10;
    for (let la = -60; la <= 60; la += 30) { const pts = []; for (let lo = 0; lo <= 360; lo += step) pts.push(proj(la, lo + spin + ty, cX, sX, cZ, sZ)); line(pts); }
    for (let lo = 0; lo < 180; lo += 30) { const pts = []; for (let la = -90; la <= 270; la += step) pts.push(proj(la <= 90 ? la : 180 - la, (la <= 90 ? lo : lo + 180) + spin + ty, cX, sX, cZ, sZ)); line(pts); }
    const g = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.15); g.addColorStop(0, C(.06)); g.addColorStop(.85, C(.03)); g.addColorStop(1, C(0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, 6.283); ctx.fill();
    ctx.strokeStyle = C(.45); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
    // tick ring
    const rot = t * 6 * RAD; ctx.strokeStyle = C(.5);
    for (let d = 0; d < 360; d += 3) { const a = d * RAD + rot, long = d % 30 === 0, r1 = R * 1.12, r2 = r1 + (long ? R * .06 : R * .025);
      ctx.globalAlpha = long ? 1 : .55; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // counter-rotating arcs + dashed outer ring
    ctx.lineWidth = 2; ctx.strokeStyle = C(.75); const r3 = R * 1.28, a0 = -t * 14 * RAD;
    [[0, 50], [140, 175], [230, 300]].forEach(([s, e]) => { ctx.beginPath(); ctx.arc(cx, cy, r3, s * RAD + a0, e * RAD + a0); ctx.stroke(); });
    ctx.lineWidth = 1; ctx.strokeStyle = C(.3); ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.arc(cx, cy, R * 1.36, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    // scan line
    const sy = cy - R + ((t * .22) % 1) * R * 2, half = Math.sqrt(Math.max(0, R * R - (sy - cy) ** 2));
    const sg = ctx.createLinearGradient(cx - half, 0, cx + half, 0); sg.addColorStop(0, C(0)); sg.addColorStop(.5, C(.7)); sg.addColorStop(1, C(0));
    ctx.strokeStyle = sg; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - half, sy); ctx.lineTo(cx + half, sy); ctx.stroke(); ctx.lineWidth = .8;
    // readouts
    ctx.fillStyle = C(.75); ctx.font = `600 ${Math.max(9, R * .045)}px Rajdhani, Archivo, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.strokeStyle = C(.45);
    ctx.beginPath(); ctx.moveTo(cx, cy - R * 1.4); ctx.lineTo(cx, cy - R * 1.47); ctx.stroke();
    ctx.fillText('SLC  40.76° N  111.89° W', cx, cy - R * 1.54);
    ctx.fillStyle = C(.55 + .45 * Math.abs(Math.sin(t * 2))); ctx.fillText('● LIVE', cx + R * 1.18, cy - R * 1.18);
    ctx.fillStyle = C(.75); ctx.beginPath(); ctx.moveTo(cx, cy + R * 1.4); ctx.lineTo(cx, cy + R * 1.47); ctx.stroke();
    ctx.fillText('DMV  38.90° N  77.03° W', cx, cy + R * 1.54); ctx.textAlign = 'left';
  }

  let visible = true, last = 0, raf = 0;
  const loop = now => { raf = 0; const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; frame(dt); if (visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop); else last = 0; };
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); };
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(root);
  document.addEventListener('visibilitychange', kick);
  frame(0); kick();
})();
