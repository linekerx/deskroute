'use strict';
/**
 * Сборка конфигурации Xray-core из профиля сервера и настроек DeskRoute.
 * Проверено на Xray 26.10.31: allowInsecure и транспорты h2/quic в нём удалены.
 */
const { domainToASCII } = require('url');
const net = require('net');
const { isIP } = require('./util');
const { pickMainOutbound } = require('./links');
const zapret = require('./zapret');

const PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '224.0.0.0/4',
  '255.255.255.255/32',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

const RU_DOMAINS = [
  'domain:ru',
  'domain:su',
  'domain:xn--p1ai', // .рф
  'domain:xn--p1acf', // .рус
  'domain:xn--d1acj3b', // .дети
  'domain:xn--80asehdb', // .онлайн
  'domain:xn--80aswg', // .сайт
  'domain:xn--c1avg', // .орг
  'domain:moscow',
  'domain:tatar',
];

const SNIFFING = { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true };

/* ---------- транспорт и шифрование ---------- */

function splitHosts(h) {
  return String(h || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseExtra(extra) {
  if (!extra) return null;
  if (typeof extra === 'object') return extra;
  try {
    const v = JSON.parse(extra);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function buildTls(p) {
  const t = {};
  const sni = p.sni || (p.host && !p.host.includes(',') ? p.host : '') || (!isIP(p.address) ? p.address : '');
  if (sni) t.serverName = sni;
  t.fingerprint = p.fp || 'chrome';
  if (p.alpn && p.alpn.length) t.alpn = p.alpn;
  if (p.pcs) t.pinnedPeerCertSha256 = p.pcs;
  if (p.vcn) t.verifyPeerCertByName = p.vcn;
  if (p.ech) t.echConfigList = p.ech;
  return t;
}

function buildStream(p) {
  if (p.protocol === 'socks' || p.protocol === 'shadowsocks') return null;
  if (p.protocol === 'hysteria2') {
    const t = buildTls(p);
    delete t.fingerprint;
    if (!t.alpn) t.alpn = ['h3'];
    return {
      network: 'hysteria',
      security: 'tls',
      tlsSettings: t,
      hysteriaSettings: { version: 2, auth: p.auth || '' },
    };
  }
  const s = { network: p.network || 'tcp' };
  if (p.security === 'tls') {
    s.security = 'tls';
    s.tlsSettings = buildTls(p);
  } else if (p.security === 'reality') {
    s.security = 'reality';
    s.realitySettings = {
      serverName: p.sni || '',
      fingerprint: p.fp || 'chrome',
      publicKey: p.pbk,
      shortId: p.sid || '',
      spiderX: p.spx || '',
    };
    if (p.pqv) s.realitySettings.mldsa65Verify = p.pqv;
  }
  switch (s.network) {
    case 'tcp':
      if (p.headerType === 'http') {
        s.tcpSettings = {
          header: {
            type: 'http',
            request: {
              version: '1.1',
              method: 'GET',
              path: [p.path || '/'],
              headers: {
                Host: splitHosts(p.host).length ? splitHosts(p.host) : [p.address],
                'User-Agent': ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'],
                'Accept-Encoding': ['gzip, deflate'],
                Connection: ['keep-alive'],
                Pragma: ['no-cache'],
              },
            },
          },
        };
      }
      break;
    case 'ws':
      s.wsSettings = { path: p.path || '/' };
      if (p.host) s.wsSettings.host = p.host;
      break;
    case 'httpupgrade':
      s.httpupgradeSettings = { path: p.path || '/' };
      if (p.host) s.httpupgradeSettings.host = p.host;
      break;
    case 'grpc':
      s.grpcSettings = { serviceName: p.serviceName || '', multiMode: p.mode === 'multi' };
      if (p.authority) s.grpcSettings.authority = p.authority;
      break;
    case 'xhttp': {
      const x = { path: p.path || '/' };
      if (p.host) x.host = p.host;
      if (p.mode) x.mode = p.mode;
      const extra = parseExtra(p.extra);
      if (extra) x.extra = extra;
      s.xhttpSettings = x;
      break;
    }
    case 'kcp':
      s.kcpSettings = { header: { type: p.headerType || 'none' } };
      if (p.seed) s.kcpSettings.seed = p.seed;
      break;
    case 'h2':
      s.httpSettings = { path: p.path || '/', host: splitHosts(p.host) };
      break;
    default:
      break;
  }
  return s;
}

function canMux(p) {
  return !p.flow && ['vless', 'vmess', 'trojan'].includes(p.protocol) && ['tcp', 'ws', 'grpc', 'httpupgrade'].includes(p.network);
}

/** Основной исходящий (outbound) для профиля. */
function buildOutbound(p, tag = 'proxy', opts = {}) {
  if (p.protocol === 'json') {
    const main = pickMainOutbound(p.config || {});
    if (!main) throw new Error('В JSON-конфиге нет исходящего соединения');
    const ob = JSON.parse(JSON.stringify(main));
    ob.tag = tag;
    if (opts.standalone) {
      if (ob.streamSettings && ob.streamSettings.sockopt) delete ob.streamSettings.sockopt.dialerProxy;
      delete ob.proxySettings;
    }
    return ob;
  }
  let ob;
  switch (p.protocol) {
    case 'vless':
      ob = {
        protocol: 'vless',
        settings: { vnext: [{ address: p.address, port: p.port, users: [{ id: p.id, encryption: p.encryption || 'none', flow: p.flow || '' }] }] },
      };
      break;
    case 'vmess':
      ob = {
        protocol: 'vmess',
        settings: { vnext: [{ address: p.address, port: p.port, users: [{ id: p.id, alterId: p.alterId || 0, security: p.cipher || 'auto' }] }] },
      };
      break;
    case 'trojan':
      ob = { protocol: 'trojan', settings: { servers: [{ address: p.address, port: p.port, password: p.password }] } };
      break;
    case 'shadowsocks':
      ob = { protocol: 'shadowsocks', settings: { servers: [{ address: p.address, port: p.port, method: p.method, password: p.password }] } };
      break;
    case 'socks': {
      const server = { address: p.address, port: p.port };
      if (p.user) server.users = [{ user: p.user, pass: p.pass || '' }];
      ob = { protocol: 'socks', settings: { servers: [server] } };
      break;
    }
    case 'hysteria2':
      ob = { protocol: 'hysteria', settings: { version: 2, address: p.address, port: p.port } };
      break;
    default:
      throw new Error(`Протокол ${p.protocol} не поддерживается`);
  }
  ob.tag = tag;
  const stream = buildStream(p);
  if (stream) ob.streamSettings = stream;
  if (opts.mux && canMux(p)) ob.mux = { enabled: true, concurrency: 8, xudpConcurrency: 16, xudpProxyUDP443: 'reject' };
  return ob;
}

/* ---------- маршрутизация ---------- */

function isIpOrCidr(v) {
  const [ip, mask] = String(v).split('/');
  if (!net.isIP(ip)) return false;
  return mask === undefined || /^\d{1,3}$/.test(mask);
}

/**
 * Разбирает пользовательский список правил.
 * Поддерживаются: example.com, full:, domain:, regexp:, keyword:, geosite:, geoip:, IP и CIDR.
 */
function parseRuleList(list, geo) {
  const domains = [];
  const ips = [];
  const skipped = [];
  for (const raw of list || []) {
    let v = String(raw || '').trim();
    if (!v || v.startsWith('#')) continue;
    const low = v.toLowerCase();
    if (low.startsWith('geoip:')) {
      const code = low.slice(6).replace(/^!/, '');
      if (geo.ip && !geo.ip.has(code)) {
        skipped.push(`${v} (нет в geoip.dat)`);
        continue;
      }
      ips.push(low);
      continue;
    }
    if (low.startsWith('geosite:')) {
      const code = low.slice(8).split('@')[0];
      if (geo.site && !geo.site.has(code)) {
        skipped.push(`${v} (нет в geosite.dat)`);
        continue;
      }
      domains.push(low);
      continue;
    }
    if (/^(domain|full|regexp|keyword|dotless):/i.test(v)) {
      const i = v.indexOf(':');
      const kind = v.slice(0, i).toLowerCase();
      let val = v.slice(i + 1).trim();
      if (kind === 'domain' || kind === 'full') val = domainToASCII(val.toLowerCase()) || val;
      if (val) domains.push(`${kind}:${val}`);
      continue;
    }
    if (isIpOrCidr(v)) {
      ips.push(v);
      continue;
    }
    v = v
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^\*?\./, '')
      .toLowerCase();
    if (isIpOrCidr(v)) {
      ips.push(v);
      continue;
    }
    const ascii = domainToASCII(v);
    if (ascii && /^[a-z0-9.-]+$/.test(ascii) && ascii.includes('.')) domains.push(`domain:${ascii}`);
    else if (ascii && /^[a-z0-9-]+$/.test(ascii)) domains.push(`keyword:${ascii}`);
    else skipped.push(`${raw} (не распознано)`);
  }
  return { domains, ips, skipped };
}

function pushRules(rules, parsed, outboundTag) {
  if (parsed.domains.length) rules.push({ type: 'field', domain: parsed.domains, outboundTag });
  if (parsed.ips.length) rules.push({ type: 'field', ip: parsed.ips, outboundTag });
}

/** Discord и YouTube мимо VPN — чтобы их обрабатывал zapret. */
function zapretRules(geo, outboundTag) {
  const domains = zapret.DOMAINS.map((d) => `domain:${d}`);
  for (const g of zapret.GEOSITE) if (geo.site && geo.site.has(g)) domains.push(`geosite:${g}`);
  const rules = [{ type: 'field', domain: domains, outboundTag }, { type: 'field', network: 'udp', port: zapret.DISCORD_UDP_PORTS, outboundTag }];
  if (geo.ip && geo.ip.has('discord')) rules.push({ type: 'field', ip: ['geoip:discord'], outboundTag });
  return rules;
}

/** Метки соединений ядра (Linux): zapret пропускает VPN-соединение, kill switch пропускает всё ядро. */
function applyMarks(outbounds) {
  for (const o of outbounds) {
    if (!o || o.protocol === 'blackhole' || o.protocol === 'dns') continue;
    const mark = o.protocol === 'freedom' ? zapret.DR_MARK : zapret.DR_MARK | zapret.ZAPRET_SKIP_MARK;
    o.streamSettings = o.streamSettings || {};
    o.streamSettings.sockopt = { ...(o.streamSettings.sockopt || {}), mark };
  }
}

function buildRouting(settings, geo, notes, extra = {}) {
  const r = settings.routing || {};
  const rules = [];
  const lists = {
    block: parseRuleList(r.block, geo),
    proxy: parseRuleList(r.proxy, geo),
    direct: parseRuleList(r.direct, geo),
  };
  for (const k of Object.keys(lists)) for (const s of lists[k].skipped) notes.push(`Правило пропущено: ${s}`);
  pushRules(rules, lists.block, 'block');
  pushRules(rules, lists.proxy, 'proxy');
  pushRules(rules, lists.direct, 'direct');

  if (extra.zapret) {
    rules.push(...zapretRules(geo, 'direct'));
    notes.push('Совместимость с zapret: Discord и YouTube идут мимо VPN');
  }

  if (r.blockAds) {
    if (geo.site && geo.site.has('category-ads-all')) rules.push({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
    else notes.push('Блокировка рекламы недоступна: в geosite.dat нет category-ads-all');
  }

  rules.push({ type: 'field', ip: PRIVATE_CIDRS, outboundTag: 'direct' });
  rules.push({ type: 'field', domain: ['full:localhost', 'domain:local', 'domain:lan', 'domain:localdomain'], outboundTag: 'direct' });

  let domainStrategy = settings.resolveForRouting ? 'IPIfNonMatch' : 'AsIs';
  const preset = r.preset || 'global';
  if (preset === 'ru-direct') {
    const d = [...RU_DOMAINS];
    if (geo.site && geo.site.has('category-ru')) d.push('geosite:category-ru');
    rules.push({ type: 'field', domain: d, outboundTag: 'direct' });
    if (geo.ip && geo.ip.has('ru')) rules.push({ type: 'field', ip: ['geoip:ru'], outboundTag: 'direct' });
    else notes.push('geoip.dat не найден — российские IP будут идти через сервер');
  } else if (preset === 'blocked') {
    if (geo.site && geo.site.has('ru-blocked')) {
      const d = ['geosite:ru-blocked'];
      rules.push({ type: 'field', domain: d, outboundTag: 'proxy' });
      if (geo.ip && geo.ip.has('ru-blocked')) rules.push({ type: 'field', ip: ['geoip:ru-blocked'], outboundTag: 'proxy' });
      rules.push({ type: 'field', network: 'tcp,udp', outboundTag: 'direct' });
    } else {
      notes.push('Для режима «Только заблокированное» нужны гео-базы для России (Настройки → Ядро). Сейчас весь трафик идёт через сервер.');
    }
  }
  return { domainStrategy, rules };
}

/* ---------- полный конфиг ---------- */

function statsBlocks(metricsPort) {
  return {
    stats: {},
    metrics: { tag: 'metrics-out', listen: `127.0.0.1:${metricsPort}` },
    policy: {
      system: { statsInboundUplink: true, statsInboundDownlink: true, statsOutboundUplink: true, statsOutboundDownlink: true },
    },
  };
}

function localInbounds(settings, ports, tags = {}) {
  const listen = settings.allowLan ? '0.0.0.0' : '127.0.0.1';
  const inbounds = [];
  if (settings.mode === 'tun') {
    inbounds.push({
      tag: 'tun-in',
      protocol: 'tun',
      settings: {
        name: 'DeskRoute',
        MTU: 1500,
        autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
        autoOutboundsInterface: 'auto',
      },
      sniffing: SNIFFING,
    });
  }
  inbounds.push({ tag: tags.socks || 'socks-in', listen, port: ports.socks, protocol: 'socks', settings: { udp: true, auth: 'noauth' }, sniffing: SNIFFING });
  inbounds.push({ tag: tags.http || 'http-in', listen, port: ports.http, protocol: 'http', settings: {}, sniffing: SNIFFING });
  return inbounds;
}

function tunDns(settings) {
  return { servers: [settings.dns || 'https://1.1.1.1/dns-query'], queryStrategy: 'UseIPv4' };
}

/**
 * @param profile профиль сервера
 * @param settings настройки приложения
 * @param ports { socks, http, metrics }
 * @param geo { ip: Set|null, site: Set|null } — категории из гео-баз
 * @returns { config, notes }
 */
function buildConfig(profile, settings, ports, geo = { ip: null, site: null }, extra = {}) {
  const notes = [];
  const logLevel = settings.logLevel || 'warning';

  if (profile.protocol === 'json') {
    const c = JSON.parse(JSON.stringify(profile.config));
    const old = Array.isArray(c.inbounds) ? c.inbounds : [];
    const tags = {
      socks: (old.find((i) => i.protocol === 'socks') || {}).tag || 'socks-in',
      http: (old.find((i) => i.protocol === 'http') || {}).tag || 'http-in',
    };
    c.inbounds = localInbounds(settings, ports, tags);
    c.log = { loglevel: logLevel };
    delete c.api;
    const sb = statsBlocks(ports.metrics);
    c.stats = sb.stats;
    c.metrics = sb.metrics;
    c.policy = { ...(c.policy || {}), system: { ...((c.policy && c.policy.system) || {}), ...sb.policy.system } };
    if (extra.zapret) {
      let direct = c.outbounds.find((o) => o.protocol === 'freedom' && o.tag);
      if (!direct) {
        direct = { tag: 'direct', protocol: 'freedom' };
        c.outbounds.push(direct);
      }
      c.routing = c.routing || {};
      c.routing.rules = [...zapretRules(geo, direct.tag), ...(c.routing.rules || [])];
      notes.push('Совместимость с zapret: Discord и YouTube идут мимо VPN');
    }
    if (settings.mode === 'tun') {
      if (!c.outbounds.some((o) => o.tag === 'dns-out')) c.outbounds.push({ tag: 'dns-out', protocol: 'dns' });
      c.routing = c.routing || {};
      c.routing.rules = [{ type: 'field', inboundTag: ['tun-in'], port: '53', outboundTag: 'dns-out' }, ...(c.routing.rules || [])];
      if (!c.dns) c.dns = tunDns(settings);
    }
    delete c.remarks;
    if (extra.marks) applyMarks(c.outbounds);
    notes.push('JSON-профиль: маршрутизация задаётся провайдером');
    return { config: c, notes };
  }

  const proxy = buildOutbound(profile, 'proxy', { mux: settings.mux });
  const outbounds = [proxy, { tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' }];
  const routing = buildRouting(settings, geo, notes, extra);
  if (extra.marks) applyMarks(outbounds);
  const config = {
    log: { loglevel: logLevel },
    inbounds: localInbounds(settings, ports),
    outbounds,
    routing,
    ...statsBlocks(ports.metrics),
  };
  if (settings.mode === 'tun') {
    outbounds.push({ tag: 'dns-out', protocol: 'dns' });
    routing.rules.unshift({ type: 'field', inboundTag: ['tun-in'], port: '53', outboundTag: 'dns-out' });
    config.dns = tunDns(settings);
  } else if (routing.domainStrategy === 'IPIfNonMatch') {
    config.dns = { servers: [settings.dns || 'https://1.1.1.1/dns-query'], queryStrategy: 'UseIPv4' };
  }
  return { config, notes };
}

/** Конфиг для проверки задержки: по HTTP-входу на каждый сервер. */
function buildTestConfig(items) {
  return {
    log: { loglevel: 'error' },
    inbounds: items.map((it, i) => ({ tag: `t${i}`, listen: '127.0.0.1', port: it.port, protocol: 'http', settings: {} })),
    outbounds: [...items.map((it, i) => buildOutbound(it.profile, `o${i}`, { standalone: true })), { tag: 'direct', protocol: 'freedom' }],
    routing: {
      domainStrategy: 'AsIs',
      rules: items.map((it, i) => ({ type: 'field', inboundTag: [`t${i}`], outboundTag: `o${i}` })),
    },
  };
}

module.exports = { buildConfig, buildOutbound, buildStream, buildRouting, buildTestConfig, parseRuleList, PRIVATE_CIDRS };
