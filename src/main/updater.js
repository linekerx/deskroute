'use strict';
/**
 * Загрузка ядра Xray-core и гео-баз с GitHub (через …/releases/latest/download/…, без API).
 */
const fs = require('fs');
const path = require('path');
const { readZip } = require('./zip');

const XRAY_ASSETS = {
  'win32-x64': 'Xray-windows-64.zip',
  'win32-ia32': 'Xray-windows-32.zip',
  'win32-arm64': 'Xray-windows-arm64-v8a.zip',
  'linux-x64': 'Xray-linux-64.zip',
  'linux-arm64': 'Xray-linux-arm64-v8a.zip',
  'darwin-x64': 'Xray-macos-64.zip',
  'darwin-arm64': 'Xray-macos-arm64-v8a.zip',
};

const GEO_SOURCES = {
  standard: {
    title: 'Стандартные (Loyalsoldier)',
    base: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/',
  },
  russia: {
    title: 'Для России (runetfreedom)',
    base: 'https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/',
  },
};

function xrayAssetName(platform = process.platform, arch = process.arch) {
  return XRAY_ASSETS[`${platform}-${arch}`] || null;
}

async function download(url, fetchImpl, onProgress) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Не удалось скачать файл (код ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (onProgress) onProgress(1, buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  let lastEmit = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    got += value.length;
    const now = Date.now();
    if (onProgress && now - lastEmit > 120) {
      lastEmit = now;
      onProgress(total ? got / total : 0, got, total);
    }
  }
  if (onProgress) onProgress(1, got, total || got);
  return Buffer.concat(chunks);
}

/** Тег последнего релиза (например «v26.10.31») — по адресу страницы, без GitHub API. */
async function latestXrayTag(fetchImpl) {
  try {
    const res = await fetchImpl('https://github.com/XTLS/Xray-core/releases/latest', { redirect: 'follow' });
    const m = /\/releases\/tag\/([^/?#]+)/.exec(res.url || '');
    try {
      if (res.body && res.body.cancel) await res.body.cancel();
    } catch {
      /* ignore */
    }
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function writeAtomic(file, data, mode) {
  const tmp = `${file}.download`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error('Файл ядра занят — отключитесь и повторите');
    throw e;
  }
}

/** Скачивает Xray-core и распаковывает в destDir. */
async function installXray({ destDir, fetchImpl, onProgress }) {
  const asset = xrayAssetName();
  if (!asset) throw new Error(`Нет сборки Xray для ${process.platform}/${process.arch}`);
  fs.mkdirSync(destDir, { recursive: true });
  const buf = await download(`https://github.com/XTLS/Xray-core/releases/latest/download/${asset}`, fetchImpl, (p) => onProgress && onProgress(p * 0.95));
  const zip = readZip(buf);
  const wanted = new Set(['xray', 'xray.exe', 'geoip.dat', 'geosite.dat', 'wintun.dll', 'LICENSE', 'LICENSE-Wintun']);
  let gotBin = false;
  for (const e of zip.entries) {
    const base = e.name.split('/').pop();
    if (!wanted.has(base)) continue;
    const isBin = base === 'xray' || base === 'xray.exe';
    writeAtomic(path.join(destDir, base), zip.read(e), isBin ? 0o755 : undefined);
    if (isBin) gotBin = true;
  }
  if (!gotBin) throw new Error('В архиве нет исполняемого файла xray');
  if (onProgress) onProgress(1);
}

/** Скачивает geoip.dat и geosite.dat из выбранного источника. */
async function installGeo({ destDir, source, fetchImpl, onProgress }) {
  const src = GEO_SOURCES[source] || GEO_SOURCES.standard;
  fs.mkdirSync(destDir, { recursive: true });
  const files = ['geoip.dat', 'geosite.dat'];
  for (let i = 0; i < files.length; i++) {
    const buf = await download(src.base + files[i], fetchImpl, (p) => onProgress && onProgress((i + p) / files.length));
    if (buf.length < 1024) throw new Error(`Файл ${files[i]} подозрительно мал — загрузка прервалась?`);
    writeAtomic(path.join(destDir, files[i]), buf);
  }
}

module.exports = { installXray, installGeo, latestXrayTag, xrayAssetName, GEO_SOURCES, download };
