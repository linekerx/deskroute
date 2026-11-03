'use strict';
/**
 * Управление процессом Xray-core: запуск, остановка, журнал, статистика трафика.
 */
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { waitForPort, lineSplitter } = require('./util');

const BIN_NAME = process.platform === 'win32' ? 'xray.exe' : 'xray';

/** Переводит частые ошибки ядра в понятный текст. */
function humanizeCoreError(text, ctx = {}) {
  const t = String(text || '');
  const low = t.toLowerCase();
  if (/address already in use|only one usage of each socket address|bind: .*in use/.test(low)) {
    return `Порт уже занят другой программой (возможно, запущен другой VPN-клиент). Смените порты в настройках или закройте ту программу.`;
  }
  if (low.includes('vless without tls or other encryption is prohibited')) {
    return 'Ядро Xray 26 запрещает VLESS без TLS/REALITY к публичным серверам. Нужен другой конфиг от провайдера.';
  }
  if (low.includes('has been removed and migrated')) {
    const m = /feature (.+?) has been removed/i.exec(t);
    return `Этот тип конфигурации удалён из Xray${m ? ` (${m[1]})` : ''}. Обновите подписку или попросите новый конфиг.`;
  }
  const geo = /failed to check code ([^ ]+) from (geo\w+\.dat)/i.exec(t);
  if (geo) return `В файле ${geo[2]} нет категории «${geo[1].toLowerCase()}». Обновите гео-базы или уберите правило.`;
  if (/geo(ip|site)\.dat.*(no such file|cannot find|not exist)/i.test(t)) return 'Не найдены гео-базы geoip.dat / geosite.dat. Скачайте ядро заново в настройках.';
  if (/access is denied|operation not permitted|permission denied/i.test(low) && ctx.mode === 'tun') {
    return 'Для режима TUN нужны права администратора. Перезапустите DeskRoute от имени администратора.';
  }
  if (low.includes('invalid "password"') || low.includes('invalid public key')) return 'Неверный публичный ключ REALITY в конфиге.';
  if (low.includes('unknown cipher method')) return 'Шифр Shadowsocks не поддерживается ядром Xray.';
  const failed = t.split('\n').reverse().find((l) => /failed|error|panic/i.test(l));
  if (failed) {
    const parts = failed.split(' > ');
    return parts[parts.length - 1].trim().slice(0, 300);
  }
  return t.trim().split('\n').slice(-3).join(' ').slice(0, 300) || 'Ядро завершилось с ошибкой';
}

class CoreProcess extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.expected = false;
  }

  get running() {
    return !!this.proc;
  }

  /**
   * Запускает ядро и ждёт, пока откроется порт readyPort.
   */
  async start({ bin, assetDir, configPath, readyPort, timeout = 9000, mode }) {
    if (this.proc) await this.stop();
    if (!bin || !fs.existsSync(bin)) throw new Error('Ядро Xray не найдено. Скачайте его в Настройки → Ядро.');
    const env = { ...process.env };
    if (assetDir) env.XRAY_LOCATION_ASSET = assetDir;
    const proc = spawn(bin, ['run', '-c', configPath], {
      cwd: path.dirname(bin),
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.expected = false;
    const tail = [];
    let exited = false;
    let starting = true;
    let spawnError = null;
    const onLine = (line) => {
      tail.push(line);
      if (tail.length > 40) tail.shift();
      this.emit('log', line);
    };
    proc.stdout.on('data', lineSplitter(onLine));
    proc.stderr.on('data', lineSplitter(onLine));
    proc.on('error', (err) => {
      spawnError = err;
      exited = true;
    });
    proc.on('exit', (code, signal) => {
      exited = true;
      if (this.proc === proc) this.proc = null;
      if (!this.expected && !starting) this.emit('crash', { code, signal, message: humanizeCoreError(tail.join('\n'), { mode }) });
      this.emit('exit', { code, signal });
    });

    const ok = await waitForPort(readyPort, { timeout, isAlive: () => !exited });
    starting = false;
    if (!ok) {
      const raw = spawnError ? spawnError.message : tail.join('\n');
      this.expected = true;
      await this.stop();
      throw new Error(exited ? humanizeCoreError(raw, { mode }) : 'Ядро не ответило вовремя');
    }
  }

  stop() {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    this.expected = true;
    this.proc = null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* уже завершён */
        }
        resolve();
      }, 2500);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        proc.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  get pid() {
    return this.proc ? this.proc.pid : null;
  }
}

/** Версия ядра: «26.10.31» или null. */
function coreVersion(bin) {
  return new Promise((resolve) => {
    if (!bin || !fs.existsSync(bin)) return resolve(null);
    execFile(bin, ['version'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /Xray\s+([\d.]+)/i.exec(String(stdout));
      resolve(m ? m[1] : null);
    });
  });
}

/** Читает счётчики трафика из встроенного HTTP-эндпоинта метрик Xray. */
function readMetrics(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/debug/vars', timeout: 1500, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          // Счётчики входящих точны всегда (исходящие у «голых» протоколов отстают),
          // поэтому скорость и итоги считаем по ним: это весь трафик через DeskRoute.
          const inb = (j.stats && j.stats.inbound) || {};
          const out = (j.stats && j.stats.outbound) || {};
          let up = 0;
          let down = 0;
          for (const v of Object.values(inb)) {
            up += v.uplink || 0;
            down += v.downlink || 0;
          }
          const d = out.direct || {};
          resolve({ up, down, directUp: d.uplink || 0, directDown: d.downlink || 0 });
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Опрос статистики раз в секунду: считает скорость и итоги сессии. */
class StatsPoller extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
  }

  start(port) {
    this.stop();
    let last = null;
    let lastAt = 0;
    const tick = async () => {
      const m = await readMetrics(port);
      if (!this.timer) return;
      if (m) {
        const now = Date.now();
        if (last) {
          const dt = Math.max(0.2, (now - lastAt) / 1000);
          this.emit('stats', {
            upSpeed: Math.max(0, (m.up - last.up) / dt),
            downSpeed: Math.max(0, (m.down - last.down) / dt),
            upTotal: m.up,
            downTotal: m.down,
            directTotal: m.directUp + m.directDown,
          });
        }
        last = m;
        lastAt = now;
      }
      this.timer = setTimeout(tick, 1000);
    };
    this.timer = setTimeout(tick, 600);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { CoreProcess, StatsPoller, coreVersion, readMetrics, humanizeCoreError, BIN_NAME };
