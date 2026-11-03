/* Состояние интерфейса и шина событий */
(function () {
  const DR = (window.DR = window.DR || {});
  const listeners = {};

  const state = {
    settings: null,
    appearance: null,
    servers: [],
    subscriptions: [],
    selectedId: null,
    conn: { status: 'disconnected' },
    core: { installed: false, geo: {} },
    stats: null,
    logs: [],
    platform: 'win32',
    version: '',
    maximized: false,
    testing: new Set(),
    progress: { core: null, geo: null },
    zapret: {},
    speed: [],
  };

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return () => {
      listeners[evt] = listeners[evt].filter((f) => f !== fn);
    };
  }
  function emit(evt, data) {
    for (const fn of listeners[evt] || []) {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    }
  }

  function server(id) {
    return state.servers.find((s) => s.id === id) || null;
  }
  function selected() {
    return server(state.conn.serverId && state.conn.status !== 'disconnected' ? state.conn.serverId : state.selectedId) || server(state.selectedId);
  }
  function subColor(subId) {
    const i = state.subscriptions.findIndex((s) => s.id === subId);
    return i < 0 ? 'var(--line)' : `var(--sub-${(i % 6) + 1})`;
  }
  function subTitle(sub) {
    if (!sub) return 'Мои серверы';
    if (sub.name) return sub.name;
    if (sub.title) return sub.title;
    try {
      return new URL(sub.url).hostname;
    } catch {
      return 'Подписка';
    }
  }
  function groups() {
    const out = state.subscriptions.map((sub, i) => ({ sub, color: `var(--sub-${(i % 6) + 1})`, index: i, servers: state.servers.filter((s) => s.subId === sub.id) }));
    const manual = state.servers.filter((s) => !s.subId);
    if (manual.length) out.push({ sub: null, color: 'var(--line)', index: -1, servers: manual });
    return out;
  }

  function init(snap) {
    Object.assign(state, {
      settings: snap.settings,
      appearance: snap.appearance || DR.themes.defaultAppearance(),
      servers: snap.servers || [],
      subscriptions: snap.subscriptions || [],
      selectedId: snap.selectedId,
      conn: snap.conn || { status: 'disconnected' },
      core: snap.core || { installed: false, geo: {} },
      stats: snap.stats,
      logs: snap.logs || [],
      zapret: snap.zapret || {},
      platform: snap.platform || 'win32',
      version: snap.version || '',
      maximized: !!snap.maximized,
    });
    if (!state.appearance.saved) state.appearance.saved = [];
  }

  const saveAppearance = DR.util.debounce(() => {
    const r = DR.themes.resolve(state.appearance);
    state.appearance.windowBg = r.colors.bg;
    DR.api.invoke('setAppearance', state.appearance).catch(() => {});
  }, 400);

  function setAppearance(mut) {
    mut(state.appearance);
    DR.themes.apply(state.appearance);
    saveAppearance();
    emit('appearance', state.appearance);
  }

  async function setSettings(patch) {
    const s = await DR.api.invoke('setSettings', patch);
    state.settings = s;
    emit('settings', s);
    return s;
  }

  DR.store = { state, on, emit, server, selected, subColor, subTitle, groups, init, setAppearance, setSettings };
})();
