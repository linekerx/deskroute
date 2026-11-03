'use strict';
/**
 * Windows: запуск DeskRoute с правами администратора без ручного перезапуска.
 *
 * Один раз (одно окно UAC) создаётся задача планировщика «DeskRoute (администратор)» с наивысшими правами.
 * Дальше, когда для TUN или строгого kill switch нужны права, DeskRoute перезапускает себя через эту задачу —
 * без окна UAC — и сразу подключается к выбранному серверу.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TASK = 'DeskRoute (администратор)';

function run(cmd, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.message = String(stderr || err.message).trim() || err.message;
        return reject(err);
      }
      resolve(String(stdout || ''));
    });
  });
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function launchSpec(app) {
  const exe = process.execPath;
  const args = app.isPackaged ? [] : [path.resolve(process.argv[1] || '.')];
  args.push('--elevated-relaunch');
  return { exe, args: args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '), dir: path.dirname(exe) };
}

/** Какой exe и аргументы прописаны в задаче (пусто, если задачи нет). */
async function taskTarget() {
  try {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$t = Get-ScheduledTask -TaskName ${q(TASK)} -ErrorAction Stop; $a = $t.Actions[0]; "$($a.Execute)|$($a.Arguments)"`], 20000);
    const [exe, args] = out.trim().split('|');
    return { exe: exe || '', args: args || '' };
  } catch {
    return null;
  }
}

/** Создаёт (или обновляет) задачу. Показывает одно окно UAC. */
async function createTask(app) {
  const spec = launchSpec(app);
  const user = `${process.env.USERDOMAIN || ''}\\${process.env.USERNAME || ''}`.replace(/^\\/, '');
  const inner = [
    "$ErrorActionPreference = 'Stop'",
    `$a = New-ScheduledTaskAction -Execute ${q(spec.exe)} -Argument ${q(spec.args)} -WorkingDirectory ${q(spec.dir)}`,
    `$p = New-ScheduledTaskPrincipal -UserId ${q(user)} -LogonType Interactive -RunLevel Highest`,
    '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew',
    `Register-ScheduledTask -TaskName ${q(TASK)} -Action $a -Principal $p -Settings $s -Force | Out-Null`,
  ].join('; ');
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = `$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; exit $p.ExitCode`;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], 180000);
  } catch (e) {
    if (/canceled|отменен|1223/i.test(e.message)) throw new Error('Права администратора не выданы — окно Windows было закрыто');
    throw new Error(`Не удалось настроить запуск с правами администратора: ${e.message}`);
  }
  const t = await taskTarget();
  if (!t) throw new Error('Права администратора не выданы — окно Windows было закрыто');
}

/** Готова ли задача для текущего расположения программы (папку могли перенести). */
async function taskReady(app) {
  const t = await taskTarget();
  if (!t) return false;
  return t.exe.toLowerCase() === launchSpec(app).exe.toLowerCase();
}

function runTask() {
  return run('schtasks.exe', ['/Run', '/TN', TASK], 20000);
}

function intentFile(app) {
  return path.join(app.getPath('userData'), 'relaunch.json');
}

function writeIntent(app, intent) {
  fs.writeFileSync(intentFile(app), JSON.stringify({ ...intent, at: Date.now() }));
}

/** Читает и удаляет намерение после перезапуска (не старше 2 минут). */
function takeIntent(app) {
  try {
    const f = intentFile(app);
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.rmSync(f, { force: true });
    return Date.now() - (v.at || 0) < 120000 ? v : null;
  } catch {
    return null;
  }
}

async function removeTask() {
  await run('schtasks.exe', ['/Delete', '/TN', TASK, '/F']).catch(() => {});
}

module.exports = { TASK, createTask, taskReady, runTask, writeIntent, takeIntent, removeTask };
