'use strict';
/**
 * DeskRoute — главный процесс Electron.
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, clipboard, dialog, net, Notification, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const { Store } = require('./store');
const links = require('./links');
const { fetchSubscription, parseSubscription } = require('./subscription');
const { buildConfig } = require('./xray-config');
const { CoreProcess, StatsPoller, coreVersion, BIN_NAME } = require('./core');
const sysproxy = require('./sysproxy');
const latency = require('./latency');
const updater = require('./updater');
const geo = require('./geo');
const zapret = require('./zapret');
const killswitch = require('./killswitch');
const elevate = require('./elevate');
const { uid, hash, isPortFree, getFreePort, sleep } = require('./util');
const { deepMerge } = require('./store');

const APP_ID = 'app.deskroute.client';
const PROTOCOL = 'deskroute';
const isMac = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

let win = null;
let tray = null;
let store = null;
let quitting = false;
let cleanupDone = false;
let testing = false;
let lastStats = null;
let coreInfo = { installed: false, version: null, bin: null, assetDir: null, geo: {}, latest: null };
const busy = { core: false, geo: false };
const core = new CoreProcess();
const stats = new StatsPoller();
const conn = { status: 'disconnected', serverId: null, since: 0, error: '', mode: null, ports: null };
const logBuffer = [];
let pendingLogs = [];
let logTimer = null;
let dataTimer = null;
let reconnectTimer = null;
let pendingDeepLink = null;

/* ---------- пути ---------- */

const userDir = () => app.getPath('userData');
const runtimeDir = () => {
  const d = path.join(userDir(), 'runtime');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const resourcePath = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(ROOT, ...p));

function corePaths() {
  const dirs = [path.join(userDir(), 'core'), resourcePath('core')];
  const binDir = dirs.find((d) => fs.existsSync(path.join(d, BIN_NAME))) || null;
  const hasGeo = (d) => d && fs.existsSync(path.join(d, 'geoip.dat')) && fs.existsSync(path.join(d, 'geosite.dat'));
  const assetDir = [path.join(userDir(), 'geo'), binDir, ...dirs].find(hasGeo) || binDir;
  return { bin: binDir ? path.join(binDir, BIN_NAME) : null, binDir, assetDir };
}

function appIcon(name = 'icon.png') {
  return path.join(ROOT, 'assets', name);
}

/* ---------- связь с окном ---------- */

function send(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('dr:event', type, payload);
}

function detectLevel(t) {
  if (/\[Error\]|failed|panic|fatal/i.test(t)) return 'error';
  if (/\[Warning\]/i.test(t)) return 'warning';
  if (/\[Debug\]/i.test(t)) return 'debug';
  return 'info';
}

function pushLog(text, level) {
  const entry = { t: Date.now(), level: level || detectLevel(text), text: String(text).slice(0, 2000) };
  logBuffer.push(entry);
  if (logBuffer.length > 1500) logBuffer.splice(0, logBuffer.length - 1500);
  pendingLogs.push(entry);
  if (!logTimer) {
    logTimer = setTimeout(() => {
      logTimer = null;
      send('logs', pendingLogs);
      pendingLogs = [];
    }, 150);
  }
}

function toast(type, text) {
  send('toast', { type, text });
}

function notify(title, body) {
  if (win && win.isVisible() && win.isFocused()) return;
  try {
    if (Notification.isSupported()) new Notification({ title, body, icon: appIcon() }).show();
  } catch {
    /* ignore */
  }
}

/* ---------- данные для интерфейса ---------- */

function displayName(s) {
  return (s && (s.customName || s.name)) || '';
}

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
    warnings: p.warnings || [],
    exportable: !!p.link,
  };
}

function publicSub(s) {
  return {
    id: s.id,
    url: s.url,
    name: s.name || '',
    title: s.title || '',
    updatedAt: s.updatedAt || 0,
    info: s.info || null,
    error: s.error || '',
    updating: !!s.updating,
    count: s.count || 0,
    collapsed: !!s.collapsed,
  };
}

function dataPayload() {
  const d = store.get();
  return { servers: d.servers.map(publicServer), subscriptions: d.subscriptions.map(publicSub), selectedId: d.selectedId };
}

function emitData() {
  if (dataTimer) return;
  dataTimer = setTimeout(() => {
    dataTimer = null;
    send('data', dataPayload());
  }, 60);
}

function publicConn() {
  const k = store && store.get().runtime.killSwitch;
  return { status: conn.status, serverId: conn.serverId, since: conn.since, error: conn.error, mode: conn.mode, ports: conn.ports, killSwitch: k && k.active ? k.kind : null, zapret: !!zapretState.active };
}

function setConn(patch) {
  Object.assign(conn, patch);
  send('conn', publicConn());
  updateTray();
}

function snapshot() {
  const d = store.get();
  return {
    ...dataPayload(),
    settings: d.settings,
    appearance: d.appearance,
    conn: publicConn(),
    core: coreInfo,
    stats: lastStats,
    platform: process.platform,
    version: app.getVersion(),
    maximized: win ? win.isMaximized() : false,
    logs: logBuffer.slice(-400),
    deepLink: pendingDeepLink,
    zapret: zapretState,
  };
}

/* ---------- ядро и гео-базы ---------- */

async function refreshCoreInfo() {
  const { bin, assetDir } = corePaths();
  const version = await coreVersion(bin);
  const g = geo.geoInfo(assetDir);
  coreInfo = {
    ...coreInfo,
    installed: !!(bin && version),
    version,
    bin,
    assetDir,
    geo: {
      present: !!(g.ip && g.site),
      ru: !!(g.site && g.site.has('category-ru')),
      ruBlocked: !!(g.site && g.site.has('ru-blocked')),
      ads: !!(g.site && g.site.has('category-ads-all')),
      siteCodes: g.site ? [...g.site].sort() : [],
      ipCodes: g.ip ? [...g.ip].sort() : [],
      source: store.get().settings.geoSource,
    },
  };
  send('core', coreInfo);
  return coreInfo;
}

const fetchImpl = (url, init) => net.fetch(url, init);

/* ---------- подключение ---------- */

function currentServer() {
  const d = store.get();
  return d.servers.find((s) => s.id === (conn.serverId || d.selectedId)) || null;
}

function describe(s) {
  const p = s.profile || {};
  return [p.inner || p.protocol, p.network, p.security].filter((x) => x && x !== 'none').join(' · ');
}

async function safeClearProxy() {
  const d = store.get();
  try {
    await sysproxy.clearSystemProxy();
  } catch (e) {
    pushLog(`Не удалось снять системный прокси: ${e.message}`, 'warning');
  }
  d.runtime.proxySet = false;
  store.save();
}

async function waitPortFree(port, host, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isPortFree(port, host)) return true;
    await sleep(150);
  }
  return isPortFree(port, host);
}

async function stopCore() {
  stats.stop();
  await core.stop();
  store.get().runtime.corePid = null;
  store.save();
}

let zapretState = { running: false, kind: null, root: null, lists: {}, active: false, checkedAt: 0 };

async function refreshZapret() {
  try {
    const z = await zapret.detect(store.get().settings.zapretPath || '');
    zapretState = { ...z, active: zapretState.active, checkedAt: Date.now() };
  } catch {
    zapretState = { ...zapretState, running: false, checkedAt: Date.now() };
  }
  send('zapret', zapretState);
  return zapretState;
}

function ksState() {
  const k = store.get().runtime.killSwitch;
  return k && k.active ? k : null;
}

/** Включает kill switch выбранного типа. Повторный вызов обновляет правила, сохраняя исходное состояние. */
async function engageKillSwitch(kind, { bin, tun, needCaps }) {
  const d = store.get();
  const prevKs = ksState();
  if (kind === 'strict') {
    const prev = prevKs && prevKs.kind === 'strict' ? prevKs.prev : null;
    const saved = await killswitch.enable({ xrayPath: bin, appPath: process.execPath, tun, prev, needCaps, dir: runtimeDir() });
    d.runtime.killSwitch = { active: true, kind, prev: saved || prev || null };
  } else {
    if (prevKs && prevKs.kind === 'strict') await killswitch.disable(prevKs.prev).catch(() => {});
    d.runtime.killSwitch = { active: true, kind };
  }
  store.flush();
}

async function releaseKillSwitch() {
  const k = ksState();
  if (!k) return false;
  if (k.kind === 'strict') {
    try {
      await killswitch.disable(k.prev);
    } catch (e) {
      pushLog(`Не удалось снять блокировку kill switch: ${e.message}`, 'error');
      throw new Error(`Не удалось снять блокировку: ${e.message}`);
    }
  }
  store.get().runtime.killSwitch = { active: false };
  store.flush();
  pushLog('Kill switch выключен, интернет разблокирован', 'app');
  return true;
}

async function connect(id) {
  if (conn.status === 'connecting' || conn.status === 'disconnecting') return publicConn();
  const d = store.get();
  const server = d.servers.find((s) => s.id === (id || d.selectedId));
  if (!server) throw new Error('Сначала выберите сервер');
  const { bin, assetDir } = corePaths();
  if (!bin) throw new Error('Ядро Xray не установлено. Откройте Настройки → Ядро и нажмите «Скачать ядро».');
  const s = d.settings;
  const switching = conn.status === 'connected';
  const ksBefore = !!ksState();
  if (switching) await stopCore();
  d.selectedId = server.id;
  setConn({ status: 'connecting', serverId: server.id, error: '' });
  emitData();
  try {
    const ksKind = s.killSwitch === 'strict' || s.killSwitch === 'soft' ? s.killSwitch : 'off';
    const isLinux = process.platform === 'linux';
    if (process.platform === 'win32' && (s.mode === 'tun' || ksKind === 'strict') && !(await sysproxy.isElevated())) {
      // перезапускаемся с правами администратора и сразу подключаемся (окно UAC — только в первый раз)
      await relaunchElevated({ connect: server.id });
      return publicConn();
    }
    let caps = isLinux ? await zapret.coreHasCaps(bin) : false;
    if (isLinux && s.mode === 'tun' && !caps && ksKind !== 'strict') {
      pushLog('Для TUN ядру нужны сетевые права — система спросит пароль', 'app');
      await killswitch.grantCaps(bin);
      caps = true;
    }
    // zapret
    const zMode = s.zapretCompat || 'auto';
    const z = await refreshZapret();
    const zActive = zMode === 'on' || (zMode === 'auto' && z.running);
    zapretState.active = zActive;
    if (z.running) pushLog(`Найден zapret (${z.kind})${zActive ? ' — включаю совместимость' : ''}`, 'app');

    // Linux: строгий kill switch ставится до запуска ядра (заодно выдаёт права для меток)
    if (isLinux && ksKind === 'strict') {
      if (!caps || !ksBefore) pushLog('Включаю kill switch — система может спросить пароль', 'app');
      await engageKillSwitch('strict', { bin, tun: s.mode === 'tun', needCaps: !caps });
      caps = true;
    }

    const host = s.allowLan ? '0.0.0.0' : '127.0.0.1';
    for (const p of [s.socksPort, s.httpPort]) {
      if (!(await waitPortFree(p, host, switching ? 2500 : 0))) throw new Error(`Порт ${p} занят другой программой. Закройте её или смените порт в настройках.`);
    }
    const ports = { socks: s.socksPort, http: s.httpPort, metrics: await getFreePort() };
    const { config, notes } = buildConfig(server.profile, s, ports, geo.geoInfo(assetDir), { zapret: zActive, marks: isLinux && caps });
    notes.forEach((n) => pushLog(n, 'app'));
    const configPath = path.join(runtimeDir(), 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    pushLog(`Подключение к «${displayName(server)}» (${describe(server)})`, 'app');
    await core.start({ bin, assetDir, configPath, readyPort: ports.http, mode: s.mode });
    d.runtime.corePid = core.pid;
    if (s.mode === 'system') {
      const extra = zActive && ksKind !== 'strict' ? zapret.DOMAINS : [];
      await sysproxy.setSystemProxy({ host: '127.0.0.1', httpPort: ports.http, socksPort: ports.socks, extra });
      d.runtime.proxySet = true;
    } else if (d.runtime.proxySet) {
      await safeClearProxy();
    }
    if (ksKind === 'strict' && !isLinux) await engageKillSwitch('strict', { bin, tun: s.mode === 'tun' });
    else if (ksKind === 'soft') await engageKillSwitch('soft', {});
    else if (ksKind === 'off' && ksState()) await releaseKillSwitch();
    store.save();
    stats.start(ports.metrics);
    lastStats = null;
    setConn({ status: 'connected', serverId: server.id, since: Date.now(), mode: s.mode, ports, error: '' });
    pushLog(ksState() ? `Подключено, kill switch: ${ksState().kind === 'strict' ? 'строгий' : 'мягкий'}` : 'Подключено', 'app');
    return publicConn();
  } catch (e) {
    await stopCore();
    // если kill switch уже держал сеть до этой попытки — оставляем блокировку
    if (!ksBefore && ksState()) await releaseKillSwitch().catch(() => {});
    if (d.runtime.proxySet && !(ksBefore && ksState())) await safeClearProxy();
    const held = ksState() ? ' Kill switch держит интернет заблокированным — подключитесь снова или нажмите «Снять блокировку».' : '';
    setConn({ status: 'error', error: e.message + held, since: 0 });
    pushLog(`Ошибка подключения: ${e.message}`, 'error');
    throw e;
  }
}

async function disconnect() {
  if (conn.status === 'disconnected' && !ksState()) return publicConn();
  setConn({ status: 'disconnecting' });
  stats.stop();
  if (store.get().runtime.proxySet) await safeClearProxy();
  await stopCore();
  try {
    await releaseKillSwitch();
  } catch (e) {
    toast('error', e.message);
  }
  lastStats = null;
  setConn({ status: 'disconnected', since: 0, error: '', ports: null });
  pushLog('Отключено', 'app');
  return publicConn();
}

async function toggle() {
  if (conn.status === 'connected' || conn.status === 'connecting') return disconnect();
  return connect();
}

function scheduleReconnect() {
  if (conn.status !== 'connected') return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (conn.status === 'connected') {
      pushLog('Применяю новые настройки — переподключение', 'app');
      connect(conn.serverId).catch((e) => toast('error', e.message));
    }
  }, 700);
}

core.on('log', (line) => pushLog(line));
core.on('crash', async ({ message }) => {
  stats.stop();
  const ks = ksState();
  // kill switch: системный прокси не снимаем (мягкий) и не трогаем правила (строгий) — сайты не откроются мимо VPN
  if (store.get().runtime.proxySet && !ks) await safeClearProxy();
  store.get().runtime.corePid = null;
  store.save();
  const held = ks ? ' Kill switch заблокировал интернет, чтобы трафик не пошёл мимо VPN.' : '';
  setConn({ status: 'error', error: `Ядро остановилось: ${message}.${held}`, since: 0 });
  pushLog(`Ядро неожиданно завершилось: ${message}`, 'error');
  notify('DeskRoute — соединение прервано', ks ? 'Kill switch заблокировал интернет. Переподключитесь или снимите блокировку.' : message);
});
stats.on('stats', (st) => {
  lastStats = st;
  send('stats', st);
});

/* ---------- подписки и серверы ---------- */

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

async function updateSubscription(id, { silent } = {}) {
  const d = store.get();
  const sub = d.subscriptions.find((s) => s.id === id);
  if (!sub) throw new Error('Подписка не найдена');
  if (sub.updating) return publicSub(sub);
  sub.updating = true;
  emitData();
  try {
    const { body, headers } = await fetchSubscription(sub.url, { userAgent: d.settings.sub.userAgent, fetchImpl });
    const parsed = parseSubscription(body, headers);
    if (!parsed.profiles.length) {
      throw new Error(parsed.errors.length ? `Не удалось разобрать серверы: ${parsed.errors[0].error}` : 'В подписке нет серверов или формат не распознан');
    }
    const old = d.servers.filter((s) => s.subId === id);
    const oldById = new Map(old.map((s) => [s.id, s]));
    const selected = d.servers.find((s) => s.id === d.selectedId);
    const fresh = [];
    const seen = new Set();
    for (const p of parsed.profiles) {
      let e = serverEntry(p, id, null);
      let n = 1;
      while (seen.has(e.id)) e.id = hash(`${id}|${p.key}|${++n}`, 14);
      seen.add(e.id);
      const prev = oldById.get(e.id);
      if (prev) e = { ...serverEntry(p, id, prev), id: e.id };
      fresh.push(e);
    }
    const firstIdx = d.servers.findIndex((s) => s.subId === id);
    const rest = d.servers.filter((s) => s.subId !== id);
    const insertAt = firstIdx < 0 ? rest.filter((s) => s.subId).length : Math.min(firstIdx, rest.length);
    rest.splice(insertAt, 0, ...fresh);
    d.servers = rest;
    if (selected && selected.subId === id && !fresh.some((s) => s.id === selected.id)) {
      const same = fresh.find((s) => s.name === selected.name);
      d.selectedId = (same || fresh[0]).id;
    }
    if (!d.selectedId && fresh.length) d.selectedId = fresh[0].id;
    sub.info = parsed.info;
    sub.title = parsed.info.title || '';
    sub.updatedAt = Date.now();
    sub.error = '';
    sub.count = fresh.length;
    pushLog(`Подписка «${sub.name || sub.title || sub.url}» обновлена: ${fresh.length} серв.`, 'app');
    if (parsed.errors.length) pushLog(`Пропущено строк в подписке: ${parsed.errors.length} (${parsed.errors[0].error})`, 'warning');
    return publicSub(sub);
  } catch (e) {
    sub.error = e.message;
    pushLog(`Подписка «${sub.name || sub.title || sub.url}»: ${e.message}`, 'error');
    if (!silent) throw e;
    return publicSub(sub);
  } finally {
    sub.updating = false;
    store.save();
    emitData();
  }
}

async function addSubscription(url, name) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('Ссылка подписки должна начинаться с http:// или https://');
  const d = store.get();
  const existing = d.subscriptions.find((s) => s.url === u);
  if (existing) {
    await updateSubscription(existing.id);
    return { sub: publicSub(existing), existed: true };
  }
  const sub = { id: uid(), url: u, name: String(name || '').trim(), title: '', createdAt: Date.now(), updatedAt: 0, info: null, error: '', count: 0 };
  d.subscriptions.push(sub);
  store.save();
  try {
    await updateSubscription(sub.id);
  } catch (e) {
    return { sub: publicSub(sub), error: e.message };
  }
  return { sub: publicSub(sub) };
}

async function updateAllSubscriptions({ silent = true } = {}) {
  const d = store.get();
  const results = [];
  for (const s of d.subscriptions) results.push(await updateSubscription(s.id, { silent }));
  return results;
}

let autoUpdateTimer = null;
function startAutoUpdate() {
  clearInterval(autoUpdateTimer);
  autoUpdateTimer = setInterval(() => {
    const d = store.get();
    if (!d.settings.sub.autoUpdate) return;
    for (const s of d.subscriptions) {
      const hours = (s.info && s.info.updateInterval) || d.settings.sub.intervalHours || 12;
      if (!s.updating && Date.now() - (s.updatedAt || 0) > hours * 3600e3) updateSubscription(s.id, { silent: true });
    }
  }, 10 * 60e3);
}

async function importText(text) {
  const r = links.parseText(text);
  const d = store.get();
  let added = 0;
  let dup = 0;
  let firstId = null;
  for (const p of r.profiles) {
    const e = serverEntry(p, null, null);
    if (d.servers.some((s) => s.id === e.id)) {
      dup++;
      continue;
    }
    d.servers.push(e);
    if (!firstId) firstId = e.id;
    added++;
  }
  if (added) pushLog(`Добавлено серверов: ${added}`, 'app');
  const errors = r.errors.map((e) => e.error);
  let subs = 0;
  for (const url of r.subscriptions) {
    const res = await addSubscription(url);
    subs++;
    if (res.error) errors.push(res.error);
  }
  if (!d.selectedId && firstId) d.selectedId = firstId;
  if (!d.selectedId && d.servers.length) d.selectedId = d.servers[0].id;
  store.save();
  emitData();
  if (!added && !subs && !dup && !errors.length) errors.push('Не найдено ни одной ссылки или подписки');
  return { added, dup, subs, errors };
}

async function testLatency(ids) {
  if (testing) return { busy: true };
  testing = true;
  const d = store.get();
  const targets = Array.isArray(ids) && ids.length ? d.servers.filter((s) => ids.includes(s.id)) : d.servers.slice();
  const { bin, assetDir } = corePaths();
  const L = d.settings.latency;
  const method = L.method === 'tcp' || !bin ? 'tcp' : 'url';
  send('latency:start', { ids: targets.map((t) => t.id), method });
  const report = (srv, ms, err) => {
    if (!srv) return;
    srv.latency = ms;
    srv.latencyAt = Date.now();
    srv.latencyError = ms == null ? err || 'Нет ответа' : '';
    send('latency', { id: srv.id, latency: ms, error: srv.latencyError });
  };
  try {
    const usable = [];
    for (const t of targets) {
      if (t.profile.issue) report(t, null, t.profile.issue);
      else usable.push(t);
    }
    if (method === 'tcp') {
      await latency.runPool(usable, 12, async (s) => report(s, await latency.tcpPing(s.profile.address, s.profile.port, Math.min(L.timeout, 5000)), 'Нет ответа'));
    } else {
      const byProfile = new Map(usable.map((s) => [s.profile, s]));
      for (let i = 0; i < usable.length; i += 30) {
        const batch = usable.slice(i, i + 30);
        await latency.urlTestBatch(
          batch.map((s) => s.profile),
          { bin, assetDir, url: L.url, timeout: L.timeout, tmpDir: runtimeDir(), onResult: (p, ms, err) => report(byProfile.get(p), ms, err) },
        );
      }
    }
  } finally {
    testing = false;
    store.save();
    send('latency:done', {});
    emitData();
  }
  return { done: true };
}

/* ---------- окно, трей, автозапуск ---------- */

function trayImage(connected) {
  const file = appIcon(connected ? 'tray-on.png' : 'tray.png');
  const img = nativeImage.createFromPath(file);
  if (isMac) img.setTemplateImage(false);
  return img.isEmpty() ? nativeImage.createFromPath(appIcon()) : img;
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const connected = conn.status === 'connected';
  const srv = currentServer();
  const status = { connected: 'Подключено', connecting: 'Подключение…', disconnecting: 'Отключение…', error: 'Ошибка', disconnected: 'Отключено' }[conn.status];
  tray.setImage(trayImage(connected));
  tray.setToolTip(`DeskRoute — ${status}${srv && connected ? ` · ${displayName(srv)}` : ''}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${status}${srv ? ` · ${displayName(srv).slice(0, 40)}` : ''}`, enabled: false },
      { type: 'separator' },
      { label: connected || conn.status === 'connecting' ? 'Отключить' : 'Подключить', click: () => toggle().catch((e) => notify('DeskRoute', e.message)) },
      { label: 'Открыть DeskRoute', click: showWindow },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  updateTray();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(hidden) {
  const ap = store.get().appearance;
  const bg = (ap && ap.windowBg) || '#0b0a16';
  win = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    show: false,
    backgroundColor: bg,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    icon: appIcon(),
    title: 'DeskRoute',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
  });
  win.on('close', (e) => {
    if (!quitting && store.get().settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
  win.on('maximize', () => send('window', { maximized: true }));
  win.on('unmaximize', () => send('window', { maximized: false }));
  win.on('session-end', () => {
    cleanup();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
}

function openExternal(url) {
  if (/^https?:\/\//i.test(String(url || ''))) shell.openExternal(url);
}

function applyLoginItem(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ['--hidden'] });
  } catch (e) {
    pushLog(`Автозапуск: ${e.message}`, 'warning');
  }
}

async function relaunchElevated(intent = {}) {
  if (process.platform !== 'win32') throw new Error('Доступно только в Windows');
  if (!(await elevate.taskReady(app))) {
    pushLog('Разрешите DeskRoute работать с правами администратора — Windows спросит это один раз', 'app');
    await elevate.createTask(app);
  }
  elevate.writeIntent(app, intent);
  pushLog('Перезапускаю DeskRoute с правами администратора', 'app');
  await cleanup();
  cleanupDone = true;
  quitting = true;
  app.releaseSingleInstanceLock();
  try {
    await elevate.runTask();
  } catch (e) {
    quitting = false;
    cleanupDone = false;
    app.requestSingleInstanceLock();
    throw new Error(`Не удалось перезапуститься с правами администратора: ${e.message}`);
  }
  setTimeout(() => app.exit(0), 150);
  return true;
}

function relaunchAsAdmin() {
  if (process.platform !== 'win32') throw new Error('Доступно только в Windows');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const args = app.isPackaged ? [] : [path.resolve(process.argv[1] || ROOT)];
  const argList = args.length ? ` -ArgumentList ${args.map(q).join(',')}` : '';
  const cmd = `Start-Sleep -Milliseconds 1200; Start-Process -FilePath ${q(process.execPath)}${argList} -Verb RunAs`;
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  quitting = true;
  setTimeout(() => app.quit(), 200);
  return true;
}

/* ---------- deep links ---------- */

function handleDeepLink(url) {
  if (!url || !new RegExp(`^${PROTOCOL}://`, 'i').test(url)) return;
  let inner = url;
  try {
    inner = links.unwrapDeepLink(url);
  } catch (e) {
    toast('error', e.message);
    return;
  }
  pendingDeepLink = inner;
  send('deeplink', inner);
  showWindow();
}

/* ---------- восстановление после сбоя и выход ---------- */

function killIfXray(pid) {
  try {
    let out = '';
    if (process.platform === 'win32') out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    else out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    if (/xray/i.test(out)) process.kill(pid);
  } catch {
    /* процесса нет */
  }
}

async function recover() {
  const d = store.get();
  if (d.runtime.corePid) {
    killIfXray(d.runtime.corePid);
    d.runtime.corePid = null;
  }
  const k = d.runtime.killSwitch;
  if (k && k.active) {
    // программа упала с включённым kill switch — блокировку не снимаем, пока пользователь не решит
    pushLog(`Прошлый сеанс завершился с ошибкой — kill switch (${k.kind === 'strict' ? 'строгий' : 'мягкий'}) держит интернет заблокированным`, 'app');
    Object.assign(conn, { status: 'error', error: 'Прошлый сеанс завершился некорректно. Kill switch держит интернет заблокированным — подключитесь или нажмите «Снять блокировку».' });
  } else if (d.runtime.proxySet) {
    pushLog('Прошлый сеанс завершился некорректно — снимаю системный прокси', 'app');
    await safeClearProxy();
  }
  store.save();
}

async function cleanup() {
  stats.stop();
  try {
    if (store.get().runtime.proxySet) await sysproxy.clearSystemProxy();
  } catch {
    /* ignore */
  }
  store.get().runtime.proxySet = false;
  await core.stop();
  store.get().runtime.corePid = null;
  // выход из программы — осознанное действие, блокировку снимаем
  await releaseKillSwitch().catch(() => {});
  store.flush();
}

/* ---------- IPC ---------- */

function sanitizeSettingsPatch(patch) {
  const out = JSON.parse(JSON.stringify(patch || {}));
  for (const k of ['socksPort', 'httpPort']) {
    if (k in out) {
      const v = Number(out[k]);
      if (!Number.isInteger(v) || v < 1024 || v > 65535) throw new Error('Порт должен быть числом от 1024 до 65535');
      out[k] = v;
    }
  }
  if (out.mode && !['system', 'proxy', 'tun'].includes(out.mode)) delete out.mode;
  if (out.killSwitch && !['off', 'soft', 'strict'].includes(out.killSwitch)) delete out.killSwitch;
  if (out.zapretCompat && !['auto', 'on', 'off'].includes(out.zapretCompat)) delete out.zapretCompat;
  return out;
}

const RECONNECT_KEYS = ['mode', 'socksPort', 'httpPort', 'allowLan', 'dns', 'mux', 'logLevel', 'routing', 'resolveForRouting', 'killSwitch', 'zapretCompat'];

const API = {
  snapshot: () => snapshot(),
  connect: (id) => connect(id),
  disconnect: () => disconnect(),
  toggle: () => toggle(),
  select: async (id) => {
    const d = store.get();
    if (!d.servers.some((s) => s.id === id)) throw new Error('Сервер не найден');
    d.selectedId = id;
    store.save();
    emitData();
    if (conn.status === 'connected' && conn.serverId !== id) await connect(id);
    return true;
  },
  detect: (text) => links.detect(text),
  importText: (text) => importText(text),
  readClipboard: () => clipboard.readText(),
  copyText: (text) => {
    clipboard.writeText(String(text || ''));
    return true;
  },
  addSubscription: (url, name) => addSubscription(url, name),
  updateSubscription: (id) => updateSubscription(id),
  updateAll: () => updateAllSubscriptions({ silent: true }),
  editSubscription: (id, patch) => {
    const sub = store.get().subscriptions.find((s) => s.id === id);
    if (!sub) throw new Error('Подписка не найдена');
    if (typeof patch.name === 'string') sub.name = patch.name.trim().slice(0, 80);
    if (typeof patch.collapsed === 'boolean') sub.collapsed = patch.collapsed;
    if (typeof patch.url === 'string' && /^https?:\/\//i.test(patch.url.trim())) sub.url = patch.url.trim();
    store.save();
    emitData();
    return publicSub(sub);
  },
  removeSubscription: async (id) => {
    const d = store.get();
    if (conn.serverId && d.servers.some((s) => s.id === conn.serverId && s.subId === id) && conn.status === 'connected') await disconnect();
    d.subscriptions = d.subscriptions.filter((s) => s.id !== id);
    d.servers = d.servers.filter((s) => s.subId !== id);
    if (!d.servers.some((s) => s.id === d.selectedId)) d.selectedId = d.servers[0] ? d.servers[0].id : null;
    store.save();
    emitData();
    return true;
  },
  removeServer: async (id) => {
    const d = store.get();
    if (conn.serverId === id && conn.status === 'connected') await disconnect();
    d.servers = d.servers.filter((s) => s.id !== id);
    if (d.selectedId === id) d.selectedId = d.servers[0] ? d.servers[0].id : null;
    store.save();
    emitData();
    return true;
  },
  renameServer: (id, name) => {
    const s = store.get().servers.find((x) => x.id === id);
    if (!s) throw new Error('Сервер не найден');
    s.customName = String(name || '').trim().slice(0, 80);
    store.save();
    emitData();
    updateTray();
    return true;
  },
  toggleFavorite: (id) => {
    const s = store.get().servers.find((x) => x.id === id);
    if (!s) throw new Error('Сервер не найден');
    s.favorite = !s.favorite;
    store.save();
    emitData();
    return s.favorite;
  },
  exportLink: (id) => {
    const s = store.get().servers.find((x) => x.id === id);
    if (!s || !s.profile.link) throw new Error('Для этого сервера нет ссылки');
    return s.profile.link;
  },
  testLatency: (ids) => testLatency(ids),
  setSettings: (patch) => {
    const d = store.get();
    const clean = sanitizeSettingsPatch(patch);
    const before = JSON.stringify(RECONNECT_KEYS.map((k) => d.settings[k]));
    d.settings = deepMerge(d.settings, clean);
    if ('launchAtLogin' in clean) applyLoginItem(d.settings.launchAtLogin);
    store.save();
    const after = JSON.stringify(RECONNECT_KEYS.map((k) => d.settings[k]));
    if (before !== after) scheduleReconnect();
    return d.settings;
  },
  setRoutingList: (kind, list) => {
    const d = store.get();
    if (!['direct', 'proxy', 'block'].includes(kind)) throw new Error('bad list');
    d.settings.routing[kind] = (list || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 2000);
    store.save();
    scheduleReconnect();
    return d.settings.routing;
  },
  setAppearance: (ap) => {
    store.get().appearance = ap;
    store.save();
    return true;
  },
  getLogs: () => logBuffer.slice(-1500),
  clearLogs: () => {
    logBuffer.length = 0;
    return true;
  },
  coreInfo: () => refreshCoreInfo(),
  checkCoreUpdate: async () => {
    const tag = await updater.latestXrayTag(fetchImpl);
    coreInfo.latest = tag ? tag.replace(/^v/, '') : null;
    send('core', coreInfo);
    return coreInfo.latest;
  },
  installCore: async () => {
    if (busy.core) throw new Error('Загрузка уже идёт');
    busy.core = true;
    const wasConnected = conn.status === 'connected';
    const sid = conn.serverId;
    try {
      if (wasConnected) await disconnect();
      pushLog('Скачиваю ядро Xray-core…', 'app');
      await updater.installXray({ destDir: path.join(userDir(), 'core'), fetchImpl, onProgress: (p) => send('progress', { kind: 'core', p }) });
      await refreshCoreInfo();
      pushLog(`Ядро установлено: Xray ${coreInfo.version}`, 'app');
      if (wasConnected) connect(sid).catch((e) => toast('error', e.message));
      return coreInfo;
    } finally {
      busy.core = false;
      send('progress', { kind: 'core', p: null });
    }
  },
  installGeo: async (source) => {
    if (busy.geo) throw new Error('Загрузка уже идёт');
    busy.geo = true;
    try {
      const src = updater.GEO_SOURCES[source] ? source : 'standard';
      pushLog(`Скачиваю гео-базы: ${updater.GEO_SOURCES[src].title}`, 'app');
      await updater.installGeo({ destDir: path.join(userDir(), 'geo'), source: src, fetchImpl, onProgress: (p) => send('progress', { kind: 'geo', p }) });
      store.get().settings.geoSource = src;
      store.save();
      await refreshCoreInfo();
      pushLog('Гео-базы обновлены', 'app');
      scheduleReconnect();
      return coreInfo;
    } finally {
      busy.geo = false;
      send('progress', { kind: 'geo', p: null });
    }
  },
  openFolder: (kind) => {
    const map = { data: userDir(), core: corePaths().binDir || path.join(userDir(), 'core'), runtime: runtimeDir() };
    const dir = map[kind] || userDir();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  },
  openExternal: (url) => openExternal(url),
  windowAction: (action) => {
    if (!win) return false;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else if (action === 'hide') win.hide();
    return win.isMaximized();
  },
  isElevated: () => sysproxy.isElevated(),
  zapretStatus: () => refreshZapret(),
  zapretAddExclusions: async () => {
    const z = await refreshZapret();
    const res = await zapret.addExclusions(z.lists, store.get().servers.map((x) => x.profile));
    pushLog(`В исключения zapret добавлено: IP — ${res.ips}, доменов — ${res.domains}`, 'app');
    return res;
  },
  pickZapretFolder: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Папка zapret', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.get().settings.zapretPath = r.filePaths[0];
    store.save();
    return refreshZapret();
  },
  releaseKillSwitch: async () => {
    await disconnect();
    return true;
  },
  coreCaps: async () => {
    const { bin } = corePaths();
    return { linux: process.platform === 'linux', has: await zapret.coreHasCaps(bin) };
  },
  grantCoreCaps: async () => {
    const { bin } = corePaths();
    if (!bin) throw new Error('Ядро не установлено');
    await killswitch.grantCaps(bin);
    return true;
  },
  relaunchAsAdmin: () => relaunchElevated({ connect: conn.status === 'connected' ? conn.serverId : null }),
  pickBackground: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Фоновое изображение',
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    if (fs.statSync(src).size > 30 * 1024 * 1024) throw new Error('Файл больше 30 МБ');
    const dir = path.join(userDir(), 'backgrounds');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    const dest = path.join(dir, `bg-${Date.now()}${path.extname(src).toLowerCase()}`);
    fs.copyFileSync(src, dest);
    return pathToFileURL(dest).href;
  },
  consumeDeepLink: () => {
    const v = pendingDeepLink;
    pendingDeepLink = null;
    return v;
  },
  quit: () => {
    quitting = true;
    app.quit();
    return true;
  },
};

ipcMain.handle('dr:invoke', async (_e, method, ...args) => {
  const fn = API[method];
  if (!fn) return { ok: false, error: `Неизвестный метод: ${method}` };
  try {
    return { ok: true, value: await fn(...args) };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
});

/* ---------- запуск ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`));
    if (url) handleDeepLink(url);
    else showWindow();
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (app.isReady()) handleDeepLink(url);
    else pendingDeepLink = url;
  });

  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);

  app.whenReady().then(async () => {
    store = new Store(userDir());
    await recover();
    const relaunchIntent = process.platform === 'win32' ? elevate.takeIntent(app) : null;
    if (relaunchIntent) pushLog('DeskRoute запущен с правами администратора', 'app');
    const s = store.get().settings;
    const hidden = !relaunchIntent && (process.argv.includes('--hidden') || s.startMinimized);
    createWindow(hidden);
    createTray();
    if (app.isPackaged) applyLoginItem(s.launchAtLogin);
    await refreshCoreInfo();
    refreshZapret();
    startAutoUpdate();

    const argUrl = process.argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`));
    if (argUrl) handleDeepLink(argUrl);
    else if (pendingDeepLink && /^deskroute:/i.test(pendingDeepLink)) handleDeepLink(pendingDeepLink);

    setTimeout(async () => {
      if (s.sub.updateOnStart && store.get().subscriptions.length) await updateAllSubscriptions({ silent: true });
      if (relaunchIntent && relaunchIntent.connect && store.get().servers.some((x) => x.id === relaunchIntent.connect)) {
        connect(relaunchIntent.connect).catch((e) => toast('error', e.message));
      } else if (s.autoConnect && store.get().selectedId && coreInfo.installed && conn.status === 'disconnected') {
        connect().catch((e) => toast('error', e.message));
      }
    }, 1500);

    try {
      powerMonitor.on('shutdown', () => cleanup());
    } catch {
      /* не поддерживается */
    }
  });

  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {
    /* остаёмся в трее */
  });
  app.on('before-quit', (e) => {
    quitting = true;
    if (cleanupDone) return;
    e.preventDefault();
    cleanup().finally(() => {
      cleanupDone = true;
      app.quit();
    });
  });
}
