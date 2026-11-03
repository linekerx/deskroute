/* Фоновые эффекты: схема линий, сетка, звёзды, сияние, картинка */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, svgEl } = DR.util;
  let starsRaf = 0;
  let lastKey = '';

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** Линии в духе схемы метро: отрезки под 0/45/90°, скруглённые повороты, станции */
  function mapSvg() {
    const W = 1600;
    const H = 1000;
    const rand = rng(20261103);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice' });
    const dirs = [
      [1, 0],
      [0.7071, 0.7071],
      [0, 1],
      [-0.7071, 0.7071],
      [-1, 0],
      [-0.7071, -0.7071],
      [0, -1],
      [0.7071, -0.7071],
    ];
    for (let i = 0; i < 7; i++) {
      const color = `var(--sub-${(i % 6) + 1})`;
      let x;
      let y;
      let d;
      const edge = i % 4;
      if (edge === 0) [x, y, d] = [-40, 120 + rand() * 760, 0];
      else if (edge === 1) [x, y, d] = [180 + rand() * 1240, -40, 2];
      else if (edge === 2) [x, y, d] = [W + 40, 120 + rand() * 760, 4];
      else [x, y, d] = [180 + rand() * 1240, H + 40, 6];
      const pts = [[x, y]];
      for (let step = 0; step < 9; step++) {
        const len = 140 + rand() * 260;
        x += dirs[d][0] * len;
        y += dirs[d][1] * len;
        pts.push([x, y]);
        if (x < -80 || x > W + 80 || y < -80 || y > H + 80) break;
        d = (d + (rand() < 0.5 ? 1 : 7)) % 8;
      }
      const path = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join(' ');
      svg.append(svgEl('path', { d: path, stroke: color, 'stroke-width': 9, opacity: 0.07 }));
      if (i < 3) svg.append(svgEl('path', { d: path, stroke: color, 'stroke-width': 3, opacity: 0.22, class: 'moving' }));
      pts.slice(1, -1).forEach((p, k) => {
        if (k % 2) return;
        svg.append(svgEl('circle', { cx: p[0], cy: p[1], r: 9, fill: 'var(--bg)', stroke: color, 'stroke-width': 4, opacity: 0.16 }));
      });
    }
    return svg;
  }

  function stars(container) {
    const c = h('canvas');
    container.append(c);
    const ctx = c.getContext('2d');
    const rand = rng(7);
    const list = Array.from({ length: 170 }, () => ({ x: rand(), y: rand(), r: 0.4 + rand() * 1.3, p: rand() * Math.PI * 2, s: 0.4 + rand() * 1.2 }));
    let color = '#fff';
    let w = 0;
    let hh = 0;
    let last = 0;
    const resize = () => {
      const dpr = devicePixelRatio || 1;
      w = c.clientWidth;
      hh = c.clientHeight;
      c.width = w * dpr;
      c.height = hh * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (t) => {
      starsRaf = requestAnimationFrame(draw);
      if (t - last < 60 || document.hidden) return;
      last = t;
      if (!w) resize();
      color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff';
      const animOn = document.documentElement.dataset.anim !== 'off';
      ctx.clearRect(0, 0, w, hh);
      ctx.fillStyle = color;
      for (const s of list) {
        const a = animOn ? 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(s.p + (t / 1000) * s.s)) : 0.5;
        ctx.globalAlpha = a * 0.8;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * hh, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    new ResizeObserver(resize).observe(c);
    starsRaf = requestAnimationFrame(draw);
  }

  function render(params) {
    const root = document.getElementById('bg');
    if (!root) return;
    const key = [params.bgEffect, params.bgImage, params.noise].join('|');
    if (key === lastKey) return;
    lastKey = key;
    cancelAnimationFrame(starsRaf);
    DR.util.clear(root);
    const eff = params.bgEffect;
    if (eff === 'map') root.append(h('div', { class: 'bg-map' }, mapSvg()));
    else if (eff === 'grid') root.append(h('div', { class: 'bg-grid' }));
    else if (eff === 'aurora') root.append(h('div', { class: 'bg-aurora' }, h('i'), h('i'), h('i')));
    else if (eff === 'stars') {
      const box = h('div', { class: 'bg-stars' });
      root.append(box);
      stars(box);
    } else if (eff === 'image' && params.bgImage) {
      root.append(h('div', { class: 'bg-image', style: { backgroundImage: `url("${params.bgImage.replace(/"/g, '%22')}")` } }));
    }
    if (params.noise) root.append(h('div', { class: 'bg-noise' }));
  }

  DR.background = { render };
})();
