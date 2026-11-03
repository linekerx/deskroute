'use strict';
/**
 * Загрузка и разбор подписок. Понимает заголовки, которые отдают панели
 * (3x-ui, Marzban, Remnawave и др.) и Happ-совместимые строки «#ключ: значение» в теле.
 */
const { parseText } = require('./links');
const { b64decode } = require('./util');

function fixLatin1(s) {
  // Значения заголовков приходят как latin1; если провайдер прислал «сырой» UTF-8 — перекодируем.
  return /[\u0080-ÿ]/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s;
}

function decodeMetaValue(v) {
  if (!v) return '';
  const s = fixLatin1(String(v).trim());
  if (/^base64:/i.test(s)) return b64decode(s.slice(7)).trim();
  return s;
}

function parseUserinfo(v) {
  const o = {};
  for (const part of String(v || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o[part.slice(0, i).trim().toLowerCase()] = Number(part.slice(i + 1).trim()) || 0;
  }
  return { upload: o.upload || 0, download: o.download || 0, total: o.total || 0, expire: o.expire || 0 };
}

function filenameFromDisposition(v) {
  if (!v) return '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(v);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* ignore */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(v);
  return plain ? fixLatin1(plain[1].trim()) : '';
}

function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
}

/**
 * @param fetchImpl функция fetch (в Electron — net.fetch, учитывает системный прокси)
 */
async function fetchSubscription(url, { userAgent, fetchImpl, timeout = 25000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent || 'DeskRoute/1.0', Accept: '*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Сервер подписки ответил кодом ${res.status}`);
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { body, headers };
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(e.message))) throw new Error('Сервер подписки не ответил вовремя');
    if (e && /ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(e.message)) throw new Error('Не удалось найти сервер подписки (DNS)');
    if (e && /ERR_CONNECTION|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(e.message)) throw new Error('Не удалось подключиться к серверу подписки');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseSubscription(body, headers = {}) {
  const parsed = parseText(body);
  const meta = parsed.meta || {};
  const h = (k) => headers[k] || meta[k] || '';
  const info = {
    title: decodeMetaValue(h('profile-title')) || filenameFromDisposition(headers['content-disposition']),
    userinfo: h('subscription-userinfo') ? parseUserinfo(h('subscription-userinfo')) : null,
    updateInterval: Number(h('profile-update-interval')) || 0,
    supportUrl: safeUrl(decodeMetaValue(h('support-url'))),
    webPageUrl: safeUrl(decodeMetaValue(h('profile-web-page-url'))),
    announce: decodeMetaValue(h('announce')).slice(0, 600),
  };
  return { profiles: parsed.profiles, errors: parsed.errors, info };
}

module.exports = { fetchSubscription, parseSubscription, parseUserinfo, decodeMetaValue, filenameFromDisposition };
