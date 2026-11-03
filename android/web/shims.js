/* Минимальные замены модулей Node.js, нужных общим модулям DeskRoute (ссылки, подписки, конфиг Xray) */
(function () {
  const te = new TextEncoder();
  const td = new TextDecoder('utf-8');

  /* ---------- Buffer: только то, что используют общие модули ---------- */
  class Buf {
    constructor(bytes) {
      this.bytes = bytes;
      this.length = bytes.length;
    }
    static from(input, enc) {
      if (input instanceof Buf) return new Buf(input.bytes.slice());
      if (input instanceof Uint8Array) return new Buf(input);
      const s = String(input);
      if (enc === 'base64' || enc === 'base64url') {
        let t = s.replace(/[\s=]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        while (t.length % 4) t += '=';
        let bin = '';
        try {
          bin = atob(t);
        } catch {
          bin = '';
        }
        const b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return new Buf(b);
      }
      if (enc === 'latin1' || enc === 'binary') {
        const b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
        return new Buf(b);
      }
      if (enc === 'hex') {
        const b = new Uint8Array(s.length / 2);
        for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
        return new Buf(b);
      }
      return new Buf(te.encode(s));
    }
    static isBuffer(x) {
      return x instanceof Buf;
    }
    toString(enc) {
      if (enc === 'base64' || enc === 'base64url') {
        let bin = '';
        for (let i = 0; i < this.bytes.length; i++) bin += String.fromCharCode(this.bytes[i]);
        const out = btoa(bin);
        return enc === 'base64url' ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
      }
      if (enc === 'latin1' || enc === 'binary') {
        let s = '';
        for (let i = 0; i < this.bytes.length; i++) s += String.fromCharCode(this.bytes[i]);
        return s;
      }
      if (enc === 'hex') return Array.from(this.bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return td.decode(this.bytes);
    }
  }
  window.Buffer = Buf;

  /* ---------- SHA-1 (для стабильных идентификаторов серверов) ---------- */
  function sha1Hex(str) {
    const msg = te.encode(str);
    const ml = msg.length * 8;
    const withOne = msg.length + 1;
    const total = Math.ceil((withOne + 8) / 64) * 64;
    const m = new Uint8Array(total);
    m.set(msg);
    m[msg.length] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 4, ml >>> 0);
    dv.setUint32(total - 8, Math.floor(ml / 2 ** 32));
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) {
        const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = (x << 1) | (x >>> 31);
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      for (let i = 0; i < 80; i++) {
        let f;
        let k;
        if (i < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (i < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d;
        d = c;
        c = (b << 30) | (b >>> 2);
        b = a;
        a = t;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /* ---------- модули ---------- */
  const isIPv4 = (s) => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(String(s));
  const isIPv6 = (s) => {
    const t = String(s);
    if (!t.includes(':') || !/^[0-9a-fA-F:.]+$/.test(t)) return false;
    try {
      new URL(`http://[${t}]/`);
      return true;
    } catch {
      return false;
    }
  };

  const shims = {
    crypto: {
      randomUUID: () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === 'y' ? 8 : 0)).toString(16))),
      createHash: () => {
        let data = '';
        const api = {
          update(s) {
            data += String(s);
            return api;
          },
          digest() {
            return sha1Hex(data);
          },
        };
        return api;
      },
    },
    net: { isIP: (s) => (isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0), isIPv4, isIPv6 },
    url: {
      domainToASCII: (d) => {
        try {
          return new URL(`http://${d}`).hostname;
        } catch {
          return '';
        }
      },
    },
    fs: {},
    path: { join: (...a) => a.join('/'), dirname: (p) => String(p).replace(/\/[^/]*$/, '') },
    os: {},
    dns: { promises: {} },
    child_process: {},
    events: function EventEmitter() {},
    http: {},
    zlib: {},
  };

  const defs = {};
  const cache = {};
  window.__drDefine = (name, fn) => {
    defs[name] = fn;
  };
  window.__drRequire = function req(name) {
    const key = name.replace(/^\.\//, '');
    if (shims[key]) return shims[key];
    if (cache[key]) return cache[key].exports;
    const fn = defs[key];
    if (!fn) throw new Error(`Модуль ${name} не найден`);
    const module = { exports: {} };
    cache[key] = module;
    fn(module, module.exports, req);
    return module.exports;
  };
})();
