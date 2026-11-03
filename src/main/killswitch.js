'use strict';
/**
 * Kill switch: если VPN отвалился, интернет блокируется, чтобы трафик не утёк мимо сервера.
 *
 *  soft   — без прав администратора: при сбое системный прокси не снимается и указывает на
 *           выключенный порт, поэтому браузеры и программы с системным прокси просто не открывают сайты.
 *  strict — весь компьютер: в интернет пускается только ядро Xray (и трафик в TUN), остальное запрещено.
 *           Windows — брандмауэр Windows (нужны права администратора);
 *           Linux — таблица nftables (пароль спросит pkexec), Xray помечает свои пакеты меткой.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DR_MARK, ZAPRET_SKIP_MARK } = require('./zapret');

const GROUP = 'DeskRoute KillSwitch';
const NFT_TABLE = 'deskroute_ks';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.message = String(stderr || err.message).trim() || err.message;
        return reject(err);
      }
      resolve(String(stdout || ''));
    });
  });
}

function ps(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* ---------- Windows ---------- */

async function winEnable({ xrayPath, appPath, tun, prev }) {
  const rules = [
    `New-NetFirewallRule -Group ${q(GROUP)} -DisplayName 'DeskRoute: ядро Xray' -Direction Outbound -Action Allow -Program ${q(xrayPath)} | Out-Null`,
    `New-NetFirewallRule -Group ${q(GROUP)} -DisplayName 'DeskRoute: приложение' -Direction Outbound -Action Allow -Program ${q(appPath)} | Out-Null`,
    `New-NetFirewallRule -Group ${q(GROUP)} -DisplayName 'DeskRoute: локальная сеть' -Direction Outbound -Action Allow -RemoteAddress @('LocalSubnet','127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','169.254.0.0/16','224.0.0.0/4','255.255.255.255','::1','fe80::/10','fc00::/7','ff00::/8') | Out-Null`,
    `New-NetFirewallRule -Group ${q(GROUP)} -DisplayName 'DeskRoute: DHCP' -Direction Outbound -Action Allow -Protocol UDP -LocalPort 68 -RemotePort 67 | Out-Null`,
  ];
  if (tun) rules.push(`New-NetFirewallRule -Group ${q(GROUP)} -DisplayName 'DeskRoute: TUN' -Direction Outbound -Action Allow -InterfaceAlias 'DeskRoute' | Out-Null`);
  const script = `
$ErrorActionPreference = 'Stop'
$prev = Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ n = $_.Name; a = [string]$_.DefaultOutboundAction; e = [string]$_.Enabled } }
Remove-NetFirewallRule -Group ${q(GROUP)} -ErrorAction SilentlyContinue
${rules.join('\n')}
Set-NetFirewallProfile -All -Enabled True -DefaultOutboundAction Block
$prev | ConvertTo-Json -Compress`;
  const out = await ps(script);
  if (prev) return prev;
  try {
    const v = JSON.parse(out.trim());
    return Array.isArray(v) ? v : [v];
  } catch {
    return null;
  }
}

async function winDisable(prev) {
  const lines = (prev && prev.length ? prev : [{ n: 'Domain', a: 'NotConfigured', e: 'True' }, { n: 'Private', a: 'NotConfigured', e: 'True' }, { n: 'Public', a: 'NotConfigured', e: 'True' }]).map(
    (p) => `Set-NetFirewallProfile -Name ${q(p.n)} -DefaultOutboundAction ${q(/block/i.test(p.a) ? 'Block' : p.a === 'Allow' ? 'Allow' : 'NotConfigured')} -Enabled ${q(/false/i.test(p.e) ? 'False' : /notconfigured/i.test(p.e) ? 'NotConfigured' : 'True')}`,
  );
  await ps(`$ErrorActionPreference = 'Continue'\n${lines.join('\n')}\nRemove-NetFirewallRule -Group ${q(GROUP)} -ErrorAction SilentlyContinue`);
}

/* ---------- Linux ---------- */

function nftScript() {
  const mark = `0x${DR_MARK.toString(16).padStart(8, '0')}`;
  const zmark = `0x${ZAPRET_SKIP_MARK.toString(16).padStart(8, '0')}`;
  return `table inet ${NFT_TABLE}
delete table inet ${NFT_TABLE}
table inet ${NFT_TABLE} {
  chain out {
    type filter hook output priority 0; policy drop;
    oifname "lo" accept
    oifname "DeskRoute" accept
    meta mark & ${mark} == ${mark} accept
    meta mark & ${zmark} == ${zmark} accept
    ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 224.0.0.0/4, 255.255.255.255 } accept
    ip6 daddr { fe80::/10, fc00::/7, ff00::/8 } accept
    udp dport { 67, 547 } accept
  }
}
`;
}

/** Одна команда pkexec: выдать права ядру (если нужно) и включить правила. */
async function linuxEnable({ xrayPath, needCaps, dir }) {
  const file = path.join(dir, 'killswitch.nft');
  fs.writeFileSync(file, nftScript());
  const parts = [];
  if (needCaps) parts.push(`setcap cap_net_admin,cap_net_raw,cap_net_bind_service+ep "${xrayPath.replace(/"/g, '\\"')}"`);
  parts.push(`nft -f "${file.replace(/"/g, '\\"')}"`);
  await sudo(parts.join(' && '));
}

async function linuxDisable() {
  await sudo(`nft list table inet ${NFT_TABLE} >/dev/null 2>&1 && nft delete table inet ${NFT_TABLE} || true`);
}

async function sudo(cmd) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return run('sh', ['-c', cmd]);
  try {
    return await run('pkexec', ['sh', '-c', cmd]);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('Не найден pkexec (пакет polkit). Установите его: sudo pacman -S polkit');
    if (e.code === 126 || /dismissed|not authorized|Request dismissed/i.test(e.message)) throw new Error('Пароль не введён — действие отменено');
    throw e;
  }
}

/** Выдать ядру права на TUN и метки (Linux). */
function grantCaps(xrayPath) {
  return sudo(`setcap cap_net_admin,cap_net_raw,cap_net_bind_service+ep "${xrayPath.replace(/"/g, '\\"')}"`);
}

/* ---------- общий интерфейс ---------- */

async function enable(opts) {
  if (process.platform === 'win32') return winEnable(opts);
  if (process.platform === 'linux') {
    await linuxEnable(opts);
    return null;
  }
  throw new Error('Строгий kill switch пока работает только в Windows и Linux');
}

async function disable(prev) {
  if (process.platform === 'win32') return winDisable(prev);
  if (process.platform === 'linux') return linuxDisable();
  return null;
}

module.exports = { enable, disable, grantCaps, nftScript, GROUP, NFT_TABLE };
