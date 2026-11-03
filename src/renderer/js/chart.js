/* График скорости (canvas) */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, hexToRgb, speedParts } = DR.util;
  const N = 60;

  function niceMax(v) {
    const min = 64 * 1024;
    if (v < min) return min;
    const p = 2 ** Math.ceil(Math.log2(v));
    return p * 0.75 >= v ? p * 0.75 : p;
  }

  function rgba(hex, a) {
    const c = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  }

  function SpeedChart(container) {
    const canvas = h('canvas');
    container.append(canvas);
    const ctx = canvas.getContext('2d');
    let data = [];
    let colors = {};
    let w = 0;
    let hh = 0;

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      const g = (k) => cs.getPropertyValue(k).trim();
      colors = { down: g('--down'), up: g('--up'), grid: g('--border'), text: g('--text-3'), font: g('--font-ui') };
    }
    function resize() {
      const dpr = devicePixelRatio || 1;
      w = canvas.clientWidth;
      hh = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    function path(points) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        const [px, py] = points[i - 1];
        const [x, y] = points[i];
        const mx = (px + x) / 2;
        ctx.bezierCurveTo(mx, py, mx, y, x, y);
      }
    }
    function draw() {
      if (!w || !hh) return;
      if (!colors.down) readColors();
      ctx.clearRect(0, 0, w, hh);
      const top = 16;
      const bottom = hh - 2;
      const vals = data.slice(-N);
      const max = niceMax(Math.max(1, ...vals.map((d) => Math.max(d.d, d.u))));
      ctx.strokeStyle = rgba(colors.grid, 0.6);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      for (const f of [0, 0.5]) {
        const y = top + (bottom - top) * f + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = colors.text;
      ctx.font = `500 10.5px ${colors.font || 'sans-serif'}`;
      const [mv, mu] = speedParts(max);
      ctx.fillText(`${mv} ${mu}`, 0, 10);
      if (vals.length < 2) return;
      const step = w / (N - 1);
      const x0 = w - (vals.length - 1) * step;
      const toY = (v) => bottom - (Math.min(v, max) / max) * (bottom - top);
      const down = vals.map((d, i) => [x0 + i * step, toY(d.d)]);
      const up = vals.map((d, i) => [x0 + i * step, toY(d.u)]);

      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, rgba(colors.down, 0.32));
      grad.addColorStop(1, rgba(colors.down, 0));
      path(down);
      ctx.lineTo(down[down.length - 1][0], bottom);
      ctx.lineTo(down[0][0], bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      path(down);
      ctx.strokeStyle = colors.down;
      ctx.lineWidth = 2;
      ctx.stroke();
      path(up);
      ctx.strokeStyle = colors.up;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      const last = down[down.length - 1];
      ctx.fillStyle = colors.down;
      ctx.beginPath();
      ctx.arc(last[0] - 3, last[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
    new ResizeObserver(resize).observe(canvas);
    document.addEventListener('dr:theme', () => {
      readColors();
      draw();
    });
    return {
      set(list) {
        data = list.slice(-N);
        draw();
      },
      push(sample) {
        data.push(sample);
        if (data.length > N) data.shift();
        draw();
      },
      redraw: draw,
    };
  }

  DR.SpeedChart = SpeedChart;
})();
