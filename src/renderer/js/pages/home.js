/* Главная: схема маршрута «компьютер → сервер → интернет» с кнопкой-хабом */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon, svgEl, clear, fmtBytes, speedParts, fmtDuration, latencyClass, serverBadges } = DR.util;
  const S = () => DR.store.state;

  const MODE_TEXT = {
    system: 'Браузеры и программы, которые используют системный прокси, идут через выбранный маршрут.',
    proxy: 'Системные настройки не меняются: укажите прокси вручную в нужных программах.',
    tun: 'Весь трафик компьютера идёт через виртуальный адаптер. Нужны права администратора.',
  };
  const PRESET_TEXT = {
    global: 'Весь трафик идёт через сервер, кроме локальной сети.',
    'ru-direct': 'Российские сайты и адреса открываются напрямую, остальное — через сервер.',
    blocked: 'Через сервер идут только заблокированные в России ресурсы.',
  };

  let el;
  let refs = {};
  let chart;
  let timer = 0;
  let packetBucket = '';

  function roundedPath(pts, r) {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const l1 = Math.hypot(x1 - x0, y1 - y0);
      const l2 = Math.hypot(x2 - x1, y2 - y1);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = x1 - ((x1 - x0) / l1) * rr;
      const ay = y1 - ((y1 - y0) / l1) * rr;
      const bx = x1 + ((x2 - x1) / l2) * rr;
      const by = y1 + ((y2 - y1) / l2) * rr;
      d += ` L${ax.toFixed(1)} ${ay.toFixed(1)} Q${x1} ${y1} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    return `${d} L${last[0]} ${last[1]}`;
  }

  function buildRoute() {
    const svg = svgEl('svg', { 'aria-hidden': 'true' });
    const track = svgEl('path', { class: 'track' });
    const halo = svgEl('path', { class: 'live halo', id: 'route-halo' });
    const live = svgEl('path', { class: 'live', id: 'route-live' });
    const packets = svgEl('g', { class: 'packets' });
    svg.append(track, halo, live, packets);
    const phone = S().platform === 'android';
    const pc = h('div', { class: 'station' }, icon(phone ? 'smartphone' : 'laptop', 24));
    const net = h('div', { class: 'station' }, icon('globe', 24));
    const pcLabel = h('div', { class: 'st-label' }, h('b', null, phone ? 'Телефон' : 'Этот компьютер'), h('span', { class: 'pc-sub' }, phone ? 'Приложения' : 'Локально'));
    const netLabel = h('div', { class: 'st-label' }, h('b', null, 'Интернет'), h('span', null, phone ? 'Сайты' : 'Сайты и сервисы'));
    const hub = h('button', { class: 'hub', 'aria-label': 'Подключить или отключить', onclick: onHub }, h('span', { class: 'ring' }), h('span', { class: 'disc' }), icon('power', 46));
    const serverBtn = h('button', { class: 'server-switch', onclick: () => DR.app.quickPicker() });
    const meta = h('div', { class: 'hub-meta' });
    const caption = h('div', { class: 'hub-caption' }, serverBtn, meta);
    const box = h('div', { class: 'route' }, svg, pc, net, pcLabel, netLabel, hub, caption);
    refs = { ...refs, svg, track, halo, live, packets, pc, net, pcLabel, netLabel, hub, serverBtn, meta, caption, route: box };
    new ResizeObserver(layoutRoute).observe(box);
    return box;
  }

  function layoutRoute() {
    const box = refs.route;
    const W = box.clientWidth;
    const H = box.clientHeight;
    if (!W || !H) return;
    const hubR = refs.hub.offsetWidth / 2;
    const yHub = hubR + 6;
    const xPc = Math.max(W < 500 ? 34 : 46, W * 0.09);
    const xNet = W - xPc;
    const xHub = W / 2;
    // на узком экране подъём линии ограничен, чтобы она не заходила за станции
    const maxRise = xHub - hubR * 0.6 - xPc - 30;
    const yLow = Math.min(H - 70, yHub + Math.min(maxRise, Math.max(80, H * 0.36)));
    const rise = yLow - yHub;
    const pts = [
      [xPc, yLow],
      [xHub - hubR * 0.6 - rise, yLow],
      [xHub - hubR * 0.6, yHub],
      [xHub + hubR * 0.6, yHub],
      [xHub + hubR * 0.6 + rise, yLow],
      [xNet, yLow],
    ];
    const d = roundedPath(pts, 22);
    refs.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const p of [refs.track, refs.halo, refs.live]) p.setAttribute('d', d);
    const len = refs.live.getTotalLength();
    box.style.setProperty('--len', `${len.toFixed(0)}`);
    const place = (n, x, y) => {
      n.style.left = `${x}px`;
      n.style.top = `${y}px`;
    };
    place(refs.pc, xPc, yLow);
    place(refs.net, xNet, yLow);
    place(refs.pcLabel, xPc, yLow + 38);
    place(refs.netLabel, xNet, yLow + 38);
    place(refs.hub, xHub, yHub);
    place(refs.caption, xHub, yHub + hubR + 14);
    packetBucket = '';
    updatePackets();
  }

  /** Пакеты на линии: их число и скорость зависят от реального трафика */
  function updatePackets() {
    const st = S().stats;
    const connected = S().conn.status === 'connected';
    const down = connected && st ? st.downSpeed : 0;
    const up = connected && st ? st.upSpeed : 0;
    const level = (v) => (v <= 512 ? 0 : v < 64e3 ? 1 : v < 1e6 ? 2 : v < 8e6 ? 3 : 4);
    const ld = connected ? Math.max(1, level(down)) : 0;
    const lu = connected ? level(up) : 0;
    const bucket = `${ld}|${lu}`;
    if (bucket === packetBucket) return;
    packetBucket = bucket;
    clear(refs.packets);
    if (!connected) return;
    const add = (count, lvl, reverse, color) => {
      const dur = [5, 4.2, 3, 2.1, 1.5][lvl];
      for (let i = 0; i < count; i++) {
        const c = svgEl('circle', { r: 3.6, style: `fill:${color}` });
        const m = svgEl('animateMotion', { dur: `${dur}s`, repeatCount: 'indefinite', begin: `${(-dur * i) / count}s`, calcMode: 'linear', keyPoints: reverse ? '1;0' : '0;1', keyTimes: '0;1' });
        m.append(svgEl('mpath', { href: '#route-live' }));
        c.append(m);
        refs.packets.append(c);
      }
    };
    add([0, 2, 3, 4, 5][ld], ld, true, 'var(--down)');
    if (lu) add([0, 1, 2, 3, 3][lu], lu, false, 'var(--up)');
  }

  async function onHub() {
    const s = S();
    if (!s.servers.length) return DR.app.openAdd();
    if (!s.core.installed && s.conn.status !== 'connected') {
      DR.ui.toast('warn', 'Сначала установите ядро Xray — кнопка в баннере выше');
      return;
    }
    try {
      await DR.api.invoke('toggle');
    } catch (e) {
      DR.ui.toast('error', e.message);
    }
  }

  function buildSide() {
    const downVal = h('div', { class: 'val num' });
    const upVal = h('div', { class: 'val num' });
    const chartBox = h('div', { class: 'chart' });
    const gotEl = h('b', { class: 'num' }, '—');
    const sentEl = h('b', { class: 'num' }, '—');
    const speed = h(
      'div',
      { class: 'panel panel-pad' },
      h('div', { class: 'panel-title' }, 'Скорость'),
      h('div', { class: 'speed-nums' },
        h('div', { class: 'speed-num' }, h('div', { class: 'lbl' }, h('i'), 'Загрузка'), downVal),
        h('div', { class: 'speed-num up' }, h('div', { class: 'lbl' }, h('i'), 'Отдача'), upVal)),
      chartBox,
      h('div', { class: 'totals' }, h('div', null, gotEl, 'получено за сеанс'), h('div', null, sentEl, 'отправлено')),
    );
    const modeSeg = DR.ui.segmented(
      [
        { value: 'system', label: 'Системный' },
        { value: 'proxy', label: 'Только порт' },
        { value: 'tun', label: 'TUN' },
      ],
      'system',
      (v) => DR.store.setSettings({ mode: v }).catch((e) => DR.ui.toast('error', e.message)),
      'full',
    );
    const presetSeg = DR.ui.segmented(
      [
        { value: 'global', label: 'Всё' },
        { value: 'ru-direct', label: 'РФ напрямую' },
        { value: 'blocked', label: 'Блок-лист' },
      ],
      'ru-direct',
      (v) => DR.store.setSettings({ routing: { preset: v } }).catch((e) => DR.ui.toast('error', e.message)),
      'full',
    );
    const modeHint = h('p', { class: 'mode-hint' });
    const how = h(
      'div',
      { class: 'panel panel-pad' },
      h('div', { class: 'panel-title' }, 'Как подключаться'),
      modeSeg,
      h('div', { style: { height: '10px' } }),
      presetSeg,
      modeHint,
    );
    refs = { ...refs, downVal, upVal, gotEl, sentEl, modeSeg, presetSeg, modeHint };
    chart = DR.SpeedChart(chartBox);
    return h('aside', { class: 'side' }, speed, how);
  }

  function mount(root) {
    el = root;
    const banner = h('div', { class: 'home-banner' });
    const statusTitle = h('div', { class: 'status-title' });
    const statusTimer = h('div', { class: 'status-timer num' });
    const statusSub = h('div', { class: 'status-sub' });
    const statusActs = h('div', { class: 'row err-actions' });
    const quick = h('div', { class: 'quick' });
    const head = h('div', { class: 'home-head' }, h('h1', null, 'Маршрут'), h('span', { class: 'where' }));
    const main = h('div', { class: 'home-main' }, head, banner, buildRoute(), h('div', { class: 'status' }, statusTitle, statusTimer, statusSub, statusActs), quick);
    refs = { ...refs, banner, statusTitle, statusTimer, statusSub, statusActs, quick, where: head.querySelector('.where') };
    el.append(h('div', { class: 'home' }, main, buildSide()));

    DR.store.on('conn', () => {
      renderStatus();
      renderServer();
      renderSession();
      updatePackets();
      renderQuick();
    });
    DR.store.on('data', () => {
      renderServer();
      renderQuick();
      renderStatus();
    });
    DR.store.on('latency', () => {
      renderServer();
      renderQuick();
    });
    DR.store.on('stats', (st) => {
      renderSpeed(st);
      renderSession();
      updatePackets();
    });
    DR.store.on('settings', renderModes);
    DR.store.on('core', renderBanner);
    DR.store.on('progress', renderBanner);
    clearInterval(timer);
    timer = setInterval(renderTimer, 1000);
    renderAll();
  }

  function renderAll() {
    renderBanner();
    renderStatus();
    renderServer();
    renderSpeed(S().stats);
    renderSession();
    renderModes();
    renderQuick();
    chart.set(S().speed);
  }

  function renderBanner() {
    const b = refs.banner;
    clear(b);
    const s = S();
    if (s.core.installed) return;
    const p = s.progress.core;
    const btn = h('button', { class: 'btn primary sm', disabled: p != null, onclick: () => DR.app.installCore() }, p != null ? `Скачивание ${Math.round(p * 100)}%` : 'Скачать ядро');
    b.append(
      h('div', { class: 'banner', style: { marginTop: '14px' } },
        icon('triangle-alert', 18),
        h('div', { class: 'grow' }, h('b', null, 'Ядро Xray не установлено'), h('span', { class: 'dim' }, 'Без него подключиться не получится. Загрузка с GitHub займёт около 15 МБ.')),
        btn),
    );
  }

  function renderStatus() {
    const s = S();
    const st = s.conn.status;
    document.documentElement.dataset.conn = st;
    const srv = DR.store.selected();
    clear(refs.statusActs);
    const titles = {
      disconnected: 'Нет подключения',
      connecting: 'Подключаемся…',
      connected: 'Подключено',
      disconnecting: 'Отключаемся…',
      error: 'Не удалось подключиться',
    };
    refs.statusTitle.textContent = titles[st] || '';
    let sub = '';
    if (st === 'disconnected') {
      sub = s.servers.length ? 'Нажмите на кольцо, чтобы проложить маршрут через выбранный сервер' : 'Добавьте ссылку на подписку или конфигурацию сервера';
      if (!s.servers.length) refs.statusActs.append(h('button', { class: 'btn primary', onclick: () => DR.app.openAdd() }, icon('plus', 16), 'Добавить подписку'));
    } else if (st === 'connecting') sub = srv ? DR.flags.cleanName(srv.name) : '';
    else if (st === 'connected') {
      const p = s.conn.ports || {};
      sub = s.platform === 'android' ? 'Трафик телефона идёт через VPN' : s.conn.mode === 'system' ? `Системный прокси включён: 127.0.0.1:${p.http}` : s.conn.mode === 'tun' ? 'Весь трафик идёт через TUN-адаптер' : `HTTP-прокси 127.0.0.1:${p.http}, SOCKS5 127.0.0.1:${p.socks}`;
      const extras = [];
      if (s.conn.killSwitch) extras.push(`kill switch ${s.conn.killSwitch === 'strict' ? 'строгий' : 'мягкий'}`);
      if (s.conn.zapret) extras.push('Discord и YouTube через zapret');
      if (extras.length) sub += `. ${extras.join(', ').replace(/^./, (c) => c.toUpperCase())}`;
    } else if (st === 'error') {
      sub = s.conn.error || '';
      refs.statusActs.append(
        h('button', { class: 'btn sm', onclick: () => DR.api.invoke('connect').catch((e) => DR.ui.toast('error', e.message)) }, icon('refresh-cw', 15), 'Повторить'),
        s.conn.killSwitch ? h('button', { class: 'btn sm', onclick: () => DR.app.releaseKillSwitch() }, icon('lock', 15), 'Снять блокировку') : null,
        h('button', { class: 'btn ghost sm', onclick: () => DR.app.go('logs') }, icon('terminal', 15), 'Открыть журнал'),
      );
    }
    refs.statusSub.textContent = sub;
    refs.statusSub.classList.toggle('selectable', st === 'error');
    renderTimer();
    const route = s.settings ? { global: 'Всё через VPN', 'ru-direct': 'Российские сайты напрямую', blocked: 'Только заблокированное' }[s.settings.routing.preset] : '';
    refs.where.textContent = route;
  }

  function renderTimer() {
    const c = S().conn;
    refs.statusTimer.textContent = c.status === 'connected' && c.since ? fmtDuration(Date.now() - c.since) : '';
  }

  function renderServer() {
    const srv = DR.store.selected();
    const b = refs.serverBtn;
    clear(b);
    clear(refs.meta);
    if (!srv) {
      b.append(icon('server', 16), h('span', { class: 'name' }, 'Сервер не выбран'), icon('chevron-down', 16));
      refs.netLabel.querySelector('span').textContent = S().platform === 'android' ? 'Сайты' : 'Сайты и сервисы';
      return;
    }
    b.append(DR.flags.flagEl(srv.name), h('span', { class: 'name' }, DR.flags.cleanName(srv.name)), icon('chevron-down', 16));
    b.dataset.tip = 'Сменить сервер (Ctrl+K)';
    const badges = h('div', { class: 'badges' }, ...serverBadges(srv).slice(0, 3).map((x) => h('span', { class: `badge ${x.c}` }, x.t)));
    const testing = S().testing.has(srv.id);
    const ping = h('span', { class: `ping ${testing ? 'testing none' : latencyClass(srv.latency)}` }, testing ? 'проверка' : srv.latency != null ? `${srv.latency} мс` : srv.latencyAt ? 'нет ответа' : '— мс');
    refs.meta.append(badges, ping);
  }

  function renderSpeed(st) {
    const connected = S().conn.status === 'connected';
    const d = connected && st ? st.downSpeed : 0;
    const u = connected && st ? st.upSpeed : 0;
    const put = (node, v) => {
      const [n, unit] = speedParts(v);
      clear(node).append(n, h('small', null, unit));
    };
    put(refs.downVal, d);
    put(refs.upVal, u);
    if (connected && st) {
      S().speed.push({ d, u });
      if (S().speed.length > 90) S().speed.shift();
      chart.push({ d, u });
    }
  }

  function renderSession() {
    const s = S();
    const st = s.stats;
    const connected = s.conn.status === 'connected';
    refs.gotEl.textContent = connected && st ? fmtBytes(st.downTotal) : '—';
    refs.sentEl.textContent = connected && st ? fmtBytes(st.upTotal) : '—';
  }

  function renderModes() {
    const s = S().settings;
    if (!s) return;
    refs.modeSeg.set(s.mode);
    refs.presetSeg.set(s.routing.preset);
    const android = S().platform === 'android';
    refs.modeSeg.classList.toggle('hidden', android);
    refs.modeHint.textContent = `${android ? 'Через VPN Android идёт трафик всех приложений.' : MODE_TEXT[s.mode] || ''} ${PRESET_TEXT[s.routing.preset] || ''}`;
    renderStatus();
  }

  function renderQuick() {
    const s = S();
    clear(refs.quick);
    if (!s.servers.length) return;
    let list = s.servers.filter((x) => x.favorite);
    let title = 'Избранные станции';
    if (!list.length) {
      list = s.servers.filter((x) => x.latency != null && !x.issue).sort((a, b) => a.latency - b.latency);
      title = 'Самые быстрые по последней проверке';
    }
    if (!list.length) {
      list = s.servers.filter((x) => !x.issue);
      title = 'Станции';
    }
    list = list.slice(0, 6);
    const cur = DR.store.selected();
    refs.quick.append(
      h('div', { class: 'quick-title' }, title),
      h('div', { class: 'quick-list' }, ...list.map((x) =>
        h('button', { class: `quick-item ${cur && cur.id === x.id ? 'on' : ''}`, onclick: () => DR.app.selectServer(x.id) },
          DR.flags.flagEl(x.name),
          h('span', { class: 'name' }, DR.flags.cleanName(x.name)),
          x.latency != null ? h('span', { class: `ping ${latencyClass(x.latency)}` }, `${x.latency} мс`) : null))),
    );
  }

  DR.pages = DR.pages || {};
  DR.pages.home = { mount, layout: () => layoutRoute(), refresh: renderAll };
})();
