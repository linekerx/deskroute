'use strict';
/**
 * Системный прокси: Windows (WinINet), macOS (networksetup), Linux (GNOME/KDE).
 */
const { execFile } = require('child_process');

const BYPASS = [
  'localhost',
  '127.*',
  '10.*',
  '172.16.*',
  '172.17.*',
  '172.18.*',
  '172.19.*',
  '172.20.*',
  '172.21.*',
  '172.22.*',
  '172.23.*',
  '172.24.*',
  '172.25.*',
  '172.26.*',
  '172.27.*',
  '172.28.*',
  '172.29.*',
  '172.30.*',
  '172.31.*',
  '192.168.*',
  '<local>',
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve(String(stdout || ''));
    });
  });
}

/* ---------- Windows ---------- */

// Установка через InternetSetOption(INTERNET_OPTION_PER_CONNECTION_OPTION) — так делают sysproxy и v2rayN.
// Браузеры подхватывают изменения сразу, без перезапуска.
const WIN_CS = `
using System;
using System.Runtime.InteropServices;
public static class DeskRouteProxy {
  [StructLayout(LayoutKind.Sequential)]
  struct PerConnOptionList { public int dwSize; public IntPtr pszConnection; public int dwOptionCount; public int dwOptionError; public IntPtr pOptions; }
  [StructLayout(LayoutKind.Explicit)]
  struct OptionValue { [FieldOffset(0)] public int dwValue; [FieldOffset(0)] public IntPtr pszValue; [FieldOffset(0)] public System.Runtime.InteropServices.ComTypes.FILETIME ftValue; }
  [StructLayout(LayoutKind.Sequential)]
  struct PerConnOption { public int dwOption; public OptionValue Value; }
  [DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
  public static bool Apply(bool enable, string server, string bypass) {
    int count = enable ? 3 : 1;
    var opts = new PerConnOption[count];
    opts[0].dwOption = 1;
    opts[0].Value.dwValue = enable ? 3 : 1;
    IntPtr pServer = IntPtr.Zero, pBypass = IntPtr.Zero;
    if (enable) {
      pServer = Marshal.StringToHGlobalUni(server);
      opts[1].dwOption = 2; opts[1].Value.pszValue = pServer;
      pBypass = Marshal.StringToHGlobalUni(bypass);
      opts[2].dwOption = 3; opts[2].Value.pszValue = pBypass;
    }
    int optSize = Marshal.SizeOf(typeof(PerConnOption));
    IntPtr pOpts = Marshal.AllocCoTaskMem(optSize * count);
    for (int i = 0; i < count; i++) Marshal.StructureToPtr(opts[i], new IntPtr(pOpts.ToInt64() + i * optSize), false);
    var list = new PerConnOptionList();
    list.dwSize = Marshal.SizeOf(typeof(PerConnOptionList));
    list.pszConnection = IntPtr.Zero;
    list.dwOptionCount = count;
    list.dwOptionError = 0;
    list.pOptions = pOpts;
    IntPtr pList = Marshal.AllocCoTaskMem(list.dwSize);
    Marshal.StructureToPtr(list, pList, false);
    bool ok = InternetSetOption(IntPtr.Zero, 75, pList, list.dwSize);
    InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0);
    InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0);
    Marshal.FreeCoTaskMem(pOpts);
    Marshal.FreeCoTaskMem(pList);
    if (pServer != IntPtr.Zero) Marshal.FreeHGlobal(pServer);
    if (pBypass != IntPtr.Zero) Marshal.FreeHGlobal(pBypass);
    return ok;
  }
}`;

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function winApply(enable, server, bypass) {
  const key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$key = ${psQuote(key)}`,
    enable
      ? `Set-ItemProperty -Path $key -Name ProxyServer -Value ${psQuote(server)}; Set-ItemProperty -Path $key -Name ProxyOverride -Value ${psQuote(bypass)}; Set-ItemProperty -Path $key -Name ProxyEnable -Value 1 -Type DWord`
      : 'Set-ItemProperty -Path $key -Name ProxyEnable -Value 0 -Type DWord',
    `Add-Type -TypeDefinition ${psQuote(WIN_CS)} -Language CSharp`,
    `if (-not [DeskRouteProxy]::Apply(${enable ? '$true' : '$false'}, ${psQuote(server || '')}, ${psQuote(bypass || '')})) { throw 'InternetSetOption failed' }`,
    "Write-Output 'ok'",
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  } catch (e) {
    // Запасной путь: только реестр (некоторые программы подхватят изменения после перезапуска)
    const reg = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    if (enable) {
      await run('reg', ['add', reg, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', server, '/f']);
      await run('reg', ['add', reg, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', bypass, '/f']);
    }
    await run('reg', ['add', reg, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', enable ? '1' : '0', '/f']);
  }
}

/* ---------- macOS ---------- */

async function macServices() {
  const out = await run('networksetup', ['-listallnetworkservices']);
  return out
    .split('\n')
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('*'));
}

async function macApply(enable, host, httpPort, socksPort, extra = []) {
  for (const svc of await macServices()) {
    try {
      if (enable) {
        await run('networksetup', ['-setwebproxy', svc, host, String(httpPort)]);
        await run('networksetup', ['-setsecurewebproxy', svc, host, String(httpPort)]);
        await run('networksetup', ['-setsocksfirewallproxy', svc, host, String(socksPort)]);
        await run('networksetup', ['-setproxybypassdomains', svc, 'localhost', '127.0.0.1', '*.local', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', ...extra]);
      } else {
        await run('networksetup', ['-setwebproxystate', svc, 'off']);
        await run('networksetup', ['-setsecurewebproxystate', svc, 'off']);
        await run('networksetup', ['-setsocksfirewallproxystate', svc, 'off']);
      }
    } catch {
      /* служба без поддержки прокси */
    }
  }
}

/* ---------- Linux ---------- */

async function linuxApply(enable, host, httpPort, socksPort, extra = []) {
  let done = false;
  try {
    if (enable) {
      await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', host]);
      await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(httpPort)]);
      await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', host]);
      await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(httpPort)]);
      await run('gsettings', ['set', 'org.gnome.system.proxy.socks', 'host', host]);
      await run('gsettings', ['set', 'org.gnome.system.proxy.socks', 'port', String(socksPort)]);
      const ignore = ['localhost', '127.0.0.0/8', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', ...extra];
      await run('gsettings', ['set', 'org.gnome.system.proxy', 'ignore-hosts', `[${ignore.map((x) => `'${x}'`).join(', ')}]`]);
      await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual']);
    } else {
      await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']);
    }
    done = true;
  } catch {
    /* не GNOME */
  }
  for (const tool of ['kwriteconfig6', 'kwriteconfig5']) {
    try {
      const f = ['--file', 'kioslaverc', '--group', 'Proxy Settings', '--key'];
      if (enable) {
        await run(tool, [...f, 'httpProxy', `http://${host} ${httpPort}`]);
        await run(tool, [...f, 'httpsProxy', `http://${host} ${httpPort}`]);
        await run(tool, [...f, 'socksProxy', `socks://${host} ${socksPort}`]);
        await run(tool, [...f, 'NoProxyFor', ['localhost', '127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', ...extra.filter((x) => !x.startsWith('*'))].join(',')]);
        await run(tool, [...f, 'ProxyType', '1']);
      } else {
        await run(tool, [...f, 'ProxyType', '0']);
      }
      done = true;
      break;
    } catch {
      /* нет KDE */
    }
  }
  if (!done) throw new Error('Не удалось изменить системный прокси (поддерживаются GNOME и KDE)');
}

/* ---------- публичный API ---------- */

/** extra — домены, которые ходят мимо прокси (например, Discord и YouTube для zapret). */
async function setSystemProxy({ host = '127.0.0.1', httpPort, socksPort, extra = [] }) {
  const ex = [];
  for (const d of extra) ex.push(d, `*.${d}`);
  if (process.platform === 'win32') return winApply(true, `${host}:${httpPort}`, [...ex, ...BYPASS].join(';'));
  if (process.platform === 'darwin') return macApply(true, host, httpPort, socksPort, ex);
  return linuxApply(true, host, httpPort, socksPort, ex);
}

async function clearSystemProxy() {
  if (process.platform === 'win32') return winApply(false, '', '');
  if (process.platform === 'darwin') return macApply(false);
  return linuxApply(false);
}

/** Есть ли права администратора (нужны для TUN на Windows). */
async function isElevated() {
  if (process.platform === 'win32') {
    try {
      await run('net', ['session']);
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === 'function' ? process.getuid() === 0 : false;
}

module.exports = { setSystemProxy, clearSystemProxy, isElevated, BYPASS };
