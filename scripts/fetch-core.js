#!/usr/bin/env node
'use strict';
/**
 * Скачивает последнюю версию Xray-core в папку core/ — она попадёт в сборку.
 *   node scripts/fetch-core.js                         — для текущей системы
 *   node scripts/fetch-core.js --platform=win32 --arch=x64
 */
const fs = require('fs');
const path = require('path');
const { readZip } = require('../src/main/zip');
const { xrayAssetName } = require('../src/main/updater');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => /^--([^=]+)=(.*)$/.exec(a))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const platform = args.platform || process.platform;
const arch = args.arch || (platform === 'darwin' ? process.arch : 'x64');
const dest = path.join(__dirname, '..', 'core');

async function main() {
  const asset = xrayAssetName(platform, arch);
  if (!asset) throw new Error(`Нет сборки Xray для ${platform}/${arch}`);
  const url = `https://github.com/XTLS/Xray-core/releases/latest/download/${asset}`;
  console.log(`Скачиваю ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GitHub ответил кодом ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Получено ${(buf.length / 1048576).toFixed(1)} МБ, распаковываю в ${dest}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(dest)) if (f !== 'README.md') fs.rmSync(path.join(dest, f), { force: true, recursive: true });
  const zip = readZip(buf);
  const wanted = new Set(['xray', 'xray.exe', 'geoip.dat', 'geosite.dat', 'wintun.dll', 'LICENSE', 'LICENSE-Wintun']);
  for (const e of zip.entries) {
    const base = e.name.split('/').pop();
    if (!wanted.has(base)) continue;
    const isBin = base === 'xray' || base === 'xray.exe';
    fs.writeFileSync(path.join(dest, base), zip.read(e), isBin ? { mode: 0o755 } : undefined);
    console.log(`  ${base}`);
  }
  console.log('Готово.');
}

main().catch((e) => {
  console.error(`Не удалось скачать ядро: ${e.message}`);
  console.error('Можно скачать вручную: https://github.com/XTLS/Xray-core/releases — распакуйте xray(.exe), geoip.dat и geosite.dat в папку core/.');
  process.exit(1);
});
