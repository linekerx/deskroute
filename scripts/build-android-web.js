#!/usr/bin/env node
'use strict';
/**
 * Собирает интерфейс для Android: копирует src/renderer в android/app/src/main/assets/www,
 * упаковывает общие модули (ссылки, подписки, конфиг Xray) и подключает Android-бэкенд.
 *   node scripts/build-android-web.js [путь к geosite.dat] [путь к geoip.dat]
 */
const fs = require('fs');
const path = require('path');
const { readCodes } = require('../src/main/geo');

const root = path.join(__dirname, '..');
const out = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');
const MODULES = ['util', 'links', 'subscription', 'xray-config', 'zapret', 'store'];

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src', 'renderer'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'js', 'android'), { recursive: true });

// общие модули главного процесса в виде мини-бандла
let bundle = '/* Сгенерировано scripts/build-android-web.js из src/main — не редактировать */\n';
for (const m of MODULES) {
  const code = fs.readFileSync(path.join(root, 'src', 'main', `${m}.js`), 'utf8');
  bundle += `__drDefine(${JSON.stringify(m)}, function (module, exports, require) {\n${code}\n});\n`;
}
fs.writeFileSync(path.join(out, 'js', 'android', 'modules.js'), bundle);

// категории гео-баз, чтобы правила не ссылались на отсутствующие
const [sitePath, ipPath] = process.argv.slice(2);
const site = sitePath ? readCodes(sitePath) : null;
const ip = ipPath ? readCodes(ipPath) : null;
fs.writeFileSync(
  path.join(out, 'js', 'android', 'geo-codes.js'),
  `window.DR_GEO = ${JSON.stringify({ site: site ? [...site].sort() : [], ip: ip ? [...ip].sort() : [] })};\n`,
);
console.log(`geo: ${site ? site.size : 0} geosite, ${ip ? ip.size : 0} geoip`);

for (const f of ['shims.js', 'backend.js']) fs.copyFileSync(path.join(root, 'android', 'web', f), path.join(out, 'js', 'android', f));

const indexPath = path.join(out, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const scripts = ['shims.js', 'modules.js', 'geo-codes.js', 'backend.js'].map((f) => `<script src="js/android/${f}"></script>`).join('\n    ');
if (!html.includes('<!-- demo-mock -->')) throw new Error('В index.html нет метки <!-- demo-mock -->');
html = html.replace('<!-- demo-mock -->', scripts).replace('<html lang="ru"', '<html lang="ru" data-platform="android"');
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1" />', '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />');
fs.writeFileSync(indexPath, html);
console.log(`Интерфейс для Android собран: ${out}`);
