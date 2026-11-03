'use strict';
/**
 * Сквозной тест: локальный «сервер» Xray с разными протоколами + клиентский конфиг DeskRoute.
 * Запуск: XRAY_BIN=/путь/к/xray XRAY_ASSETS=/папка/с/geo node test/e2e.js
 * Клиент ходит на http://e2e.test/ — сервер перенаправляет это на локальный HTTP-сервер.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const tls = require('tls');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { parseLink } = require('../src/main/links');
const { buildConfig } = require('../src/main/xray-config');
const { CoreProcess, readMetrics } = require('../src/main/core');
const { urlTestBatch, requestViaProxy, tcpPing } = require('../src/main/latency');
const { getFreePorts, waitForPort, sleep, b64encode } = require('../src/main/util');
const { geoInfo } = require('../src/main/geo');
const { Store } = require('../src/main/store');

const BIN = process.env.XRAY_BIN;
const ASSETS = process.env.XRAY_ASSETS || path.dirname(BIN || '.');
if (!BIN) {
  console.log('XRAY_BIN не задан — пропуск');
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-e2e-'));
const U = crypto.randomUUID();

function cert() {
  const key = path.join(tmp, 'key.pem');
  const crt = path.join(tmp, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const der = execFileSync('openssl', ['x509', '-in', crt, '-outform', 'DER']);
  return { key, crt, sha256: crypto.createHash('sha256').update(der).digest('hex') };
}

function x25519() {
  const out = execFileSync(BIN, ['x25519']).toString();
  return { priv: /PrivateKey:\s*(\S+)/.exec(out)[1], pub: /PublicKey\)?:\s*(\S+)/.exec(out)[1] };
}

async function main() {
  const results = [];
  const [httpPort, tlsDestPort, ...P] = await getFreePorts(20);
  const web = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`hello ${req.headers.host}`);
  });
  await new Promise((r) => web.listen(httpPort, '127.0.0.1', r));

  const c = cert();
  const dest = tls.createServer({ key: fs.readFileSync(c.key), cert: fs.readFileSync(c.crt), minVersion: 'TLSv1.3', ALPNProtocols: ['h2', 'http/1.1'] }, (s) => s.end());
  await new Promise((r) => dest.listen(tlsDestPort, '127.0.0.1', r));

  const rk = x25519();
  const sid = '6ba85179e30d4fc2';
  const tlsIn = { security: 'tls', tlsSettings: { certificates: [{ certificateFile: c.crt, keyFile: c.key }] } };
  const ss22 = Buffer.from(crypto.randomBytes(16)).toString('base64');
  const server = {
    log: { loglevel: 'warning' },
    inbounds: [
      { tag: 'vless', listen: '127.0.0.1', port: P[0], protocol: 'vless', settings: { clients: [{ id: U }], decryption: 'none' } },
      { tag: 'vmess', listen: '127.0.0.1', port: P[1], protocol: 'vmess', settings: { clients: [{ id: U }] } },
      { tag: 'trojan', listen: '127.0.0.1', port: P[2], protocol: 'trojan', settings: { clients: [{ password: 'tr-pass' }] }, streamSettings: { network: 'tcp', ...tlsIn } },
      { tag: 'ss', listen: '127.0.0.1', port: P[3], protocol: 'shadowsocks', settings: { method: 'aes-256-gcm', password: 'ss-secret', network: 'tcp,udp' } },
      { tag: 'ss22', listen: '127.0.0.1', port: P[4], protocol: 'shadowsocks', settings: { method: '2022-blake3-aes-128-gcm', password: ss22, network: 'tcp,udp' } },
      { tag: 'ws', listen: '127.0.0.1', port: P[5], protocol: 'vless', settings: { clients: [{ id: U }], decryption: 'none' }, streamSettings: { network: 'ws', wsSettings: { path: '/ws' } } },
      { tag: 'xhttp', listen: '127.0.0.1', port: P[6], protocol: 'vless', settings: { clients: [{ id: U }], decryption: 'none' }, streamSettings: { network: 'xhttp', xhttpSettings: { path: '/xh' } } },
      { tag: 'grpc', listen: '127.0.0.1', port: P[7], protocol: 'vless', settings: { clients: [{ id: U }], decryption: 'none' }, streamSettings: { network: 'grpc', grpcSettings: { serviceName: 'svc' } } },
      {
        tag: 'reality',
        listen: '127.0.0.1',
        port: P[8],
        protocol: 'vless',
        settings: { clients: [{ id: U, flow: 'xtls-rprx-vision' }], decryption: 'none' },
        streamSettings: { network: 'tcp', security: 'reality', realitySettings: { dest: `127.0.0.1:${tlsDestPort}`, serverNames: ['localhost'], privateKey: rk.priv, shortIds: [sid] } },
      },
      { tag: 'vless-tls', listen: '127.0.0.1', port: P[9], protocol: 'vless', settings: { clients: [{ id: U }], decryption: 'none' }, streamSettings: { network: 'tcp', ...tlsIn } },
      { tag: 'socks', listen: '127.0.0.1', port: P[10], protocol: 'socks', settings: { auth: 'password', accounts: [{ user: 'u1', pass: 'p1' }], udp: true } },
      { tag: 'vmess-ws-tls', listen: '127.0.0.1', port: P[11], protocol: 'vmess', settings: { clients: [{ id: U }] }, streamSettings: { network: 'ws', wsSettings: { path: '/vm' }, ...tlsIn } },
      { tag: 'tcp-http', listen: '127.0.0.1', port: P[12], protocol: 'vless', settings: { clients: [{ id: U }], decryption: 'none' }, streamSettings: { network: 'tcp', tcpSettings: { header: { type: 'http', request: { path: ['/'] } } } } },
      { tag: 'hy2', listen: '127.0.0.1', port: P[13], protocol: 'hysteria', settings: { version: 2, clients: [{ auth: 'hy-secret' }] }, streamSettings: { network: 'hysteria', hysteriaSettings: { version: 2 }, security: 'tls', tlsSettings: { certificates: [{ certificateFile: c.crt, keyFile: c.key }], alpn: ['h3'] } } },
    ],
    outbounds: [{ protocol: 'freedom', settings: { redirect: `127.0.0.1:${httpPort}`, finalRules: [{ action: 'allow', ip: ['127.0.0.1/32'] }] } }],
  };
  const serverFile = path.join(tmp, 'server.json');
  fs.writeFileSync(serverFile, JSON.stringify(server));
  const srv = spawn(BIN, ['run', '-c', serverFile], { env: { ...process.env, XRAY_LOCATION_ASSET: ASSETS } });
  let srvLog = '';
  srv.stdout.on('data', (d) => (srvLog += d));
  srv.stderr.on('data', (d) => (srvLog += d));
  const up = await waitForPort(P[0], { timeout: 8000 });
  if (!up) {
    console.log('СЕРВЕР НЕ СТАРТОВАЛ\n' + srvLog);
    process.exit(1);
  }

  const vmessJson = (o) => 'vmess://' + b64encode(JSON.stringify({ v: '2', ps: o.ps, add: '127.0.0.1', port: String(o.port), id: U, aid: '0', scy: 'auto', net: o.net || 'tcp', type: 'none', host: o.host || '', path: o.path || '', tls: o.tls || '', sni: o.sni || '', fp: '' }));
  const LINKS = [
    ['VLESS TCP', `vless://${U}@127.0.0.1:${P[0]}?encryption=none&type=tcp#VLESS%20TCP`],
    ['VMess TCP (json)', vmessJson({ ps: 'VMess', port: P[1] })],
    ['Trojan TLS + pcs', `trojan://tr-pass@127.0.0.1:${P[2]}?security=tls&sni=localhost&pcs=${c.sha256}#Trojan`],
    ['SS aes-256-gcm', `ss://${Buffer.from('aes-256-gcm:ss-secret').toString('base64url')}@127.0.0.1:${P[3]}#SS`],
    ['SS 2022', `ss://2022-blake3-aes-128-gcm:${encodeURIComponent(ss22)}@127.0.0.1:${P[4]}#SS22`],
    ['VLESS WS', `vless://${U}@127.0.0.1:${P[5]}?type=ws&path=%2Fws&host=localhost#WS`],
    ['VLESS XHTTP', `vless://${U}@127.0.0.1:${P[6]}?type=xhttp&path=%2Fxh&mode=auto#XHTTP`],
    ['VLESS gRPC', `vless://${U}@127.0.0.1:${P[7]}?type=grpc&serviceName=svc#gRPC`],
    ['VLESS REALITY Vision', `vless://${U}@127.0.0.1:${P[8]}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=localhost&fp=chrome&pbk=${rk.pub}&sid=${sid}&type=tcp#Reality`],
    ['VLESS TLS + pcs', `vless://${U}@127.0.0.1:${P[9]}?security=tls&sni=localhost&pcs=${c.sha256}&type=tcp#VLESS-TLS`],
    ['SOCKS5 auth', `socks://${b64encode('u1:p1')}@127.0.0.1:${P[10]}#Socks`],
    ['VMess WS TLS (json)', vmessJson({ ps: 'VMess WS TLS', port: P[11], net: 'ws', path: '/vm', tls: 'tls', sni: 'localhost' }).replace(/$/, '')],
    ['VLESS TCP http-header', `vless://${U}@127.0.0.1:${P[12]}?type=tcp&headerType=http&host=localhost&path=%2F#HTTPHDR`],
    ['Hysteria2', `hysteria2://hy-secret@127.0.0.1:${P[13]}/?sni=localhost&pinSHA256=${c.sha256}#HY2`],
  ];

  const settings = Store.defaults().settings;
  settings.mode = 'proxy';
  settings.routing.preset = 'ru-direct';
  settings.routing.blockAds = true;
  settings.routing.direct = ['example.org', 'geosite:telegram', 'geosite:no-such-category'];
  const geo = geoInfo(ASSETS);
  const core = new CoreProcess();

  for (const [label, link] of LINKS) {
    let profile;
    try {
      profile = parseLink(link);
    } catch (e) {
      results.push([label, 'PARSE FAIL', e.message]);
      continue;
    }
    if (label.startsWith('VMess WS TLS')) profile.pcs = c.sha256; // vmess json не несёт pcs — подставляем для теста TLS
    const [socks, hp, metrics] = await getFreePorts(3);
    const { config, notes } = buildConfig(profile, { ...settings, socksPort: socks, httpPort: hp }, { socks, http: hp, metrics }, geo);
    const file = path.join(tmp, `client-${label.replace(/\W+/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify(config, null, 1));
    try {
      await core.start({ bin: BIN, assetDir: ASSETS, configPath: file, readyPort: hp, mode: 'proxy' });
      const body = await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: hp, method: 'GET', path: 'http://e2e.test/', headers: { Host: 'e2e.test' }, agent: false }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve(`${res.statusCode} ${b}`));
        });
        req.on('error', (e) => resolve('ERR ' + e.message));
        req.setTimeout(8000, () => req.destroy(new Error('timeout')));
        req.end();
      });
      await sleep(250);
      const m = await readMetrics(metrics);
      const ok = body.includes('hello e2e.test') && m && m.down > 0 && m.up > 0;
      results.push([label, ok ? 'OK' : 'FAIL', `${body.slice(0, 40)} | трафик ↑${m && m.up} ↓${m && m.down}${notes.length ? ' | заметки: ' + notes.join('; ') : ''}`]);
    } catch (e) {
      results.push([label, 'FAIL', e.message]);
    } finally {
      await core.stop();
    }
  }

  // Проверка задержки пачкой (как в приложении) + TCP ping
  const profiles = LINKS.map(([, l]) => parseLink(l));
  profiles[11].pcs = c.sha256;
  const lat = {};
  await urlTestBatch(profiles, { bin: BIN, assetDir: ASSETS, url: 'http://e2e.test/', timeout: 6000, tmpDir: tmp, onResult: (p, ms, err) => (lat[p.name] = ms == null ? `нет (${err})` : `${ms} мс`) });
  const badBatch = [...profiles.slice(0, 2), { ...parseLink(`vless://${U}@1.2.3.4:80?type=h2#broken`) }];
  const lat2 = {};
  await urlTestBatch(badBatch, { bin: BIN, assetDir: ASSETS, url: 'http://e2e.test/', timeout: 6000, tmpDir: tmp, onResult: (p, ms, err) => (lat2[p.name] = ms == null ? `нет (${err.slice(0, 70)})` : `${ms} мс`) });
  const tcp = await tcpPing('127.0.0.1', P[0], 2000);

  srv.kill();
  web.close();
  dest.close();

  console.log('\n=== Сквозное проксирование ===');
  for (const r of results) console.log(`${r[1].padEnd(10)} ${r[0].padEnd(24)} ${r[2]}`);
  console.log('\n=== Задержка (пачка) ===');
  console.log(lat);
  console.log('\n=== Пачка с битым конфигом (должна разбиться на одиночные) ===');
  console.log(lat2);
  console.log('TCP ping:', tcp, 'мс');
  const failed = results.filter((r) => r[1] !== 'OK');
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
