/* DeskRoute для Android: логика приложения в WebView. Повторяет API главного процесса Electron,
   а VPN, сеть и буфер обмена выполняет нативная часть (window.DRNative). */
(function () {
  const N = window.DRNative;
  const req = window.__drRequire;
  const links = req('./links');
  const subscription = req('./subscription');
  const xc = req('./xray-config');
  const { uid, hash } = req('./util');
  const { DEFAULTS, deepMerge } = req('./store');

  const STORAGE_KEY = 'deskroute-data';
  const PORTS = { socks: 10808, http: 10809, metrics: 10813 };
  const listeners = [];
  const send = (type, payload) => {
    for (const cb of listeners) {
      try {
        cb(type, payload);
      } catch (e) {
        console.error(e);
      }
    }
  };

  /* ---------- данные ---------- */
  function load() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      raw = null;
    }
    const d = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), raw || {});
    d.settings.mode = 'tun';
    if (!raw) {
      d.settings.routing.preset = 'ru-direct';
    }
    if (!Array.isArray(d.servers)) d.servers = [];
    if (!Array.isArray(d.subscriptions)) d.subscriptions = [];
    d.runtime = d.runtime || {};
    return d;
  }
  const data = load();
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        pushLog(`Не удалось сохранить данные: ${e.message}`, 'error');
      }
    }, 300);
  }

  const info = (() => {
    try {
      return JSON.parse(N.appInfo());
    } catch {
      return { version: '', core: '' };
    }
  })();
  const coreVer = (/(\d+\.\d+\.\d+)/.exec(String(info.core).replace(/^.*?Xray[^\d]*/i, '')) || [])[1] || '';
  const GEO = window.DR_GEO || { site: [], ip: [] };
  const geoSets = { site: GEO.site.length ? new Set(GEO.site) : null, ip: GEO.ip.length ? new Set(GEO.ip) : null };
  const coreInfo = {
    installed: true,
    version: coreVer || 'встроено',
    bin: 'Встроено в приложение (libv2ray)',
    assetDir: '',
    latest: null,
    geo: {
      present: !!geoSets.site,
      ru: !!(geoSets.site && geoSets.site.has('category-ru')),
      ruBlocked: !!(geoSets.site && geoSets.site.has('ru-blocked')),
      ads: !!(geoSets.site && geoSets.site.has('category-ads-all')),
      siteCodes: GEO.site,
      ipCodes: GEO.ip,
      source: 'builtin',
    },
  };

  /* ---------- журнал ---------- */
  const logs = [];
  function pushLog(text, level) {
    const lv = level || (/\[Error\]|failed|panic/i.test(text) ? 'error' : /\[Warning\]/i.test(text) ? 'warning' : 'info');
    const e = { t: Date.now(), level: lv, text: String(text).slice(0, 2000) };
    logs.push(e);
    if (logs.length > 1500) logs.splice(0, logs.length - 1500);
    send('logs', [e]);
  }

  /* ---------- серверы и подписки ---------- */
  const displayName = (s) => (s && (s.customName || s.name)) || '';
  function publicServer(s) {
    const p = s.profile || {};
    return {
      id: s.id,
      subId: s.subId,
      name: displayName(s),
      originalName: s.name,
      protocol: p.protocol,
      inner: p.inner || null,
      network: p.network,
      security: p.security,
      flow: p.flow || '',
      address: p.address,
      port: p.port,
      favorite: !!s.favorite,
      latency: s.latency == null ? null : s.latency,
      latencyAt: s.latencyAt || 0,
      latencyError: s.latencyError || '',
      issue: p.issue || '',
      warnings: (p.warnings || []).filter((w) => !/allowInsecure/.test(w) || true),
      exportable: !!p.link,
    };
  }
  function publicSub(s) {
    return { id: s.id, url: s.url, name: s.name || '', title: s.title || '', updatedAt: s.updatedAt || 0, info: s.info || null, error: s.error || '', updating: !!s.updating, count: s.count || 0, collapsed: !!s.collapsed };
  }
  const dataPayload = () => ({ servers: data.servers.map(publicServer), subscriptions: data.subscriptions.map(publicSub), selectedId: data.selectedId });
  let dataTimer = 0;
  function emitData() {
    if (dataTimer) return;
    dataTimer = setTimeout(() => {
      dataTimer = 0;
      send('data', dataPayload());
    }, 60);
  }
  function serverEntry(p, subId, prev) {
    return {
      id: hash(`${subId || 'manual'}|${p.key}`, 14),
      subId: subId || null,
      name: p.name,
      customName: prev ? prev.customName || '' : '',
      favorite: prev ? !!prev.favorite : false,
      latency: prev ? prev.latency : null,
      latencyAt: prev ? prev.latencyAt || 0 : 0,
      latencyError: prev ? prev.latencyError || '' : '',
      profile: p,
    };
  }

  /* ---------- нативные запросы ---------- */
  const pending = new Map();
  let seq = 0;
  function nativeCall(fn) {
    return new Promise((resolve) => {
      const id = `r${++seq}`;
      pending.set(id, resolve);
      fn(id);
    });
  }
  async function httpGet(url, ua) {
    const r = await nativeCall((id) => N.httpGet(id, url, ua));
    if (r.error) {
      if (/Unable to resolve|UnknownHost/i.test(r.error)) throw new Error('Не удалось найти сервер подписки (DNS)');
      if (/timeout|timed out/i.test(r.error)) throw new Error('Сервер подписки не ответил вовремя');
      throw new Error(`Не удалось загрузить подписку: ${r.error}`);
    }
    if (r.status >= 400) throw new Error(`Сервер подписки ответил кодом ${r.status}`);
    return r;
  }

  async function updateSubscription(id, { silent } = {}) {
    const sub = data.subscriptions.find((s) => s.id === id);
    if (!sub) throw new Error('Подписка не найдена');
    if (sub.updating) return publicSub(sub);
    sub.updating = true;
    emitData();
    try {
      const { body, headers } = await httpGet(sub.url, data.settings.sub.userAgent);
      const parsed = subscription.parseSubscription(body, headers || {});
      if (!parsed.profiles.length) throw new Error(parsed.errors.length ? `Не удалось разобрать серверы: ${parsed.errors[0].error}` : 'В подписке нет серверов или формат не распознан');
      const old = new Map(data.servers.filter((s) => s.subId === id).map((s) => [s.id, s]));
      const selected = data.servers.find((s) => s.id === data.selectedId);
      const fresh = [];
      const seen = new Set();
      for (const p of parsed.profiles) {
        let e = serverEntry(p, id, null);
        let n = 1;
        while (seen.has(e.id)) e.id = hash(`${id}|${p.key}|${++n}`, 14);
        seen.add(e.id);
        const prev = old.get(e.id);
        if (prev) e = { ...serverEntry(p, id, prev), id: e.id };
        fresh.push(e);
      }
      const firstIdx = data.servers.findIndex((s) => s.subId === id);
      const rest = data.servers.filter((s) => s.subId !== id);
      const at = firstIdx < 0 ? rest.filter((s) => s.subId).length : Math.min(firstIdx, rest.length);
      rest.splice(at, 0, ...fresh);
      data.servers = rest;
      if (selected && selected.subId === id && !fresh.some((s) => s.id === selected.id)) data.selectedId = (fresh.find((s) => s.name === selected.name) || fresh[0]).id;
      if (!data.selectedId && fresh.length) data.selectedId = fresh[0].id;
      sub.info = parsed.info;
      sub.title = parsed.info.title || '';
      sub.updatedAt = Date.now();
      sub.error = '';
      sub.count = fresh.length;
      pushLog(`Подписка «${sub.name || sub.title || sub.url}» обновлена: ${fresh.length} серв.`, 'app');
      return publicSub(sub);
    } catch (e) {
      sub.error = e.message;
      pushLog(`Подписка: ${e.message}`, 'error');
      if (!silent) throw e;
      return publicSub(sub);
    } finally {
      sub.updating = false;
      save();
      emitData();
    }
  }

  async function addSubscription(url, name) {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) throw new Error('Ссылка подписки должна начинаться с http:// или https://');
    const ex = data.subscriptions.find((s) => s.url === u);
    if (ex) {
      await updateSubscription(ex.id);
      return { sub: publicSub(ex), existed: true };
    }
    const sub = { id: uid(), url: u, name: String(name || '').trim(), title: '', createdAt: Date.now(), updatedAt: 0, info: null, error: '', count: 0 };
    data.subscriptions.push(sub);
    save();
    try {
      await updateSubscription(sub.id);
    } catch (e) {
      return { sub: publicSub(sub), error: e.message };
    }
    return { sub: publicSub(sub) };
  }

  async function importText(text) {
    const r = links.parseText(text);
    let added = 0;
    let dup = 0;
    let firstId = null;
    for (const p of r.profiles) {
      const e = serverEntry(p, null, null);
      if (data.servers.some((s) => s.id === e.id)) {
        dup++;
        continue;
      }
      data.servers.push(e);
      if (!firstId) firstId = e.id;
      added++;
    }
    const errors = r.errors.map((e) => e.error);
    let subs = 0;
    for (const url of r.subscriptions) {
      const res = await addSubscription(url);
      subs++;
      if (res.error) errors.push(res.error);
    }
    if (!data.selectedId) data.selectedId = firstId || (data.servers[0] && data.servers[0].id) || null;
    save();
    emitData();
    if (!added && !subs && !dup && !errors.length) errors.push('Не найдено ни одной ссылки или подписки');
    return { added, dup, subs, errors };
  }

  /* ---------- подключение ---------- */
  const conn = { status: 'disconnected', serverId: data.runtime.serverId || null, since: 0, error: '', mode: 'tun', ports: null, killSwitch: null, zapret: false };
  const publicConn = () => ({ ...conn });
  function setConn(p) {
    Object.assign(conn, p);
    send('conn', publicConn());
  }

  function androidConfig(profile) {
    const s = { ...data.settings, mode: 'tun', allowLan: false };
    const { config, notes } = xc.buildConfig(profile, s, PORTS, geoSets, { zapret: false, marks: false });
    for (const ib of config.inbounds) {
      if (ib.protocol === 'tun') ib.settings = { name: 'xray0', MTU: 1500 };
    }
    for (const n of notes) if (!/zapret/.test(n)) pushLog(n, 'app');
    return config;
  }

  let stats = null;
  let lastMetrics = null;
  async function connect(id) {
    if (conn.status === 'connecting') return publicConn();
    const server = data.servers.find((s) => s.id === (id || data.selectedId));
    if (!server) throw new Error('Сначала выберите сервер');
    if (server.profile.issue) throw new Error(server.profile.issue);
    data.selectedId = server.id;
    data.runtime.serverId = server.id;
    save();
    emitData();
    const config = androidConfig(server.profile);
    pushLog(`Подключение к «${displayName(server)}»`, 'app');
    setConn({ status: 'connecting', serverId: server.id, error: '', since: 0 });
    N.startVpn(JSON.stringify(config));
    return publicConn();
  }
  function disconnect() {
    if (conn.status === 'disconnected') return publicConn();
    N.stopVpn();
    setConn({ status: 'disconnecting' });
    return publicConn();
  }
  function onVpn(p) {
    if (p.status === 'connected') {
      if (conn.status !== 'connected') {
        setConn({ status: 'connected', since: Date.now(), error: '', ports: { http: PORTS.http, socks: PORTS.socks } });
        pushLog('Подключено', 'app');
        lastMetrics = null;
        N.startStats(PORTS.metrics);
      }
    } else if (p.status === 'connecting') {
      if (conn.status !== 'connecting') setConn({ status: 'connecting' });
    } else if (p.status === 'error') {
      N.stopStats();
      stats = null;
      setConn({ status: 'error', error: p.error || 'Не удалось подключиться', since: 0, ports: null });
      pushLog(`Ошибка: ${p.error}`, 'error');
    } else {
      N.stopStats();
      stats = null;
      if (conn.status !== 'disconnected') pushLog('Отключено', 'app');
      setConn({ status: 'disconnected', since: 0, error: '', ports: null });
    }
  }
  function onMetrics(m) {
    const sum = (obj) => {
      let up = 0;
      let down = 0;
      for (const v of Object.values(obj || {})) {
        up += v.uplink || 0;
        down += v.downlink || 0;
      }
      return { up, down };
    };
    let t = sum(m.inbound);
    if (!t.up && !t.down) {
      const o = { ...(m.outbound || {}) };
      delete o.block;
      delete o['dns-out'];
      t = sum(o);
    }
    const now = Date.now();
    if (lastMetrics) {
      const dt = Math.max(0.2, (now - lastMetrics.at) / 1000);
      stats = { upSpeed: Math.max(0, (t.up - lastMetrics.up) / dt), downSpeed: Math.max(0, (t.down - lastMetrics.down) / dt), upTotal: t.up, downTotal: t.down, directTotal: 0 };
      send('stats', stats);
    }
    lastMetrics = { ...t, at: now };
  }

  let reconnectTimer = 0;
  function scheduleReconnect() {
    if (conn.status !== 'connected') return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (conn.status === 'connected') {
        pushLog('Применяю новые настройки — переподключение', 'app');
        const sid = conn.serverId;
        conn.status = 'reconnecting';
        connect(sid).catch((e) => send('toast', { type: 'error', text: e.message }));
      }
    }, 700);
  }

  /* ---------- задержка ---------- */
  let testing = false;
  async function testLatency(ids) {
    if (testing) return { busy: true };
    testing = true;
    const targets = Array.isArray(ids) && ids.length ? data.servers.filter((s) => ids.includes(s.id)) : data.servers.slice();
    send('latency:start', { ids: targets.map((t) => t.id), method: 'url' });
    const url = data.settings.latency.url || 'http://www.gstatic.com/generate_204';
    try {
      await Promise.all(
        targets.map(async (srv) => {
          let ms = null;
          let err = '';
          if (srv.profile.issue) err = srv.profile.issue;
          else {
            try {
              const ob = xc.buildOutbound(srv.profile, 'proxy', { standalone: true });
              const cfg = { log: { loglevel: 'none' }, outbounds: [ob, { tag: 'direct', protocol: 'freedom' }] };
              const r = await nativeCall((id) => N.measureDelay(id, JSON.stringify(cfg), url));
              if (r.ms > 0) ms = r.ms;
              else err = r.error || 'Нет ответа';
            } catch (e) {
              err = e.message;
            }
          }
          srv.latency = ms;
          srv.latencyAt = Date.now();
          srv.latencyError = ms == null ? err || 'Нет ответа' : '';
          send('latency', { id: srv.id, latency: ms, error: srv.latencyError });
        }),
      );
    } finally {
      testing = false;
      save();
      send('latency:done', {});
      emitData();
    }
    return { done: true };
  }

  /* ---------- события нативной части ---------- */
  window.__drNative = (type, p) => {
    if (type === 'http' || type === 'delay') {
      const fn = pending.get(p.id);
      if (fn) {
        pending.delete(p.id);
        fn(p);
      }
    } else if (type === 'vpn') onVpn(p);
    else if (type === 'metrics') onMetrics(p);
    else if (type === 'log') pushLog(p.text, p.level);
    else if (type === 'link' && p.text) send('deeplink', links.unwrapDeepLink(p.text));
  };

  /* ---------- API, как у главного процесса ---------- */
  const RECONNECT_KEYS = ['dns', 'mux', 'logLevel', 'routing', 'resolveForRouting'];
  const API = {
    snapshot: () => {
      let deepLink = '';
      try {
        deepLink = N.takeIntentText();
        if (deepLink) deepLink = links.unwrapDeepLink(deepLink);
      } catch {
        deepLink = '';
      }
      try {
        const st = JSON.parse(N.vpnStatus());
        if (st.status === 'connected') {
          conn.status = 'connected';
          conn.since = data.runtime.since || Date.now();
          conn.ports = { http: PORTS.http, socks: PORTS.socks };
          N.startStats(PORTS.metrics);
        }
      } catch {
        /* ignore */
      }
      return {
        ...dataPayload(),
        settings: data.settings,
        appearance: data.appearance,
        conn: publicConn(),
        core: coreInfo,
        stats,
        platform: 'android',
        version: info.version || '',
        maximized: false,
        logs: logs.slice(-400),
        deepLink: deepLink || null,
        zapret: {},
      };
    },
    connect: (id) => connect(id),
    disconnect: () => disconnect(),
    toggle: () => (conn.status === 'connected' || conn.status === 'connecting' ? disconnect() : connect()),
    select: async (id) => {
      if (!data.servers.some((s) => s.id === id)) throw new Error('Сервер не найден');
      data.selectedId = id;
      save();
      emitData();
      if (conn.status === 'connected' && conn.serverId !== id) await connect(id);
      return true;
    },
    detect: (text) => links.detect(text),
    importText: (text) => importText(text),
    readClipboard: () => N.readClipboard(),
    copyText: (t) => {
      N.copyText(String(t || ''));
      return true;
    },
    addSubscription,
    updateSubscription: (id) => updateSubscription(id),
    updateAll: async () => {
      const out = [];
      for (const s of data.subscriptions) out.push(await updateSubscription(s.id, { silent: true }));
      return out;
    },
    editSubscription: (id, patch) => {
      const s = data.subscriptions.find((x) => x.id === id);
      if (!s) throw new Error('Подписка не найдена');
      if (typeof patch.name === 'string') s.name = patch.name.trim().slice(0, 80);
      if (typeof patch.collapsed === 'boolean') s.collapsed = patch.collapsed;
      save();
      emitData();
      return publicSub(s);
    },
    removeSubscription: (id) => {
      if (conn.status === 'connected' && data.servers.some((s) => s.id === conn.serverId && s.subId === id)) disconnect();
      data.subscriptions = data.subscriptions.filter((s) => s.id !== id);
      data.servers = data.servers.filter((s) => s.subId !== id);
      if (!data.servers.some((s) => s.id === data.selectedId)) data.selectedId = data.servers[0] ? data.servers[0].id : null;
      save();
      emitData();
      return true;
    },
    removeServer: (id) => {
      if (conn.serverId === id && conn.status === 'connected') disconnect();
      data.servers = data.servers.filter((s) => s.id !== id);
      if (data.selectedId === id) data.selectedId = data.servers[0] ? data.servers[0].id : null;
      save();
      emitData();
      return true;
    },
    renameServer: (id, name) => {
      const s = data.servers.find((x) => x.id === id);
      if (!s) throw new Error('Сервер не найден');
      s.customName = String(name || '').trim().slice(0, 80);
      save();
      emitData();
      return true;
    },
    toggleFavorite: (id) => {
      const s = data.servers.find((x) => x.id === id);
      if (!s) throw new Error('Сервер не найден');
      s.favorite = !s.favorite;
      save();
      emitData();
      return s.favorite;
    },
    exportLink: (id) => {
      const s = data.servers.find((x) => x.id === id);
      if (!s || !s.profile.link) throw new Error('Для этого сервера нет ссылки');
      return s.profile.link;
    },
    testLatency: (ids) => testLatency(ids),
    setSettings: (patch) => {
      const clean = JSON.parse(JSON.stringify(patch || {}));
      delete clean.mode;
      const before = JSON.stringify(RECONNECT_KEYS.map((k) => data.settings[k]));
      data.settings = deepMerge(data.settings, clean);
      data.settings.mode = 'tun';
      save();
      if (before !== JSON.stringify(RECONNECT_KEYS.map((k) => data.settings[k]))) scheduleReconnect();
      return data.settings;
    },
    setRoutingList: (kind, list) => {
      if (!['direct', 'proxy', 'block'].includes(kind)) throw new Error('bad list');
      data.settings.routing[kind] = (list || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 2000);
      save();
      scheduleReconnect();
      return data.settings.routing;
    },
    setAppearance: (ap) => {
      data.appearance = ap;
      save();
      return true;
    },
    getLogs: () => logs.slice(-1500),
    clearLogs: () => {
      logs.length = 0;
      return true;
    },
    coreInfo: () => coreInfo,
    checkCoreUpdate: () => coreInfo.version,
    installCore: () => {
      throw new Error('В Android ядро встроено в приложение и обновляется вместе с ним');
    },
    installGeo: () => {
      throw new Error('В Android гео-базы встроены в приложение');
    },
    openFolder: () => true,
    openExternal: (url) => {
      if (/^https?:\/\//i.test(String(url || ''))) N.openUrl(url);
      return true;
    },
    openVpnSettings: () => {
      N.openVpnSettings();
      return true;
    },
    share: (text) => {
      N.share(String(text || ''));
      return true;
    },
    windowAction: () => false,
    isElevated: () => true,
    relaunchAsAdmin: () => true,
    pickBackground: () => null,
    consumeDeepLink: () => null,
    zapretStatus: () => ({}),
    releaseKillSwitch: () => disconnect(),
    coreCaps: () => ({ linux: false, has: true }),
    quit: () => true,
  };

  window.deskroute = {
    platform: 'android',
    invoke: async (method, ...args) => {
      const fn = API[method];
      if (!fn) return { ok: false, error: `Метод ${method} недоступен в Android` };
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    },
    on: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    setZoom: (f) => {
      document.documentElement.style.zoom = String(f);
    },
  };

  // автообновление подписок
  setTimeout(() => {
    if (data.settings.sub.updateOnStart && data.subscriptions.length) API.updateAll();
  }, 1500);
  setInterval(() => {
    if (!data.settings.sub.autoUpdate) return;
    for (const s of data.subscriptions) {
      const hours = (s.info && s.info.updateInterval) || data.settings.sub.intervalHours || 12;
      if (!s.updating && Date.now() - (s.updatedAt || 0) > hours * 3600e3) updateSubscription(s.id, { silent: true });
    }
  }, 10 * 60e3);
  // запоминаем время подключения, чтобы таймер не сбрасывался при повторном открытии
  setInterval(() => {
    if (conn.status === 'connected' && data.runtime.since !== conn.since) {
      data.runtime.since = conn.since;
      save();
    }
  }, 5000);
})();
