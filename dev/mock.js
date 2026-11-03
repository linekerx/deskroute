/* Демо-режим: имитация главного процесса для просмотра интерфейса в браузере */
(function () {
  const DR = (window.DR = window.DR || {});
  const listeners = [];
  const emit = (type, payload) => listeners.forEach((cb) => cb(type, payload));
  const U = 'bd2a9c3e-1111-4c2b-9a3f-0c5d6e7f8a9b';
  const now = Date.now();

  const mk = (id, subId, name, protocol, network, security, address, latency, extra = {}) => ({
    id, subId, name, originalName: name, protocol, network, security, address, port: 443, favorite: false,
    latency, latencyAt: latency === undefined ? 0 : now - 600000, latencyError: latency === null ? 'Нет ответа' : '', issue: '', warnings: [], exportable: true, flow: '', inner: null, ...extra,
  });

  const state = {
    settings: {
      mode: 'system', socksPort: 10808, httpPort: 10809, allowLan: false, dns: 'https://1.1.1.1/dns-query', resolveForRouting: false, mux: false, logLevel: 'warning',
      autoConnect: false, launchAtLogin: true, startMinimized: false, closeToTray: true,
      routing: { preset: 'ru-direct', blockAds: true, direct: ['sberbank.ru', 'geosite:category-gov-ru'], proxy: ['geosite:youtube', 'chatgpt.com', 'openai.com'], block: ['geosite:category-ads-all'] },
      sub: { userAgent: 'DeskRoute/1.0', updateOnStart: true, autoUpdate: true, intervalHours: 12 },
      latency: { method: 'url', url: 'http://www.gstatic.com/generate_204', timeout: 6000 },
      geoSource: 'standard',
      killSwitch: 'strict',
      zapretCompat: 'auto',
    },
    appearance: null,
    subscriptions: [
      {
        id: 'sub1', url: 'https://sub.example.net/s/Xk9fQ2', name: '', title: 'Северный экспресс', updatedAt: now - 22 * 60e3, error: '', updating: false, count: 8, collapsed: false,
        info: { userinfo: { upload: 3.1e9, download: 37.2e9, total: 107374182400, expire: Math.floor(now / 1000) + 23 * 86400 }, announce: 'Новые серверы в Финляндии и Казахстане уже в подписке. Обновите приложение, если видите старый список.', supportUrl: 'https://t.me/example', webPageUrl: 'https://example.net' },
      },
      { id: 'sub2', url: 'https://reserve.example.org/api/sub/77', name: 'Резерв', title: '', updatedAt: now - 5 * 3600e3, error: '', updating: false, count: 3, collapsed: false, info: { userinfo: { upload: 0.2e9, download: 4.4e9, total: 0, expire: 0 } } },
    ],
    servers: [
      mk('a1', 'sub1', '🇳🇱 Нидерланды, Амстердам', 'vless', 'tcp', 'reality', 'nl1.sevexp.net', 41, { flow: 'xtls-rprx-vision', favorite: true }),
      mk('a2', 'sub1', '🇩🇪 Германия, Франкфурт', 'vless', 'xhttp', 'reality', 'de2.sevexp.net', 48, { favorite: true }),
      mk('a3', 'sub1', '🇫🇮 Финляндия, Хельсинки', 'vless', 'tcp', 'reality', 'fi1.sevexp.net', 33, { flow: 'xtls-rprx-vision', favorite: true }),
      mk('a4', 'sub1', '🇸🇪 Швеция', 'trojan', 'tcp', 'tls', 'se.sevexp.net', 57),
      mk('a5', 'sub1', '🇰🇿 Казахстан, Алматы', 'vless', 'grpc', 'tls', 'kz.sevexp.net', 92),
      mk('a6', 'sub1', '🇹🇷 Турция, Стамбул', 'hysteria2', 'hysteria', 'tls', 'tr.sevexp.net', 118),
      mk('a7', 'sub1', '🇺🇸 США, Нью-Йорк', 'vless', 'ws', 'tls', 'us.sevexp.net', 164),
      mk('a8', 'sub1', '🇯🇵 Япония, Токио', 'vless', 'tcp', 'reality', 'jp.sevexp.net', null),
      mk('b1', 'sub2', 'PL Варшава', 'vless', 'tcp', 'reality', 'waw.reserve.org', 52),
      mk('b2', 'sub2', 'LV Рига', 'shadowsocks', 'tcp', 'none', 'rix.reserve.org', 61),
      mk('b3', 'sub2', 'UK London', 'vmess', 'ws', 'tls', 'lon.reserve.org', 79, { warnings: ['VMess устарел — по возможности используйте VLESS'] }),
      mk('c1', null, 'Домашний сервер', 'vless', 'ws', 'tls', 'my.home-vpn.ru', 24),
      mk('c2', null, 'Старый конфиг', 'vless', 'h2', 'tls', '203.0.113.9', undefined, { issue: 'Транспорт HTTP/2 удалён в Xray 26 — попросите у провайдера конфиг с XHTTP' }),
    ],
    selectedId: 'a1',
    conn: { status: 'disconnected', serverId: null, since: 0, error: '', mode: null, ports: null },
    core: {
      installed: true, version: '26.10.31', bin: 'C:\\Users\\Me\\AppData\\Roaming\\DeskRoute\\core\\xray.exe', assetDir: '',
      geo: { present: true, ru: true, ruBlocked: false, ads: true, source: 'standard', siteCodes: ['category-ads-all', 'category-gov-ru', 'category-ru', 'discord', 'google', 'instagram', 'netflix', 'openai', 'private', 'telegram', 'twitter', 'youtube'], ipCodes: ['cloudflare', 'private', 'ru', 'telegram'] },
    },
    logs: [],
    version: '1.0.0',
  };

  const log = (text, level) => {
    const e = { t: Date.now(), level: level || 'info', text };
    state.logs.push(e);
    emit('logs', [e]);
  };
  ['Xray 26.10.31 started', 'Подписка «Северный экспресс» обновлена: 8 серв.'].forEach((t, i) => state.logs.push({ t: now - 60000 + i * 1000, level: i ? 'app' : 'warning', text: t }));

  let statTimer = 0;
  let totals = { up: 0, down: 0 };
  let phase = 0;
  function startStats() {
    clearInterval(statTimer);
    totals = { up: 0, down: 0 };
    statTimer = setInterval(() => {
      phase += 1;
      const down = Math.max(0, 2.2e6 + Math.sin(phase / 4) * 1.6e6 + Math.random() * 1.2e6);
      const up = Math.max(0, 0.25e6 + Math.cos(phase / 3) * 0.18e6 + Math.random() * 0.15e6);
      totals.down += down;
      totals.up += up;
      emit('stats', { downSpeed: down, upSpeed: up, downTotal: totals.down, upTotal: totals.up });
    }, 1000);
  }
  const data = () => ({ servers: state.servers, subscriptions: state.subscriptions, selectedId: state.selectedId });
  const setConn = (p) => {
    Object.assign(state.conn, p);
    emit('conn', { ...state.conn });
  };

  const api = {
    snapshot: () => ({ zapret: { running: true, kind: 'winws', root: 'C:\\Users\\Me\\Downloads\\zapret-discord-youtube-1.9.0', lists: { ipsetExclude: 'x', listExclude: 'y' }, active: true }, ...JSON.parse(JSON.stringify(data())), settings: state.settings, appearance: state.appearance, conn: state.conn, core: state.core, stats: null, platform: 'win32', version: state.version, maximized: false, logs: state.logs }),
    connect: async (id) => {
      const sid = id || state.selectedId;
      state.selectedId = sid;
      setConn({ status: 'connecting', serverId: sid, error: '' });
      await new Promise((r) => setTimeout(r, 1300));
      setConn({ status: 'connected', since: Date.now(), mode: state.settings.mode, ports: { http: state.settings.httpPort, socks: state.settings.socksPort }, killSwitch: state.settings.killSwitch === 'off' ? null : state.settings.killSwitch, zapret: true });
      log('Подключено', 'app');
      startStats();
      return state.conn;
    },
    disconnect: async () => {
      clearInterval(statTimer);
      setConn({ status: 'disconnected', since: 0 });
      log('Отключено', 'app');
      return state.conn;
    },
    toggle: () => (state.conn.status === 'connected' ? api.disconnect() : api.connect()),
    select: async (id) => {
      state.selectedId = id;
      emit('data', data());
      if (state.conn.status === 'connected') await api.connect(id);
      return true;
    },
    detect: (t) => {
      const lines = String(t).split(/\s+/).filter(Boolean);
      return { profiles: lines.filter((l) => /^(vless|vmess|trojan|ss|hy2|hysteria2|socks):\/\//i.test(l)).length, subscriptions: lines.filter((l) => /^https?:\/\//i.test(l)).length, errors: 0, firstError: '' };
    },
    importText: async () => ({ added: 1, subs: 0, dup: 0, errors: [] }),
    readClipboard: () => '',
    copyText: () => true,
    addSubscription: async () => ({ sub: state.subscriptions[0] }),
    updateSubscription: async (id) => {
      const s = state.subscriptions.find((x) => x.id === id);
      s.updating = true;
      emit('data', data());
      await new Promise((r) => setTimeout(r, 900));
      s.updating = false;
      s.updatedAt = Date.now();
      emit('data', data());
      return s;
    },
    updateAll: async () => {
      for (const s of state.subscriptions) await api.updateSubscription(s.id);
      return state.subscriptions;
    },
    editSubscription: (id, patch) => {
      Object.assign(state.subscriptions.find((x) => x.id === id), patch);
      emit('data', data());
      return true;
    },
    removeSubscription: (id) => {
      state.subscriptions = state.subscriptions.filter((x) => x.id !== id);
      state.servers = state.servers.filter((x) => x.subId !== id);
      emit('data', data());
      return true;
    },
    removeServer: (id) => {
      state.servers = state.servers.filter((x) => x.id !== id);
      emit('data', data());
      return true;
    },
    renameServer: (id, name) => {
      state.servers.find((x) => x.id === id).name = name;
      emit('data', data());
      return true;
    },
    toggleFavorite: (id) => {
      const s = state.servers.find((x) => x.id === id);
      s.favorite = !s.favorite;
      emit('data', data());
      return s.favorite;
    },
    exportLink: () => `vless://${U}@nl1.sevexp.net:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sid=6ba85179e30d4fc2&type=tcp#NL`,
    testLatency: async (ids) => {
      const list = ids && ids.length ? ids : state.servers.map((s) => s.id);
      emit('latency:start', { ids: list });
      for (const id of list) {
        await new Promise((r) => setTimeout(r, 120));
        const s = state.servers.find((x) => x.id === id);
        if (!s) continue;
        s.latency = s.issue ? null : Math.round(25 + Math.random() * 150);
        s.latencyAt = Date.now();
        emit('latency', { id, latency: s.latency, error: s.latency == null ? 'Нет ответа' : '' });
      }
      emit('latency:done', {});
      return { done: true };
    },
    setSettings: (patch) => {
      const merge = (a, b) => {
        for (const k of Object.keys(b)) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge({ ...(a[k] || {}) }, b[k]) : b[k];
        return a;
      };
      state.settings = merge({ ...state.settings }, patch);
      return state.settings;
    },
    setRoutingList: (kind, list) => {
      state.settings.routing[kind] = list;
      return state.settings.routing;
    },
    setAppearance: (ap) => {
      state.appearance = ap;
      return true;
    },
    getLogs: () => state.logs,
    clearLogs: () => {
      state.logs = [];
      return true;
    },
    coreInfo: () => state.core,
    checkCoreUpdate: () => '26.10.31',
    installCore: async () => {
      for (let p = 0; p <= 1; p += 0.1) {
        emit('progress', { kind: 'core', p });
        await new Promise((r) => setTimeout(r, 120));
      }
      emit('progress', { kind: 'core', p: null });
      return state.core;
    },
    installGeo: async () => {
      state.core.geo.ruBlocked = true;
      emit('core', state.core);
      return state.core;
    },
    openFolder: () => true,
    openExternal: () => true,
    windowAction: () => false,
    isElevated: () => false,
    relaunchAsAdmin: () => true,
    pickBackground: () => null,
    consumeDeepLink: () => null,
    zapretStatus: () => ({ running: true, kind: 'winws', root: 'C:\\Users\\Me\\Downloads\\zapret-discord-youtube-1.9.0', lists: { ipsetExclude: 'x', listExclude: 'y' }, active: true }),
    zapretAddExclusions: () => ({ ips: 11, domains: 6 }),
    pickZapretFolder: () => null,
    releaseKillSwitch: () => api.disconnect(),
    coreCaps: () => ({ linux: false, has: false }),
    grantCoreCaps: () => true,
  };

  DR.mock = {
    state,
    api,
    emit,
    bridge: {
      platform: 'win32',
      invoke: async (m, ...a) => {
        try {
          if (!api[m]) return { ok: false, error: `mock: нет метода ${m}` };
          return { ok: true, value: await api[m](...a) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      on: (cb) => {
        listeners.push(cb);
        return () => {};
      },
    },
  };
})();
