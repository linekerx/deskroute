'use strict';
/**
 * Разбор ссылок на серверы и текстов подписок.
 * Поддерживается: vless://, vmess:// (JSON и URL-формат), trojan://, ss:// (SIP002 и старый),
 * socks:// / socks5://, hysteria2:// / hy2://, а также JSON-конфиги Xray (как отдают Remnawave/Marzban).
 * Обёртки happ://add/…, deskroute://add/…, v2rayng://install-config?url=… и т.п. разворачиваются.
 */
const { b64decode, safeDecode, isIP, isPrivateAddress, hash, looksLikeBase64, stripBrackets } = require('./util');

const SS_METHODS = new Set([
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-poly1305',
  'chacha20-ietf-poly1305',
  'xchacha20-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
]);

const NETWORK_ALIASES = { raw: 'tcp', splithttp: 'xhttp', http: 'h2' };

class LinkError extends Error {}

/* ---------- низкоуровневый разбор URL ---------- */

function splitLink(link) {
  const m = /^([a-z0-9+.-]+):\/\/([\s\S]*)$/i.exec(link);
  if (!m) throw new LinkError('Неверный формат ссылки');
  const scheme = m[1].toLowerCase();
  let rest = m[2];
  let name = '';
  const hi = rest.indexOf('#');
  if (hi >= 0) {
    name = safeDecode(rest.slice(hi + 1)).trim();
    rest = rest.slice(0, hi);
  }
  let query = '';
  const qi = rest.indexOf('?');
  if (qi >= 0) {
    query = rest.slice(qi + 1);
    rest = rest.slice(0, qi);
  }
  let userinfo = '';
  const ai = rest.lastIndexOf('@');
  if (ai >= 0) {
    userinfo = rest.slice(0, ai);
    rest = rest.slice(ai + 1);
  }
  let path = '';
  const si = rest.indexOf('/');
  if (si >= 0) {
    path = rest.slice(si);
    rest = rest.slice(0, si);
  }
  const { host, port } = splitHostPort(rest);
  const params = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const ei = part.indexOf('=');
    const k = safeDecode(ei >= 0 ? part.slice(0, ei) : part).trim();
    const v = ei >= 0 ? safeDecode(part.slice(ei + 1)) : '';
    if (k) params[k] = v;
  }
  return { scheme, userinfo, host, port, path, params, name };
}

function splitHostPort(hp) {
  let host = hp;
  let port = '';
  if (hp.startsWith('[')) {
    const e = hp.indexOf(']');
    host = hp.slice(1, e);
    port = hp.slice(e + 1).replace(/^:/, '');
  } else {
    const ci = hp.lastIndexOf(':');
    if (ci >= 0) {
      host = hp.slice(0, ci);
      port = hp.slice(ci + 1);
    }
  }
  // hysteria2 допускает "443,20000-30000" — берём первый порт
  const pm = /^(\d+)/.exec(String(port).trim());
  return { host: safeDecode(host).trim(), port: pm ? Number(pm[1]) : NaN };
}

/** Регистронезависимое чтение параметров. */
function getter(params) {
  const lower = {};
  for (const k of Object.keys(params)) lower[k.toLowerCase()] = params[k];
  return (...keys) => {
    for (const k of keys) {
      const v = lower[k.toLowerCase()];
      if (v != null && v !== '') return String(v);
    }
    return '';
  };
}

function normNetwork(n) {
  const v = String(n || 'tcp').toLowerCase().trim() || 'tcp';
  return NETWORK_ALIASES[v] || v;
}

function splitList(v) {
  return String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function truthy(v) {
  return /^(1|true|yes)$/i.test(String(v || '').trim());
}

/** Общие параметры транспорта/шифрования (стандарт share-ссылок Xray). */
function streamFromParams(params, defaultSecurity) {
  const get = getter(params);
  const network = normNetwork(get('type', 'network', 'net'));
  let security = (get('security') || defaultSecurity || 'none').toLowerCase();
  if (security === 'xtls') security = 'tls';
  if (!['none', 'tls', 'reality'].includes(security)) security = security === '' ? 'none' : security;
  const s = {
    network,
    security,
    sni: get('sni', 'peer', 'serverName'),
    fp: get('fp', 'fingerprint'),
    alpn: splitList(get('alpn')),
    allowInsecure: truthy(get('allowInsecure', 'insecure', 'allow_insecure')),
    pcs: get('pcs', 'pinnedPeerCertSha256').replace(/:/g, ''),
    vcn: get('vcn', 'verifyPeerCertByName'),
    ech: get('ech', 'echConfigList'),
    pbk: get('pbk', 'publicKey'),
    sid: get('sid', 'shortId'),
    spx: get('spx', 'spiderX'),
    pqv: get('pqv', 'mldsa65Verify'),
    headerType: get('headerType', 'header'),
    host: get('host'),
    path: get('path'),
    serviceName: get('serviceName', 'service_name'),
    authority: get('authority'),
    mode: get('mode'),
    extra: get('extra'),
    seed: get('seed'),
  };
  if (network === 'grpc' && !s.serviceName && s.path) s.serviceName = s.path.replace(/^\//, '');
  return s;
}

/* ---------- протоколы ---------- */

function parseVless(link) {
  const u = splitLink(link);
  const get = getter(u.params);
  return finalize({
    protocol: 'vless',
    name: u.name,
    address: u.host,
    port: u.port,
    id: safeDecode(u.userinfo).trim(),
    encryption: get('encryption') || 'none',
    flow: get('flow'),
    ...streamFromParams(u.params, 'none'),
    link,
  });
}

function parseVmess(link) {
  const body = link.replace(/^vmess:\/\//i, '').trim();
  const hi = body.indexOf('#');
  const main = hi >= 0 ? body.slice(0, hi) : body;
  const fragName = hi >= 0 ? safeDecode(body.slice(hi + 1)).trim() : '';
  if (!main.includes('@')) {
    let json = null;
    try {
      const dec = b64decode(main).trim();
      if (dec.startsWith('{')) json = JSON.parse(dec);
    } catch {
      json = null;
    }
    if (!json) throw new LinkError('Не удалось декодировать vmess-ссылку');
    const network = normNetwork(json.net);
    const tls = String(json.tls || '').toLowerCase();
    const type = String(json.type || '').trim();
    const str = (v) => (v == null ? '' : String(v).trim());
    return finalize({
      protocol: 'vmess',
      name: str(json.ps) || fragName,
      address: str(json.add),
      port: Number(json.port),
      id: str(json.id),
      alterId: Number(json.aid) || 0,
      cipher: str(json.scy || json.security) || 'auto',
      network,
      security: tls === 'tls' || tls === 'reality' ? tls : 'none',
      sni: str(json.sni),
      fp: str(json.fp),
      alpn: splitList(json.alpn),
      allowInsecure: truthy(json.allowInsecure) || truthy(json.insecure) || json.allowInsecure === true,
      pcs: str(json.pcs).replace(/:/g, ''),
      vcn: str(json.vcn),
      ech: str(json.ech),
      pbk: str(json.pbk),
      sid: str(json.sid),
      spx: str(json.spx),
      pqv: '',
      host: network === 'grpc' ? '' : str(json.host),
      path: network === 'grpc' ? '' : str(json.path),
      headerType: network === 'tcp' || network === 'kcp' ? (type === 'none' ? '' : type) : '',
      serviceName: network === 'grpc' ? str(json.path) : '',
      authority: network === 'grpc' ? str(json.host) : '',
      mode: network === 'grpc' ? type : network === 'xhttp' ? (['auto', 'packet-up', 'stream-up', 'stream-one'].includes(type) ? type : str(json.mode)) : '',
      extra: typeof json.extra === 'object' && json.extra ? JSON.stringify(json.extra) : str(json.extra),
      seed: network === 'kcp' ? str(json.path) : '',
      link,
    });
  }
  // URL-формат vmess://uuid@host:port?...
  const u = splitLink(link);
  const get = getter(u.params);
  return finalize({
    protocol: 'vmess',
    name: u.name,
    address: u.host,
    port: u.port,
    id: safeDecode(u.userinfo).trim(),
    alterId: Number(get('aid', 'alterId')) || 0,
    cipher: get('encryption', 'scy', 'security_method') || 'auto',
    ...streamFromParams(u.params, 'none'),
    link,
  });
}

function parseTrojan(link) {
  const u = splitLink(link);
  const s = streamFromParams(u.params, 'tls');
  return finalize({
    protocol: 'trojan',
    name: u.name,
    address: u.host,
    port: u.port,
    password: safeDecode(u.userinfo),
    ...s,
    link,
  });
}

function parseShadowsocks(link) {
  let body = link.replace(/^ss:\/\//i, '');
  let name = '';
  const hi = body.indexOf('#');
  if (hi >= 0) {
    name = safeDecode(body.slice(hi + 1)).trim();
    body = body.slice(0, hi);
  }
  let query = '';
  const qi = body.indexOf('?');
  if (qi >= 0) {
    query = body.slice(qi + 1);
    body = body.slice(0, qi);
  }
  body = body.replace(/\/+$/, '');
  let method;
  let password;
  let hostport;
  if (!body.includes('@')) {
    const dec = b64decode(body);
    const ai = dec.lastIndexOf('@');
    if (ai < 0) throw new LinkError('Не удалось разобрать ss-ссылку');
    const creds = dec.slice(0, ai);
    hostport = dec.slice(ai + 1);
    const ci = creds.indexOf(':');
    method = creds.slice(0, ci);
    password = creds.slice(ci + 1);
  } else {
    const ai = body.lastIndexOf('@');
    const ui = body.slice(0, ai);
    hostport = body.slice(ai + 1);
    let creds = safeDecode(ui);
    if (!creds.includes(':')) creds = b64decode(ui);
    const ci = creds.indexOf(':');
    if (ci < 0) throw new LinkError('В ss-ссылке нет метода шифрования');
    method = creds.slice(0, ci);
    password = creds.slice(ci + 1);
  }
  const { host, port } = splitHostPort(hostport.replace(/\/.*$/, ''));
  const params = {};
  for (const part of query.split('&')) {
    const ei = part.indexOf('=');
    if (ei > 0) params[safeDecode(part.slice(0, ei))] = safeDecode(part.slice(ei + 1));
  }
  const p = {
    protocol: 'shadowsocks',
    name,
    address: host,
    port,
    method: String(method || '').toLowerCase().trim(),
    password,
    network: 'tcp',
    security: 'none',
    plugin: params.plugin || '',
    link,
  };
  return finalize(p);
}

function parseSocks(link) {
  const u = splitLink(link.replace(/^socks5?:\/\//i, 'socks://'));
  let user = '';
  let pass = '';
  if (u.userinfo) {
    let ui = safeDecode(u.userinfo);
    if (!ui.includes(':')) {
      const dec = b64decode(u.userinfo);
      if (dec.includes(':')) ui = dec;
    }
    const ci = ui.indexOf(':');
    if (ci >= 0) {
      user = ui.slice(0, ci);
      pass = ui.slice(ci + 1);
    } else {
      user = ui;
    }
  }
  return finalize({
    protocol: 'socks',
    name: u.name,
    address: u.host,
    port: u.port,
    user,
    pass,
    network: 'tcp',
    security: 'none',
    link,
  });
}

function parseHysteria2(link) {
  const u = splitLink(link.replace(/^(hy2|hysteria2):\/\//i, 'hysteria2://'));
  const get = getter(u.params);
  return finalize({
    protocol: 'hysteria2',
    name: u.name,
    address: u.host,
    port: u.port,
    auth: safeDecode(u.userinfo),
    network: 'hysteria',
    security: 'tls',
    sni: get('sni', 'peer'),
    alpn: splitList(get('alpn')),
    allowInsecure: truthy(get('insecure', 'allowInsecure')),
    pcs: get('pinSHA256', 'pcs').replace(/:/g, '').toLowerCase(),
    obfs: get('obfs'),
    obfsPassword: get('obfs-password', 'obfsPassword'),
    fp: '',
    link,
  });
}

/* ---------- JSON-конфиги Xray ---------- */

const SERVICE_PROTOCOLS = new Set(['freedom', 'blackhole', 'dns', 'loopback']);

function pickMainOutbound(cfg) {
  const obs = Array.isArray(cfg.outbounds) ? cfg.outbounds : [];
  return obs.find((o) => o && o.tag === 'proxy' && !SERVICE_PROTOCOLS.has(o.protocol)) || obs.find((o) => o && !SERVICE_PROTOCOLS.has(o.protocol)) || null;
}

function summarizeOutbound(o) {
  const st = (o && o.streamSettings) || {};
  const s = o && o.settings ? o.settings : {};
  const server = (s.vnext && s.vnext[0]) || (s.servers && s.servers[0]) || s;
  return {
    inner: o ? o.protocol : 'json',
    address: server.address || '',
    port: Number(server.port) || 0,
    network: normNetwork(st.network || 'tcp'),
    security: st.security || 'none',
  };
}

function parseJsonConfigs(data) {
  const arr = Array.isArray(data) ? data : [data];
  const out = [];
  arr.forEach((cfg, i) => {
    if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.outbounds)) return;
    const main = pickMainOutbound(cfg);
    if (!main) return;
    const sum = summarizeOutbound(main);
    const p = {
      protocol: 'json',
      name: String(cfg.remarks || cfg.name || '').trim() || `Конфиг ${i + 1}`,
      address: sum.address,
      port: sum.port,
      inner: sum.inner,
      network: sum.network,
      security: sum.security,
      config: cfg,
      warnings: [],
    };
    p.key = hash('json|' + JSON.stringify(cfg.outbounds));
    if (!p.address) p.address = '—';
    out.push(p);
  });
  return out;
}

/* ---------- проверки ---------- */

function finalize(p) {
  p.address = stripBrackets(String(p.address || '').trim());
  if (!p.address) throw new LinkError('Не указан адрес сервера');
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) throw new LinkError('Неверный порт');
  if ((p.protocol === 'vless' || p.protocol === 'vmess') && !p.id) throw new LinkError('Не указан UUID пользователя');
  if (p.protocol === 'trojan' && !p.password) throw new LinkError('Не указан пароль Trojan');
  if (p.protocol === 'shadowsocks' && (!p.method || p.password == null)) throw new LinkError('Не указан метод или пароль Shadowsocks');
  p.name = String(p.name || '').trim() || `${p.address}:${p.port}`;
  p.warnings = [];
  p.issue = '';

  if (p.network === 'h2') p.issue = 'Транспорт HTTP/2 удалён в Xray 26 — попросите у провайдера конфиг с XHTTP';
  else if (p.network === 'quic') p.issue = 'Транспорт QUIC удалён в Xray 26';
  if (p.protocol === 'shadowsocks') {
    if (!SS_METHODS.has(p.method)) p.issue = `Шифр «${p.method}» не поддерживается Xray`;
    if (p.plugin) p.issue = 'Плагины Shadowsocks (obfs, v2ray-plugin) не поддерживаются';
  }
  if (p.security === 'reality' && !p.pbk) p.issue = 'В ссылке нет публичного ключа REALITY (pbk)';
  if (p.protocol === 'vless' && p.security === 'none' && (!p.encryption || p.encryption === 'none') && !isPrivateAddress(p.address)) {
    p.issue = 'Xray 26 запрещает VLESS без TLS/REALITY к публичным серверам';
  }
  if (p.protocol === 'hysteria2' && p.obfs) p.warnings.push('Обфускация Hysteria2 (obfs) пока не поддерживается — подключение может не работать');
  if (p.allowInsecure && !p.pcs) p.warnings.push('allowInsecure удалён в Xray 26 — сертификат сервера будет проверяться');
  if (p.flow && !['xtls-rprx-vision', 'xtls-rprx-vision-udp443'].includes(p.flow)) p.issue = `Flow «${p.flow}» не поддерживается`;
  if (p.protocol === 'vmess') p.warnings.push('VMess устарел — по возможности используйте VLESS');

  const { name, link, warnings, issue, ...rest } = p;
  p.key = hash(JSON.stringify(rest, Object.keys(rest).sort()));
  return p;
}

/* ---------- публичный API ---------- */

const PROTOCOL_PARSERS = {
  vless: parseVless,
  vmess: parseVmess,
  trojan: parseTrojan,
  ss: parseShadowsocks,
  socks: parseSocks,
  socks5: parseSocks,
  hysteria2: parseHysteria2,
  hy2: parseHysteria2,
};

/**
 * Разворачивает обёртки клиентов: happ://add/<url>, deskroute://add/<url>,
 * v2rayng://install-config?url=<url>, hiddify://import/<url> и т.д.
 */
function unwrapDeepLink(input) {
  const s = String(input || '').trim();
  const m = /^([a-z0-9-]+):\/\/(.*)$/is.exec(s);
  if (!m) return s;
  const scheme = m[1].toLowerCase();
  if (PROTOCOL_PARSERS[scheme] || scheme === 'http' || scheme === 'https') return s;
  let rest = m[2];
  if (/^crypt\d*\//i.test(rest)) throw new LinkError('Зашифрованные ссылки Happ (happ://crypt) не поддерживаются — попросите обычную ссылку подписки');
  const urlParam = /[?&]url=([^&#]+)/i.exec(rest);
  if (urlParam) return safeDecode(urlParam[1]).trim();
  const am = /^(add|import|install-sub|install-config|import-remote-profile|subscribe|sub|config)\/(.+)$/is.exec(rest);
  if (am) {
    let inner = am[2].trim();
    if (/^https?%3A/i.test(inner) || /^[a-z0-9]+%3A%2F%2F/i.test(inner)) inner = safeDecode(inner);
    return inner;
  }
  return s;
}

function parseLink(raw) {
  const line = unwrapDeepLink(raw);
  const m = /^([a-z0-9]+):\/\//i.exec(line);
  if (!m) throw new LinkError('Не похоже на ссылку конфигурации');
  const fn = PROTOCOL_PARSERS[m[1].toLowerCase()];
  if (!fn) throw new LinkError(`Протокол «${m[1]}» не поддерживается`);
  return fn(line);
}

/**
 * Разбирает произвольный текст: список ссылок, base64-подписку, JSON-конфиги или ссылки на подписки.
 * Возвращает { profiles, subscriptions, errors, meta }.
 */
function parseText(text) {
  const result = { profiles: [], subscriptions: [], errors: [], meta: {} };
  let t = String(text || '').replace(/^﻿/, '').trim();
  if (!t) return result;

  if (!t.includes('://') && !/^[\[{]/.test(t) && looksLikeBase64(t)) {
    const dec = b64decode(t);
    if (dec.includes('://') || /^\s*[\[{]/.test(dec)) t = dec.trim();
  }

  if (/^[\[{]/.test(t)) {
    try {
      const profiles = parseJsonConfigs(JSON.parse(t));
      if (profiles.length) {
        result.profiles = profiles;
        return result;
      }
    } catch {
      /* не JSON — разбираем построчно */
    }
  }

  const lines = t.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const meta = /^#\s*([a-z0-9-]+)\s*:\s*(.+)$/i.exec(line);
    if (meta) {
      result.meta[meta[1].toLowerCase()] = meta[2].trim();
      continue;
    }
    if (line.startsWith('#') || line.startsWith('//')) continue;
    const pieces = (line.match(/[a-z0-9-]+:\/\//gi) || []).length > 1 ? line.split(/\s+/) : [line];
    for (const piece of pieces) {
      let item;
      try {
        item = unwrapDeepLink(piece);
      } catch (e) {
        result.errors.push({ line: piece.slice(0, 90), error: e.message });
        continue;
      }
      if (/^https?:\/\//i.test(item)) {
        result.subscriptions.push(item);
        continue;
      }
      try {
        result.profiles.push(parseLink(item));
      } catch (e) {
        result.errors.push({ line: item.slice(0, 90), error: e.message });
      }
    }
  }
  return result;
}

/** Определение типа текста для подсказки в окне добавления. */
function detect(text) {
  try {
    const r = parseText(text);
    return { profiles: r.profiles.length, subscriptions: r.subscriptions.length, errors: r.errors.length, firstError: r.errors[0] ? r.errors[0].error : '' };
  } catch (e) {
    return { profiles: 0, subscriptions: 0, errors: 1, firstError: e.message };
  }
}

module.exports = {
  parseLink,
  parseText,
  parseJsonConfigs,
  unwrapDeepLink,
  detect,
  pickMainOutbound,
  splitLink,
  LinkError,
  SS_METHODS,
  isIP,
};
