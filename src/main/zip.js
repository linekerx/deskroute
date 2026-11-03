'use strict';
/**
 * Минимальное чтение ZIP-архивов (без zip64) — хватает для релизов Xray-core.
 */
const zlib = require('zlib');

function readZip(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Архив повреждён или это не ZIP');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Архив повреждён (central directory)');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, size, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return {
    entries,
    read(entry) {
      const lo = entry.localOff;
      if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('Архив повреждён (local header)');
      const ln = buf.readUInt16LE(lo + 26);
      const le = buf.readUInt16LE(lo + 28);
      const start = lo + 30 + ln + le;
      const data = buf.subarray(start, start + entry.compSize);
      if (entry.method === 0) return Buffer.from(data);
      if (entry.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Неподдерживаемый метод сжатия: ${entry.method}`);
    },
  };
}

module.exports = { readZip };
