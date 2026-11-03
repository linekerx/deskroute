'use strict';
/**
 * Хранилище настроек, подписок и серверов (JSON-файл в папке данных приложения).
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  version: 1,
  settings: {
    mode: 'system', // system — системный прокси, proxy — только локальный порт, tun — весь трафик (бета)
    socksPort: 10808,
    httpPort: 10809,
    allowLan: false,
    dns: 'https://1.1.1.1/dns-query',
    resolveForRouting: false,
    mux: false,
    logLevel: 'warning',
    autoConnect: false,
    launchAtLogin: false,
    startMinimized: false,
    closeToTray: true,
    routing: { preset: 'ru-direct', blockAds: false, direct: [], proxy: [], block: [] },
    sub: { userAgent: 'DeskRoute/1.0', updateOnStart: true, autoUpdate: true, intervalHours: 12 },
    latency: { method: 'url', url: 'http://www.gstatic.com/generate_204', timeout: 6000 },
    geoSource: 'standard',
    killSwitch: 'off', // off | soft | strict
    zapretCompat: 'auto', // auto — включать, если zapret запущен; on; off
    zapretPath: '',
  },
  appearance: null,
  subscriptions: [],
  servers: [],
  selectedId: null,
  runtime: { proxySet: false, corePid: null, killSwitch: { active: false } },
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const k of Object.keys(extra)) out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'deskroute.json');
    this.data = clone(DEFAULTS);
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = deepMerge(clone(DEFAULTS), raw);
    } catch (e) {
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, `${this.file}.broken-${Date.now()}`);
        } catch {
          /* ignore */
        }
      }
      this.data = clone(DEFAULTS);
    }
    if (!Array.isArray(this.data.servers)) this.data.servers = [];
    if (!Array.isArray(this.data.subscriptions)) this.data.subscriptions = [];
  }

  get() {
    return this.data;
  }

  save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 350);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('store flush failed', e);
    }
  }

  static defaults() {
    return clone(DEFAULTS);
  }
}

module.exports = { Store, DEFAULTS, deepMerge };
