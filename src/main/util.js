'use strict';
/**
 * Мелкие утилиты, общие для main-процесса.
 */
const crypto = require('crypto');
const net = require('net');

function uid(len = 12) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, len);
}

function hash(str, len = 12) {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, len);
}

/** Base64 / base64url с недостающим паддингом и мусорными пробелами. */
function b64decode(input) {
  let s = String(input || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!s) return '';
  const pad = s.length % 4;
  if (pad === 1) s = s.slice(0, -1);
  else if (pad) s += '='.repeat(4 - pad);
  return Buffer.from(s, 'base64').toString('utf8');
}

function b64encode(str) {
  return Buffer.from(String(str), 'utf8').toString('base64');
}

function looksLikeBase64(s) {
  const t = String(s || '').replace(/\s+/g, '');
  return t.length >= 8 && /^[A-Za-z0-9+/_-]+=*$/.test(t);
}

/** decodeURIComponent, который не падает на битых последовательностях. */
function safeDecode(s) {
  if (s == null) return '';
  const str = String(s);
  try {
    return decodeURIComponent(str);
  } catch {
    return str.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
      try { return decodeURIComponent(m); } catch { return m; }
    });
  }
}

function stripBrackets(host) {
  return String(host || '').replace(/^\[/, '').replace(/\]$/, '');
}

function isIP(s) {
  return net.isIP(stripBrackets(s)) !== 0;
}

function isPrivateAddress(addr) {
  const a = stripBrackets(addr).toLowerCase();
  if (!a) return false;
  if (a === 'localhost' || /\.(lan|local|home|internal|localdomain)$/.test(a)) return true;
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
  }
  if (net.isIPv6(a)) return a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function getFreePorts(n, host) {
  const ports = new Set();
  let guard = 0;
  while (ports.size < n && guard++ < n * 6) ports.add(await getFreePort(host));
  return [...ports];
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

function canConnect(port, host = '127.0.0.1', timeout = 400) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => finish(false));
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
  });
}

async function waitForPort(port, { host = '127.0.0.1', timeout = 8000, isAlive = () => true } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!isAlive()) return false;
    if (await canConnect(port, host)) return true;
    await sleep(120);
  }
  return false;
}

/** Разбивает поток байтов на строки, сохраняя неполный хвост между вызовами. */
function lineSplitter(onLine) {
  let rest = '';
  return (chunk) => {
    rest += chunk.toString('utf8');
    const parts = rest.split(/\r?\n/);
    rest = parts.pop();
    for (const p of parts) if (p.trim()) onLine(p);
  };
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

module.exports = {
  uid,
  hash,
  b64decode,
  b64encode,
  looksLikeBase64,
  safeDecode,
  stripBrackets,
  isIP,
  isPrivateAddress,
  sleep,
  getFreePort,
  getFreePorts,
  isPortFree,
  canConnect,
  waitForPort,
  lineSplitter,
  clamp,
};
