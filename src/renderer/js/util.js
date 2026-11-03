/* Утилиты интерфейса: создание элементов, форматирование, цвета */
(function () {
  const DR = (window.DR = window.DR || {});

  function h(tag, props, ...children) {
    const el = tag === 'svg' || props?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false || k === 'svg') continue;
        if (k === 'class') el.setAttribute('class', v);
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv);
            else el.style[sk] = sv;
          }
        } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value' && 'value' in el) el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === '') continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    return el;
  }

  function icon(name, size, cls) {
    return DR.iconEl(name, size, cls);
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

  function bytesParts(n) {
    const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    let v = Math.max(0, Number(n) || 0);
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return [i === 0 ? nf0.format(v) : v >= 100 ? nf0.format(v) : nf1.format(v), u[i]];
  }
  function fmtBytes(n) {
    const [v, u] = bytesParts(n);
    return `${v} ${u}`;
  }
  function speedParts(bps) {
    const [v, u] = bytesParts(bps);
    return [v, `${u}/с`];
  }
  function fmtDuration(ms) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    s -= d * 86400;
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return (d ? `${d} д ` : '') + `${hh}:${mm}:${ss}`;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function fmtAgo(ts) {
    if (!ts) return 'ещё не обновлялась';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'только что';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
    const d = Math.round(h / 24);
    return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  }
  const df = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const tf = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function fmtDate(ts) {
    return df.format(new Date(ts));
  }
  function fmtTime(ts) {
    return tf.format(new Date(ts));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  function throttle(fn, ms) {
    let last = 0;
    let t;
    return (...a) => {
      const now = Date.now();
      clearTimeout(t);
      if (now - last >= ms) {
        last = now;
        fn(...a);
      } else {
        t = setTimeout(() => {
          last = Date.now();
          fn(...a);
        }, ms - (now - last));
      }
    };
  }

  function latencyClass(ms) {
    if (ms == null) return 'none';
    if (ms < 180) return 'good';
    if (ms < 450) return 'ok';
    return 'bad';
  }

  const PROTO = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'Shadowsocks', socks: 'SOCKS5', hysteria2: 'Hysteria2', hysteria: 'Hysteria2', json: 'JSON' };
  const NET = { tcp: 'TCP', ws: 'WebSocket', grpc: 'gRPC', xhttp: 'XHTTP', httpupgrade: 'HTTPUpgrade', kcp: 'mKCP', h2: 'HTTP/2', quic: 'QUIC', hysteria: 'QUIC' };
  /** Значки протокола для сервера */
  function serverBadges(s) {
    const out = [];
    if (s.protocol === 'json') {
      out.push({ t: PROTO[s.inner] || String(s.inner || 'JSON').toUpperCase(), c: 'proto' });
      out.push({ t: 'JSON', c: '' });
    } else out.push({ t: PROTO[s.protocol] || s.protocol, c: 'proto' });
    if (s.security === 'reality') out.push({ t: 'REALITY', c: 'sec' });
    else if (s.security === 'tls' && s.protocol !== 'hysteria2') out.push({ t: 'TLS', c: 'sec' });
    if (s.network && NET[s.network] && s.protocol !== 'hysteria2' && s.protocol !== 'shadowsocks' && s.protocol !== 'socks') out.push({ t: NET[s.network], c: '' });
    if (s.flow) out.push({ t: 'Vision', c: '' });
    return out;
  }

  /* ---- цвета ---- */
  function hexToRgb(hex) {
    let s = String(hex || '').trim().replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsv({ r, g, b }) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let hh = 0;
    if (d) {
      if (max === r) hh = ((g - b) / d) % 6;
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60;
      if (hh < 0) hh += 360;
    }
    return { h: hh, s: max ? d / max : 0, v: max };
  }
  function hsvToRgb({ h: hh, s, v }) {
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  function hslToHex(hh, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
  }
  function mix(a, b, t) {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    if (!x || !y) return a;
    return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  }
  function luminance(hex) {
    const c = hexToRgb(hex);
    if (!c) return 0;
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function readableOn(hex) {
    return luminance(hex) > 0.42 ? '#14110c' : '#ffffff';
  }
  function normalizeHex(v) {
    const c = hexToRgb(v);
    return c ? rgbToHex(c) : null;
  }

  function copyText(text) {
    return DR.api.invoke('copyText', text).catch(() => navigator.clipboard && navigator.clipboard.writeText(text));
  }

  DR.util = {
    h,
    append,
    svgEl,
    icon,
    clear,
    fmtBytes,
    bytesParts,
    speedParts,
    fmtDuration,
    fmtAgo,
    fmtDate,
    fmtTime,
    plural,
    debounce,
    throttle,
    latencyClass,
    serverBadges,
    hexToRgb,
    rgbToHex,
    rgbToHsv,
    hsvToRgb,
    hslToHex,
    mix,
    luminance,
    readableOn,
    normalizeHex,
    copyText,
  };
})();
