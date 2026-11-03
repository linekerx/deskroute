'use strict';
/* Тесты разбора ссылок и подписок: node --test test/ */
const test = require('node:test');
const assert = require('node:assert');
const { parseLink, parseText, unwrapDeepLink } = require('../src/main/links');
const { parseSubscription } = require('../src/main/subscription');
const { b64encode } = require('../src/main/util');

const U = 'bd2a9c3e-1111-4c2b-9a3f-0c5d6e7f8a9b';

test('vless reality vision', () => {
  const p = parseLink(`vless://${U}@nl1.example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sid=6ba85179e30d4fc2&spx=%2F&type=tcp&headerType=none#%F0%9F%87%B3%F0%9F%87%B1%20%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B`);
  assert.equal(p.protocol, 'vless');
  assert.equal(p.address, 'nl1.example.com');
  assert.equal(p.port, 443);
  assert.equal(p.security, 'reality');
  assert.equal(p.pbk, 'Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw');
  assert.equal(p.spx, '/');
  assert.equal(p.flow, 'xtls-rprx-vision');
  assert.equal(p.name, '🇳🇱 Нидерланды');
  assert.equal(p.issue, '');
});

test('vless xhttp + extra + IPv6', () => {
  const extra = encodeURIComponent(JSON.stringify({ xPaddingBytes: '100-1000' }));
  const p = parseLink(`vless://${U}@[2001:db8::1]:8443/?type=xhttp&security=tls&sni=cdn.example.org&path=%2Fx&mode=packet-up&extra=${extra}&alpn=h2,http/1.1#X`);
  assert.equal(p.address, '2001:db8::1');
  assert.equal(p.port, 8443);
  assert.equal(p.network, 'xhttp');
  assert.equal(p.mode, 'packet-up');
  assert.deepEqual(p.alpn, ['h2', 'http/1.1']);
  assert.ok(p.extra.includes('xPaddingBytes'));
});

test('vless without tls to public host is flagged', () => {
  const p = parseLink(`vless://${U}@1.2.3.4:80?type=ws&path=/ws#plain`);
  assert.ok(p.issue.includes('VLESS'));
});

test('vmess json', () => {
  const j = { v: '2', ps: 'DE Франкфурт', add: 'de.example.com', port: '443', id: U, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: 'cdn.example.com', path: '/vm', tls: 'tls', sni: 'cdn.example.com', fp: 'chrome' };
  const p = parseLink('vmess://' + b64encode(JSON.stringify(j)));
  assert.equal(p.protocol, 'vmess');
  assert.equal(p.name, 'DE Франкфурт');
  assert.equal(p.port, 443);
  assert.equal(p.network, 'ws');
  assert.equal(p.host, 'cdn.example.com');
  assert.equal(p.security, 'tls');
});

test('vmess grpc json maps path→serviceName', () => {
  const j = { ps: 'g', add: 'g.example.com', port: 443, id: U, net: 'grpc', type: 'multi', path: 'svc', host: 'auth.example.com', tls: 'tls' };
  const p = parseLink('vmess://' + b64encode(JSON.stringify(j)).replace(/=+$/, ''));
  assert.equal(p.serviceName, 'svc');
  assert.equal(p.mode, 'multi');
  assert.equal(p.authority, 'auth.example.com');
});

test('trojan defaults to tls', () => {
  const p = parseLink('trojan://p%40ss@tr.example.com:443?sni=tr.example.com#TR');
  assert.equal(p.password, 'p@ss');
  assert.equal(p.security, 'tls');
});

test('shadowsocks SIP002 base64 userinfo', () => {
  const ui = Buffer.from('aes-256-gcm:secret').toString('base64url');
  const p = parseLink(`ss://${ui}@ss.example.com:8388#SS`);
  assert.equal(p.method, 'aes-256-gcm');
  assert.equal(p.password, 'secret');
  assert.equal(p.port, 8388);
});

test('shadowsocks 2022 plain userinfo', () => {
  const p = parseLink('ss://2022-blake3-aes-128-gcm:MDEyMzQ1Njc4OWFiY2RlZg%3D%3D@1.2.3.4:443#ss22');
  assert.equal(p.method, '2022-blake3-aes-128-gcm');
  assert.equal(p.password, 'MDEyMzQ1Njc4OWFiY2RlZg==');
});

test('shadowsocks legacy', () => {
  const p = parseLink('ss://' + b64encode('chacha20-ietf-poly1305:pa:ss@word@5.6.7.8:1234') + '#old');
  assert.equal(p.password, 'pa:ss@word');
  assert.equal(p.address, '5.6.7.8');
  assert.equal(p.port, 1234);
});

test('shadowsocks unsupported cipher flagged', () => {
  const p = parseLink('ss://' + b64encode('aes-256-cfb:x@5.6.7.8:1234'));
  assert.ok(p.issue.includes('aes-256-cfb'));
});

test('socks v2rayN style', () => {
  const p = parseLink('socks://' + b64encode('user:pass') + '@10.0.0.2:1080#S');
  assert.equal(p.user, 'user');
  assert.equal(p.pass, 'pass');
});

test('hysteria2', () => {
  const p = parseLink('hy2://secret@hy.example.com:443,20000-30000/?sni=hy.example.com&pinSHA256=AA:BB:CC#HY');
  assert.equal(p.protocol, 'hysteria2');
  assert.equal(p.port, 443);
  assert.equal(p.auth, 'secret');
  assert.equal(p.pcs, 'aabbcc');
});

test('deep link unwrap', () => {
  assert.equal(unwrapDeepLink('happ://add/https://sub.example.com/abc'), 'https://sub.example.com/abc');
  assert.equal(unwrapDeepLink('deskroute://add/https%3A%2F%2Fsub.example.com%2Fx'), 'https://sub.example.com/x');
  assert.equal(unwrapDeepLink('v2rayng://install-config?url=https%3A%2F%2Fs.example.com%2Fy'), 'https://s.example.com/y');
  assert.throws(() => unwrapDeepLink('happ://crypt2/abcdef'));
});

test('parseText: base64 subscription body with meta lines', () => {
  const body = ['#profile-title: base64:' + b64encode('Мой VPN'), `vless://${U}@a.example.com:443?security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sni=www.microsoft.com#A`, 'trojan://pw@b.example.com:443#B', 'garbage line'].join('\n');
  const r = parseSubscription(b64encode(body), { 'subscription-userinfo': 'upload=100; download=200; total=1000; expire=1893456000' });
  assert.equal(r.profiles.length, 2);
  assert.equal(r.errors.length, 1);
  assert.equal(r.info.title, 'Мой VPN');
  assert.equal(r.info.userinfo.total, 1000);
  assert.equal(r.info.userinfo.expire, 1893456000);
});

test('parseText: JSON configs (Remnawave style)', () => {
  const cfg = [{ remarks: 'JSON NL', outbounds: [{ tag: 'proxy', protocol: 'vless', settings: { vnext: [{ address: 'j.example.com', port: 443, users: [{ id: U, encryption: 'none' }] }] }, streamSettings: { network: 'tcp', security: 'reality' } }, { tag: 'direct', protocol: 'freedom' }] }];
  const r = parseText(JSON.stringify(cfg));
  assert.equal(r.profiles.length, 1);
  assert.equal(r.profiles[0].protocol, 'json');
  assert.equal(r.profiles[0].address, 'j.example.com');
  assert.equal(r.profiles[0].name, 'JSON NL');
});

test('parseText detects subscription urls', () => {
  const r = parseText('https://sub.example.com/abc\nhappp');
  assert.equal(r.subscriptions.length, 1);
});

test('stable key ignores name', () => {
  const a = parseLink(`vless://${U}@a.example.com:443?security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw#One`);
  const b = parseLink(`vless://${U}@a.example.com:443?security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw#Two`);
  assert.equal(a.key, b.key);
});
