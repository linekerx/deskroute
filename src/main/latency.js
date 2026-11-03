'use strict';
/**
 * Проверка задержки серверов.
 *  - tcp: время TCP-рукопожатия до сервера;
 *  - url: «реальная задержка» — HTTP-запрос через временный экземпляр Xray (как в v2rayN/Happ).
 */
const net = require('net');
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { getFreePorts, waitForPort, sleep } = require('./util');
const { buildTestConfig } = require('./xray-config');

function tcpPing(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const s = net.connect({ host, port });
    let done = false;
    const finish = (ms) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ms);
    };
    s.setTimeout(timeout, () => finish(null));
    s.once('connect', () => finish(Math.max(1, Math.round(Number(process.hrtime.bigint() - start) / 1e6))));
    s.once('error', () => finish(null));
  });
}

/** GET через HTTP-прокси; для https — CONNECT + TLS. Возвращает мс или null. */
function requestViaProxy(proxyPort, url, timeout) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve(null);
    }
    const start = process.hrtime.bigint();
    const elapsed = () => Math.max(1, Math.round(Number(process.hrtime.bigint() - start) / 1e6));
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeout);
    // Ответ 2xx–4xx пришёл от настоящего сайта через сервер; 5xx отдаёт само ядро, если сервер недоступен
    const okStatus = (code) => code >= 200 && code < 500;

    if (u.protocol === 'http:') {
      const req = http.request({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: u.href,
        headers: { Host: u.host, 'User-Agent': 'DeskRoute', Connection: 'close' },
        agent: false,
      });
      req.on('response', (res) => {
        res.resume();
        finish(okStatus(res.statusCode) ? elapsed() : null);
      });
      req.on('error', () => finish(null));
      req.setTimeout(timeout, () => req.destroy());
      req.end();
      return;
    }

    const port = Number(u.port) || 443;
    const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${u.hostname}:${port}`, agent: false });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return finish(null);
      }
      const t = tls.connect({ socket, servername: u.hostname, ALPNProtocols: ['http/1.1'] }, () => {
        t.write(`GET ${u.pathname || '/'}${u.search || ''} HTTP/1.1\r\nHost: ${u.host}\r\nUser-Agent: DeskRoute\r\nConnection: close\r\n\r\n`);
      });
      t.once('data', (d) => {
        const m = /^HTTP\/1\.[01] (\d{3})/.exec(d.toString('latin1'));
        t.destroy();
        finish(m && okStatus(Number(m[1])) ? elapsed() : null);
      });
      t.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
    req.end();
  });
}

async function runPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/**
 * Запускает временный Xray с HTTP-входом на каждый профиль.
 * Если весь пакет не стартует (битый конфиг в одном из профилей), проверяет по одному.
 */
async function urlTestBatch(profiles, { bin, assetDir, url, timeout, onResult, tmpDir }) {
  if (!profiles.length) return;
  const ports = await getFreePorts(profiles.length);
  const items = profiles.map((profile, i) => ({ profile, port: ports[i] }));
  let config;
  try {
    config = buildTestConfig(items);
  } catch (e) {
    if (profiles.length === 1) return onResult(profiles[0], null, e.message);
    for (const p of profiles) await urlTestBatch([p], { bin, assetDir, url, timeout, onResult, tmpDir });
    return;
  }
  const dir = tmpDir || os.tmpdir();
  const file = path.join(dir, `deskroute-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  const env = { ...process.env };
  if (assetDir) env.XRAY_LOCATION_ASSET = assetDir;
  const proc = spawn(bin, ['run', '-c', file], { cwd: path.dirname(bin), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  let output = '';
  proc.stdout.on('data', (d) => (output += d));
  proc.stderr.on('data', (d) => (output += d));
  proc.on('exit', () => (exited = true));
  proc.on('error', () => (exited = true));
  try {
    const ready = await waitForPort(items[items.length - 1].port, { timeout: 7000, isAlive: () => !exited });
    if (!ready) {
      if (profiles.length === 1) {
        const line = output.split('\n').reverse().find((l) => /failed|error/i.test(l)) || '';
        onResult(profiles[0], null, line.split(' > ').pop().trim() || 'Ядро не запустилось с этим конфигом');
        return;
      }
      try {
        proc.kill();
      } catch {
        /* */
      }
      for (const p of profiles) await urlTestBatch([p], { bin, assetDir, url, timeout, onResult, tmpDir });
      return;
    }
    await sleep(150);
    await runPool(items, 8, async (it) => {
      const ms = await requestViaProxy(it.port, url, timeout);
      onResult(it.profile, ms, ms == null ? 'Нет ответа' : '');
    });
  } finally {
    try {
      proc.kill();
    } catch {
      /* */
    }
    fs.rm(file, { force: true }, () => {});
  }
}

module.exports = { tcpPing, urlTestBatch, requestViaProxy, runPool };
