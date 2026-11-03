'use strict';
/**
 * Совместимость с zapret / zapret-discord-youtube.
 *
 * Почему конфликтует (так ведёт себя Happ):
 *  1. zapret ловит все исходящие TCP/UDP на порты 80/443 и подмешивает «фейковые» пакеты в соединения
 *     из своих списков (ipset-all, list-general). Если VPN-сервер стоит у хостинга из этих списков
 *     или его SNI попал в список, zapret ломает рукопожатие VLESS/REALITY — VPN не подключается.
 *  2. VPN забирает себе трафик Discord и YouTube, и zapret перестаёт с ним работать: голос в Discord
 *     и видео идут через сервер (или вовсе не идут, если сервер их режет).
 *
 * Что делает DeskRoute:
 *  - Discord и YouTube (включая голосовые UDP-порты Discord) идут мимо VPN, напрямую — их обрабатывает zapret;
 *  - в режиме системного прокси эти домены добавляются в исключения прокси, браузер ходит к ним напрямую;
 *  - Linux: соединения ядра с VPN-сервером помечаются меткой 0x40000000, которую zapret (nfqws) пропускает;
 *  - Windows: адреса серверов можно одной кнопкой дописать в ipset-exclude.txt / list-exclude.txt zapret.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { execFile } = require('child_process');

const DOMAINS = [
  'discord.com', 'discord.gg', 'discord.gift', 'discord.media', 'discord.new', 'discord.co', 'discord.dev', 'discord.app',
  'discordapp.com', 'discordapp.net', 'discordcdn.com', 'discord-attachments-uploads-prd.storage.googleapis.com',
  'discordstatus.com', 'dis.gd',
  'youtube.com', 'youtu.be', 'ytimg.com', 'ggpht.com', 'googlevideo.com', 'youtube-nocookie.com',
  'youtubei.googleapis.com', 'youtube.googleapis.com', 'yt.be', 'withyoutube.com',
];
const GEOSITE = ['discord', 'youtube'];
// Голос Discord (RTC) и STUN
const DISCORD_UDP_PORTS = '19294-19344,50000-65535';

/** Метка, которую zapret ставит на свои пакеты и пропускает (DESYNC_MARK в nfqws). */
const ZAPRET_SKIP_MARK = 0x40000000;
/** Наша метка для правил kill switch на Linux. */
const DR_MARK = 0x00440000;

function run(cmd, args, timeout = 12000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

function psRun(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], 15000);
}

function argValue(cmdline, name) {
  const re = new RegExp(`--${name}=(?:"([^"]+)"|(\\S+))`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(cmdline))) out.push(m[1] || m[2]);
  return out;
}

function listsFromRoot(root) {
  if (!root) return {};
  const dir = path.join(root, 'lists');
  const pick = (f) => (fs.existsSync(path.join(dir, f)) ? path.join(dir, f) : null);
  return { ipsetExclude: pick('ipset-exclude.txt'), listExclude: pick('list-exclude.txt') };
}

async function detectWindows(manualRoot) {
  const out = { running: false, kind: null, root: null, lists: {} };
  const tl = await run('tasklist', ['/FI', 'IMAGENAME eq winws.exe', '/FO', 'CSV', '/NH']);
  if (/winws\.exe/i.test(tl)) {
    out.running = true;
    out.kind = 'winws';
  }
  const info = await psRun(`
$ErrorActionPreference='SilentlyContinue'
$p = Get-CimInstance Win32_Process -Filter "Name='winws.exe'" | Select-Object -First 1
$s = Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'winws' } | Select-Object -First 1
[pscustomobject]@{ exe=$p.ExecutablePath; cmd=$p.CommandLine; svc=$s.PathName; svcName=$s.Name; svcState=$s.State } | ConvertTo-Json -Compress`);
  let j = {};
  try {
    j = JSON.parse(info.trim() || '{}') || {};
  } catch {
    j = {};
  }
  const cmd = j.cmd || j.svc || '';
  if (j.svcState === 'Running') {
    out.running = true;
    out.kind = out.kind || 'winws';
  }
  let exe = j.exe || (/"?([a-z]:\\[^"]*?winws\.exe)/i.exec(cmd) || [])[1] || null;
  if (exe) out.root = path.dirname(path.dirname(exe));
  if (manualRoot && fs.existsSync(manualRoot)) out.root = manualRoot;
  out.lists = listsFromRoot(out.root);
  // точные пути из командной строки winws, если есть
  const ip = argValue(cmd, 'ipset-exclude')[0];
  const hl = argValue(cmd, 'hostlist-exclude')[0];
  if (ip && fs.existsSync(ip)) out.lists.ipsetExclude = ip;
  if (hl && fs.existsSync(hl)) out.lists.listExclude = hl;
  out.service = j.svcName || null;
  return out;
}

async function detectLinux() {
  const out = { running: false, kind: null, root: null, lists: {} };
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      let comm = '';
      try {
        comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      } catch {
        continue;
      }
      if (comm === 'nfqws' || comm === 'tpws' || comm === 'nfqws2') {
        out.running = true;
        out.kind = comm;
        try {
          const exe = fs.readlinkSync(`/proc/${pid}/exe`);
          out.root = path.resolve(path.dirname(exe), '..', '..');
        } catch {
          /* нет прав — неважно */
        }
        break;
      }
    }
  } catch {
    /* /proc недоступен */
  }
  return out;
}

async function detect(manualRoot) {
  if (process.platform === 'win32') return detectWindows(manualRoot);
  if (process.platform === 'linux') return detectLinux();
  return { running: false, kind: null, root: null, lists: {} };
}

function serverHosts(profiles) {
  const hosts = new Set();
  for (const p of profiles) {
    if (!p) continue;
    if (p.address) hosts.add(String(p.address).toLowerCase());
    if (p.sni) hosts.add(String(p.sni).toLowerCase());
  }
  hosts.delete('—');
  return [...hosts];
}

/**
 * Дописывает адреса VPN-серверов в исключения zapret (Windows, zapret-discord-youtube).
 * Возвращает { ips, domains, files } — что добавлено.
 */
async function addExclusions(lists, profiles) {
  if (!lists || (!lists.ipsetExclude && !lists.listExclude)) {
    throw new Error('Не нашли файлы lists\\ipset-exclude.txt и lists\\list-exclude.txt. Укажите папку zapret вручную или обновите zapret-discord-youtube.');
  }
  const hosts = serverHosts(profiles);
  const ips = new Set();
  const domains = new Set();
  for (const h of hosts) {
    if (net.isIP(h)) {
      ips.add(h);
      continue;
    }
    domains.add(h);
    try {
      for (const r of await dns.lookup(h, { all: true })) ips.add(r.address);
    } catch {
      /* не резолвится — добавим только домен */
    }
  }
  const append = (file, items) => {
    if (!file || !items.length) return 0;
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const have = new Set(cur.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
    const add = items.filter((x) => !have.has(x.toLowerCase()));
    if (!add.length) return 0;
    const sep = cur && !cur.endsWith('\n') ? '\r\n' : '';
    try {
      fs.appendFileSync(file, sep + add.join('\r\n') + '\r\n');
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') throw new Error(`Нет прав на запись в ${file}. Запустите DeskRoute от имени администратора.`);
      throw e;
    }
    return add.length;
  };
  const ipList = [...ips].map((ip) => (net.isIPv6(ip) ? `${ip}/128` : `${ip}/32`));
  const addedIps = append(lists.ipsetExclude, ipList);
  const addedDomains = append(lists.listExclude, [...domains]);
  return { ips: addedIps, domains: addedDomains };
}

/** Есть ли у ядра права ставить метки и создавать TUN (Linux). */
async function coreHasCaps(bin) {
  if (process.platform !== 'linux') return false;
  if (typeof process.getuid === 'function' && process.getuid() === 0) return true;
  const out = (await run('getcap', [bin])) || (await run('/usr/sbin/getcap', [bin]));
  return /cap_net_admin/i.test(out);
}

module.exports = { DOMAINS, GEOSITE, DISCORD_UDP_PORTS, ZAPRET_SKIP_MARK, DR_MARK, detect, addExclusions, coreHasCaps, serverHosts };
