/* Темы оформления: токены, готовые темы, применение, случайная тема, обмен кодом */
(function () {
  const DR = (window.DR = window.DR || {});
  const U = () => DR.util;

  /** Все настраиваемые цвета. key → CSS-переменная --key */
  const TOKENS = [
    { key: 'bg', label: 'Фон окна', group: 'Фон и панели' },
    { key: 'bg-2', label: 'Свечение фона', group: 'Фон и панели' },
    { key: 'panel', label: 'Панели', group: 'Фон и панели' },
    { key: 'panel-2', label: 'Кнопки и меню', group: 'Фон и панели' },
    { key: 'input', label: 'Поля ввода', group: 'Фон и панели' },
    { key: 'border', label: 'Рамки', group: 'Фон и панели' },
    { key: 'titlebar', label: 'Заголовок окна', group: 'Фон и панели' },
    { key: 'rail', label: 'Боковое меню', group: 'Фон и панели' },
    { key: 'text', label: 'Основной текст', group: 'Текст' },
    { key: 'text-2', label: 'Второстепенный текст', group: 'Текст' },
    { key: 'text-3', label: 'Подписи и подсказки', group: 'Текст' },
    { key: 'on-line', label: 'Текст на акценте', group: 'Текст' },
    { key: 'line', label: 'Линия маршрута (акцент)', group: 'Маршрут и состояние' },
    { key: 'line-2', label: 'Второй акцент', group: 'Маршрут и состояние' },
    { key: 'ok', label: 'Подключено', group: 'Маршрут и состояние' },
    { key: 'busy', label: 'Подключение', group: 'Маршрут и состояние' },
    { key: 'bad', label: 'Ошибка', group: 'Маршрут и состояние' },
    { key: 'down', label: 'График: загрузка', group: 'Маршрут и состояние' },
    { key: 'up', label: 'График: отдача', group: 'Маршрут и состояние' },
    { key: 'sub-1', label: 'Линия подписки 1', group: 'Линии подписок' },
    { key: 'sub-2', label: 'Линия подписки 2', group: 'Линии подписок' },
    { key: 'sub-3', label: 'Линия подписки 3', group: 'Линии подписок' },
    { key: 'sub-4', label: 'Линия подписки 4', group: 'Линии подписок' },
    { key: 'sub-5', label: 'Линия подписки 5', group: 'Линии подписок' },
    { key: 'sub-6', label: 'Линия подписки 6', group: 'Линии подписок' },
  ];

  const DEFAULT_PARAMS = {
    radius: 14,
    lineWidth: 6,
    panelAlpha: 0.9,
    blur: 0,
    glow: 0.55,
    anim: 1,
    animations: true,
    scale: 1,
    fontUi: 'onest',
    fontDisplay: 'jost',
    bgEffect: 'map',
    bgImage: '',
    bgDim: 55,
    noise: false,
  };

  const FONTS = {
    onest: { label: 'Onest', css: "'DR Onest', 'Segoe UI', system-ui, sans-serif" },
    jost: { label: 'Jost', css: "'DR Jost', 'DR Onest', 'Segoe UI', sans-serif" },
    inter: { label: 'Inter', css: "'DR Inter', 'Segoe UI', system-ui, sans-serif" },
    mono: { label: 'JetBrains Mono', css: "'DR Mono', Consolas, monospace" },
    system: { label: 'Системный', css: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, system-ui, 'Ubuntu', sans-serif" },
  };

  const BG_EFFECTS = [
    { id: 'map', label: 'Схема', icon: 'waypoints' },
    { id: 'grid', label: 'Сетка', icon: 'layers' },
    { id: 'stars', label: 'Звёзды', icon: 'sparkles' },
    { id: 'aurora', label: 'Сияние', icon: 'blend' },
    { id: 'solid', label: 'Без эффекта', icon: 'square' },
    { id: 'image', label: 'Картинка', icon: 'image' },
  ];

  const PRESETS = [
    {
      id: 'night',
      name: 'Ночная схема',
      scheme: 'dark',
      colors: {
        bg: '#0f1730', 'bg-2': '#1b2c5c', panel: '#17213d', 'panel-2': '#1f2b4d', input: '#111a34', border: '#2b3862', titlebar: '#0c1329', rail: '#0c1329',
        text: '#eef1fa', 'text-2': '#a6b0ce', 'text-3': '#6d79a0', 'on-line': '#1c0e02',
        line: '#ff7a1a', 'line-2': '#ffc23d', ok: '#3fd6a6', busy: '#ffc23d', bad: '#ff5468', down: '#3fd6a6', up: '#ff9a4a',
        'sub-1': '#ff7a1a', 'sub-2': '#3fb5ff', 'sub-3': '#b48cff', 'sub-4': '#3fd6a6', 'sub-5': '#ff6fa8', 'sub-6': '#ffd23f',
      },
      params: { bgEffect: 'map' },
    },
    {
      id: 'paper',
      name: 'Бумажная карта',
      scheme: 'light',
      colors: {
        bg: '#eef0f3', 'bg-2': '#ffffff', panel: '#ffffff', 'panel-2': '#f5f6f8', input: '#f7f8fa', border: '#d5d9e0', titlebar: '#e6e9ee', rail: '#e6e9ee',
        text: '#15181f', 'text-2': '#4b5363', 'text-3': '#8a92a3', 'on-line': '#ffffff',
        line: '#e5322d', 'line-2': '#0078be', ok: '#009a49', busy: '#f29100', bad: '#d4252b', down: '#0078be', up: '#e5322d',
        'sub-1': '#e5322d', 'sub-2': '#0078be', 'sub-3': '#8e479c', 'sub-4': '#009a49', 'sub-5': '#f07e24', 'sub-6': '#00a1b3',
      },
      params: { bgEffect: 'map', panelAlpha: 0.96, glow: 0.25 },
    },
    {
      id: 'neon',
      name: 'Неон',
      scheme: 'dark',
      colors: {
        bg: '#0d0a1f', 'bg-2': '#2a0f4a', panel: '#160f2e', 'panel-2': '#20163f', input: '#120c27', border: '#33245e', titlebar: '#0b081a', rail: '#0b081a',
        text: '#f5efff', 'text-2': '#b9a9dc', 'text-3': '#7b6aa3', 'on-line': '#1a0010',
        line: '#ff2e88', 'line-2': '#00e5ff', ok: '#00f0a8', busy: '#ffe14d', bad: '#ff4766', down: '#00e5ff', up: '#ff2e88',
        'sub-1': '#ff2e88', 'sub-2': '#00e5ff', 'sub-3': '#a66bff', 'sub-4': '#00f0a8', 'sub-5': '#ffe14d', 'sub-6': '#ff8a3d',
      },
      params: { bgEffect: 'grid', glow: 0.85 },
    },
    {
      id: 'aurora',
      name: 'Северное сияние',
      scheme: 'dark',
      colors: {
        bg: '#0a0e1f', 'bg-2': '#14284a', panel: '#121a33', 'panel-2': '#1a2546', input: '#0e1529', border: '#26335a', titlebar: '#0a0f22', rail: '#0a0f22',
        text: '#eef3ff', 'text-2': '#a9b6d6', 'text-3': '#6a789c', 'on-line': '#08051a',
        line: '#7c5cff', 'line-2': '#22d3ee', ok: '#34e3a4', busy: '#ffd166', bad: '#ff5c7a', down: '#22d3ee', up: '#a78bfa',
        'sub-1': '#7c5cff', 'sub-2': '#22d3ee', 'sub-3': '#34e3a4', 'sub-4': '#f472b6', 'sub-5': '#ffd166', 'sub-6': '#60a5fa',
      },
      params: { bgEffect: 'aurora', panelAlpha: 0.72, blur: 18, glow: 0.7 },
    },
    {
      id: 'emerald',
      name: 'Изумрудная ветка',
      scheme: 'dark',
      colors: {
        bg: '#08161a', 'bg-2': '#0f3a33', panel: '#0f2226', 'panel-2': '#152d31', input: '#0b1b1e', border: '#1f3d40', titlebar: '#071215', rail: '#071215',
        text: '#e9fbf5', 'text-2': '#9fc4ba', 'text-3': '#5f8a82', 'on-line': '#04140f',
        line: '#18c29c', 'line-2': '#b6f36a', ok: '#3ee38a', busy: '#f5cf4a', bad: '#ff6161', down: '#3ee38a', up: '#b6f36a',
        'sub-1': '#18c29c', 'sub-2': '#b6f36a', 'sub-3': '#4fb3ff', 'sub-4': '#f5cf4a', 'sub-5': '#ff8f6b', 'sub-6': '#c39bff',
      },
      params: { bgEffect: 'map' },
    },
    {
      id: 'polar',
      name: 'Полярный день',
      scheme: 'light',
      colors: {
        bg: '#e9eff8', 'bg-2': '#ffffff', panel: '#ffffff', 'panel-2': '#f2f6fc', input: '#f5f8fd', border: '#cfd9e8', titlebar: '#dfe7f3', rail: '#dfe7f3',
        text: '#111827', 'text-2': '#475569', 'text-3': '#8693a8', 'on-line': '#ffffff',
        line: '#4f46e5', 'line-2': '#06b6d4', ok: '#059669', busy: '#d97706', bad: '#dc2626', down: '#06b6d4', up: '#4f46e5',
        'sub-1': '#4f46e5', 'sub-2': '#06b6d4', 'sub-3': '#db2777', 'sub-4': '#059669', 'sub-5': '#d97706', 'sub-6': '#7c3aed',
      },
      params: { bgEffect: 'grid', panelAlpha: 0.92, glow: 0.3 },
    },
    {
      id: 'graphite',
      name: 'Графит',
      scheme: 'dark',
      colors: {
        bg: '#17181c', 'bg-2': '#26282f', panel: '#1f2025', 'panel-2': '#28292f', input: '#1a1b20', border: '#34363e', titlebar: '#141519', rail: '#141519',
        text: '#f2f2f4', 'text-2': '#a7a9b2', 'text-3': '#6e717c', 'on-line': '#16171a',
        line: '#f2f2f4', 'line-2': '#9aa0ab', ok: '#7ee0a5', busy: '#e8c770', bad: '#f07070', down: '#7ee0a5', up: '#c9cbd2',
        'sub-1': '#e7e7ea', 'sub-2': '#8fb4ff', 'sub-3': '#d3a6ff', 'sub-4': '#7ee0a5', 'sub-5': '#ffa78f', 'sub-6': '#e8c770',
      },
      params: { bgEffect: 'solid', glow: 0.2 },
    },
    {
      id: 'sakura',
      name: 'Сакура',
      scheme: 'dark',
      colors: {
        bg: '#1b1018', 'bg-2': '#3f1a33', panel: '#25151f', 'panel-2': '#2f1b29', input: '#20121b', border: '#47283c', titlebar: '#160d13', rail: '#160d13',
        text: '#fff0f6', 'text-2': '#d6aec2', 'text-3': '#9a7088', 'on-line': '#2a0716',
        line: '#ff8fb8', 'line-2': '#c9a2ff', ok: '#8ff0c6', busy: '#ffd59a', bad: '#ff6b81', down: '#c9a2ff', up: '#ff8fb8',
        'sub-1': '#ff8fb8', 'sub-2': '#c9a2ff', 'sub-3': '#8ff0c6', 'sub-4': '#ffd59a', 'sub-5': '#8fd3ff', 'sub-6': '#ffb38f',
      },
      params: { bgEffect: 'stars', glow: 0.6 },
    },
    {
      id: 'sunset',
      name: 'Закат',
      scheme: 'dark',
      colors: {
        bg: '#1c0f14', 'bg-2': '#4a1a1f', panel: '#26141a', 'panel-2': '#311a21', input: '#211116', border: '#4a2a31', titlebar: '#170c10', rail: '#170c10',
        text: '#fff3ec', 'text-2': '#dcb2a4', 'text-3': '#9c7468', 'on-line': '#2a0a00',
        line: '#ff5e3a', 'line-2': '#ffb13b', ok: '#5ee6a8', busy: '#ffb13b', bad: '#ff4d6d', down: '#ffb13b', up: '#ff5e3a',
        'sub-1': '#ff5e3a', 'sub-2': '#ffb13b', 'sub-3': '#ff7aa2', 'sub-4': '#5ee6a8', 'sub-5': '#7cc4ff', 'sub-6': '#d49bff',
      },
      params: { bgEffect: 'aurora', panelAlpha: 0.8, blur: 12, glow: 0.65 },
    },
    {
      id: 'ocean',
      name: 'Голубая ветка',
      scheme: 'dark',
      colors: {
        bg: '#08182e', 'bg-2': '#0f3360', panel: '#0e2240', 'panel-2': '#132b50', input: '#0b1c36', border: '#1e3a66', titlebar: '#071428', rail: '#071428',
        text: '#ecf6ff', 'text-2': '#9fbad8', 'text-3': '#5f7ea3', 'on-line': '#02152a',
        line: '#2ea8ff', 'line-2': '#a3e4ff', ok: '#3fe0b0', busy: '#ffd166', bad: '#ff6b6b', down: '#a3e4ff', up: '#2ea8ff',
        'sub-1': '#2ea8ff', 'sub-2': '#3fe0b0', 'sub-3': '#ffd166', 'sub-4': '#ff8fab', 'sub-5': '#b39dff', 'sub-6': '#a3e4ff',
      },
      params: { bgEffect: 'stars' },
    },
  ];

  function defaultAppearance() {
    return { themeId: 'night', colors: {}, params: {}, saved: [] };
  }

  function findTheme(ap, id) {
    return PRESETS.find((t) => t.id === id) || (ap.saved || []).find((t) => t.id === id) || PRESETS[0];
  }

  /** Итоговая тема с учётом правок пользователя */
  function resolve(ap) {
    const base = findTheme(ap, ap.themeId);
    const colors = { ...PRESETS[0].colors, ...base.colors, ...(ap.colors || {}) };
    const params = { ...DEFAULT_PARAMS, ...(base.params || {}), ...(ap.params || {}) };
    const scheme = U().luminance(colors.bg) > 0.4 ? 'light' : 'dark';
    return { colors, params, scheme, base };
  }

  function apply(ap) {
    const r = resolve(ap);
    const root = document.documentElement;
    for (const t of TOKENS) root.style.setProperty(`--${t.key}`, r.colors[t.key]);
    const p = r.params;
    root.style.setProperty('--radius', `${p.radius}px`);
    root.style.setProperty('--line-w', `${p.lineWidth}px`);
    root.style.setProperty('--panel-alpha', String(p.panelAlpha));
    root.style.setProperty('--blur', `${p.blur}px`);
    root.style.setProperty('--glow', String(p.glow));
    root.style.setProperty('--anim', String(Math.max(0.25, p.anim)));
    root.style.setProperty('--font-ui', (FONTS[p.fontUi] || FONTS.onest).css);
    root.style.setProperty('--font-display', (FONTS[p.fontDisplay] || FONTS.jost).css);
    root.style.setProperty('--bg-dim', `${p.bgDim}%`);
    root.dataset.anim = p.animations ? 'on' : 'off';
    root.dataset.scheme = r.scheme;
    DR.api.setZoom(p.scale);
    if (window.DRNative && window.DRNative.setBars) {
      try {
        window.DRNative.setBars(r.colors.titlebar, r.scheme === 'light');
      } catch {
        /* старые версии */
      }
    }
    if (DR.background) DR.background.render(p, r.colors);
    document.dispatchEvent(new CustomEvent('dr:theme', { detail: r }));
    return r;
  }

  /** Случайная гармоничная тема */
  function random() {
    const u = U();
    const hue = Math.floor(Math.random() * 360);
    const light = Math.random() < 0.22;
    const scheme = [30, 140, 180, 210][Math.floor(Math.random() * 4)];
    const h2 = (hue + scheme) % 360;
    const c = {};
    if (light) {
      Object.assign(c, {
        bg: u.hslToHex(hue, 30, 94), 'bg-2': '#ffffff', panel: '#ffffff', 'panel-2': u.hslToHex(hue, 30, 97), input: u.hslToHex(hue, 25, 97),
        border: u.hslToHex(hue, 22, 84), titlebar: u.hslToHex(hue, 25, 90), rail: u.hslToHex(hue, 25, 90),
        text: u.hslToHex(hue, 30, 10), 'text-2': u.hslToHex(hue, 15, 34), 'text-3': u.hslToHex(hue, 12, 56),
        line: u.hslToHex(hue, 78, 46), 'line-2': u.hslToHex(h2, 75, 44), ok: '#079455', busy: '#d97706', bad: '#dc2626',
      });
    } else {
      Object.assign(c, {
        bg: u.hslToHex(hue, 38, 8), 'bg-2': u.hslToHex(hue, 45, 20), panel: u.hslToHex(hue, 32, 13), 'panel-2': u.hslToHex(hue, 30, 17), input: u.hslToHex(hue, 32, 11),
        border: u.hslToHex(hue, 26, 25), titlebar: u.hslToHex(hue, 36, 7), rail: u.hslToHex(hue, 36, 7),
        text: u.hslToHex(hue, 40, 95), 'text-2': u.hslToHex(hue, 20, 72), 'text-3': u.hslToHex(hue, 14, 50),
        line: u.hslToHex(hue, 92, 62), 'line-2': u.hslToHex(h2, 88, 64), ok: u.hslToHex(155, 65, 55), busy: u.hslToHex(42, 95, 62), bad: u.hslToHex(352, 90, 66),
      });
    }
    c['on-line'] = u.readableOn(c.line);
    c.down = c['line-2'];
    c.up = c.line;
    for (let i = 1; i <= 6; i++) c[`sub-${i}`] = u.hslToHex((hue + i * 55 - 55) % 360, light ? 70 : 85, light ? 45 : 63);
    const effects = ['map', 'grid', 'stars', 'aurora'];
    return { colors: c, params: { bgEffect: effects[Math.floor(Math.random() * effects.length)] } };
  }

  function toCode(theme) {
    const json = JSON.stringify({ n: theme.name, c: theme.colors, p: theme.params });
    return 'DRT1.' + btoa(unescape(encodeURIComponent(json)));
  }
  function fromCode(code) {
    const s = String(code || '').trim();
    if (!s.startsWith('DRT1.')) throw new Error('Это не код темы DeskRoute');
    const j = JSON.parse(decodeURIComponent(escape(atob(s.slice(5)))));
    const colors = {};
    for (const t of TOKENS) {
      const v = j.c && U().normalizeHex(j.c[t.key]);
      if (v) colors[t.key] = v;
    }
    const params = {};
    for (const k of Object.keys(DEFAULT_PARAMS)) if (j.p && k in j.p && k !== 'bgImage') params[k] = j.p[k];
    return { name: String(j.n || 'Импортированная тема').slice(0, 40), colors, params };
  }

  DR.themes = { TOKENS, PRESETS, DEFAULT_PARAMS, FONTS, BG_EFFECTS, defaultAppearance, resolve, apply, random, toCode, fromCode, findTheme };
})();
