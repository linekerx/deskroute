'use strict';
/**
 * Чтение списка категорий из geoip.dat / geosite.dat (protobuf).
 * Нужно, чтобы не передавать в Xray правила с несуществующими категориями —
 * иначе ядро не запустится.
 */
const fs = require('fs');

const cache = new Map();

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    if (pos >= buf.length) throw new Error('eof');
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

function codesFromBuffer(buf) {
  const codes = new Set();
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    let len;
    [tag, pos] = readVarint(buf, pos);
    if (tag >> 3 !== 1 || (tag & 7) !== 2) break;
    [len, pos] = readVarint(buf, pos);
    const end = pos + len;
    // внутри записи ищем поле 1 (country_code)
    let p = pos;
    while (p < end) {
      let t;
      [t, p] = readVarint(buf, p);
      const field = t >> 3;
      const wire = t & 7;
      if (wire === 2) {
        let l;
        [l, p] = readVarint(buf, p);
        if (field === 1) {
          codes.add(buf.toString('utf8', p, p + l).toLowerCase());
          break;
        }
        p += l;
      } else if (wire === 0) {
        [, p] = readVarint(buf, p);
      } else if (wire === 5) p += 4;
      else if (wire === 1) p += 8;
      else break;
    }
    pos = end;
  }
  return codes;
}

/** Возвращает Set категорий (в нижнем регистре) или null, если файла нет. */
function readCodes(file) {
  try {
    const st = fs.statSync(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (cache.has(file) && cache.get(file).key === key) return cache.get(file).codes;
    const codes = codesFromBuffer(fs.readFileSync(file));
    cache.set(file, { key, codes });
    return codes;
  } catch {
    return null;
  }
}

function geoInfo(assetDir) {
  const path = require('path');
  if (!assetDir) return { ip: null, site: null };
  return {
    ip: readCodes(path.join(assetDir, 'geoip.dat')),
    site: readCodes(path.join(assetDir, 'geosite.dat')),
  };
}

module.exports = { readCodes, geoInfo, codesFromBuffer };
