/* Правила маршрутизации: готовые схемы и свои списки */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon, svgEl, clear } = DR.util;
  const S = () => DR.store.state;
  let el;
  let refs = {};

  /** Маленькие схемы маршрутов для карточек */
  function diagram(kind) {
    const svg = svgEl('svg', { viewBox: '0 0 220 92', class: 'diagram', 'aria-hidden': 'true' });
    const line = (d, color, w = 6, dash) => svg.append(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dash || null }));
    const st = (x, y, color, big) => svg.append(svgEl('circle', { cx: x, cy: y, r: big ? 10 : 7, fill: big ? '#fff' : 'var(--bg)', stroke: color, 'stroke-width': big ? 5 : 4 }));
    const label = (x, y, t, anchor = 'middle') => {
      const n = svgEl('text', { x, y, 'text-anchor': anchor, fill: 'var(--text-2)', 'font-size': 10.5, 'font-family': 'var(--font-ui)', 'font-weight': 500 });
      n.textContent = t;
      svg.append(n);
    };
    const L = 'var(--line)';
    const OK = 'var(--ok)';
    const MUTED = 'color-mix(in srgb, var(--text-3) 70%, transparent)';
    if (kind === 'global') {
      line('M18 62 H70 L96 36 H124 L150 62 H202', L);
      st(18, 62, L);
      st(110, 36, L, true);
      st(202, 62, L);
      label(18, 84, 'ПК');
      label(110, 16, 'Сервер');
      label(202, 84, 'Весь интернет');
    } else if (kind === 'ru-direct') {
      line('M58 62 H202', OK, 5);
      line('M18 62 H58 L84 36 H202', L);
      st(18, 62, L);
      st(102, 36, L, true);
      st(202, 36, L);
      st(202, 62, OK);
      label(18, 84, 'ПК');
      label(102, 16, 'Сервер');
      label(196, 22, 'Мир', 'end');
      label(202, 84, 'Сайты РФ напрямую', 'end');
    } else {
      line('M18 62 H202', MUTED, 4);
      line('M60 62 L86 36 H150', L);
      st(18, 62, L);
      st(116, 36, L, true);
      st(150, 36, L);
      st(202, 62, MUTED);
      label(18, 84, 'ПК');
      label(116, 16, 'Сервер');
      label(160, 40, 'Заблок.', 'start');
      label(202, 84, 'Остальное напрямую', 'end');
    }
    return svg;
  }

  const PRESETS = [
    { id: 'global', title: 'Всё через VPN', text: 'Весь трафик идёт через сервер. Локальная сеть остаётся доступной напрямую.' },
    { id: 'ru-direct', title: 'Россия напрямую', text: 'Российские сайты и адреса открываются без сервера: банки, госуслуги и магазины работают как обычно.' },
    { id: 'blocked', title: 'Только заблокированное', text: 'Через сервер идут только заблокированные ресурсы, остальное — напрямую. Нужны гео-базы для России.' },
  ];

  const LISTS = [
    { kind: 'direct', title: 'Напрямую', icon: 'arrow-down-up', color: 'var(--ok)', hint: 'Открываются без сервера, даже если режим «Всё через VPN».' },
    { kind: 'proxy', title: 'Через VPN', icon: 'shield-check', color: 'var(--line)', hint: 'Всегда идут через сервер. Этот список важнее «Напрямую».' },
    { kind: 'block', title: 'Блокировать', icon: 'ban', color: 'var(--bad)', hint: 'Запросы к этим адресам будут отклонены.' },
  ];

  const saveList = {};
  function onListChange(kind, list) {
    if (!saveList[kind]) {
      saveList[kind] = DR.util.debounce((v) => {
        DR.api
          .invoke('setRoutingList', kind, v)
          .then((routing) => {
            S().settings.routing = routing;
            DR.store.emit('settings', S().settings);
          })
          .catch((e) => DR.ui.toast('error', e.message));
      }, 500);
    }
    saveList[kind](list);
  }

  function suggest(q) {
    const g = S().core.geo || {};
    const site = g.siteCodes || [];
    const ip = g.ipCodes || [];
    const out = [];
    const term = q.replace(/^(geosite|geoip):/, '');
    if (!q.startsWith('geoip:')) for (const c of site) if (c.includes(term)) out.push(`geosite:${c}`);
    if (!q.startsWith('geosite:')) for (const c of ip) if (c.includes(term)) out.push(`geoip:${c}`);
    out.sort((a, b) => a.length - b.length);
    return out;
  }

  function renderPresets() {
    const s = S().settings;
    const g = S().core.geo || {};
    clear(refs.presets);
    for (const p of PRESETS) {
      const need = p.id === 'blocked' && !g.ruBlocked;
      const card = h(
        'button',
        { class: `preset ${s.routing.preset === p.id ? 'on' : ''}`, onclick: () => DR.store.setSettings({ routing: { preset: p.id } }).then(renderPresets) },
        diagram(p.id),
        h('h3', null, p.title),
        h('p', null, p.text),
        need ? h('span', { class: 'need' }, S().platform === 'android' ? 'В Android пока недоступно: во встроенных гео-базах нет списка заблокированного' : 'Гео-базы для России не установлены') : null,
      );
      refs.presets.append(card);
    }
    const g2 = S().core.geo || {};
    clear(refs.geoNote);
    if (!g2.ruBlocked && S().platform !== 'android') {
      const p = S().progress.geo;
      refs.geoNote.append(
        h('div', { class: 'banner info', style: { marginTop: '14px' } },
          icon('info', 18),
          h('div', { class: 'grow' }, h('b', null, 'Гео-базы для России'), h('span', { class: 'dim' }, 'Списки заблокированных сайтов от проекта runetfreedom. Нужны для режима «Только заблокированное», около 100 МБ.')),
          h('button', { class: 'btn sm', disabled: p != null, onclick: () => DR.app.installGeo('russia') }, p != null ? `Скачивание ${Math.round(p * 100)}%` : 'Скачать')),
      );
    }
  }

  function render() {
    const s = S().settings;
    if (!s) return;
    renderPresets();
    refs.ads.set(s.routing.blockAds);
    refs.resolve.set(s.resolveForRouting);
    for (const l of LISTS) refs[l.kind].set(s.routing[l.kind] || []);
  }

  function mount(root) {
    el = root;
    const presets = h('div', { class: 'presets' });
    const geoNote = h('div');
    const ads = DR.ui.toggle(false, (v) => DR.store.setSettings({ routing: { blockAds: v } }), 'Блокировать рекламу');
    const resolve = DR.ui.toggle(false, (v) => DR.store.setSettings({ resolveForRouting: v }), 'Определять IP по домену');
    refs = { presets, geoNote, ads, resolve };
    const lists = h('div', { class: 'rule-lists' });
    for (const l of LISTS) {
      const chips = DR.ui.chipInput({ values: [], placeholder: 'домен, IP или geosite:…', suggest, color: l.color, onChange: (v) => onListChange(l.kind, v) });
      refs[l.kind] = chips;
      lists.append(h('div', { class: 'rule-list', style: { '--chip': l.color } }, h('h3', null, icon(l.icon, 17), l.title), h('p', { class: 'hint' }, l.hint), chips));
    }
    el.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Правила')),
      presets,
      geoNote,
      h('div', { class: 'rules-opts' },
        h('label', { class: 'opt' }, ads, h('div', null, h('div', { class: 't' }, 'Блокировать рекламу и трекеры'), h('div', { class: 'd' }, 'По списку geosite:category-ads-all'))),
        h('label', { class: 'opt' }, resolve, h('div', null, h('div', { class: 't' }, 'Определять IP по домену'), h('div', { class: 'd' }, 'Точнее находит российские сайты на иностранных доменах, но первый заход на сайт чуть дольше')))),
      h('div', { class: 'section-title' }, 'Свои правила'),
      lists,
      h('p', { class: 'rule-help' },
        'Можно вводить: ', h('code', null, 'example.com'), ' (вместе с поддоменами), ', h('code', null, 'full:example.com'), ' (только этот адрес), ',
        h('code', null, 'keyword:google'), ', ', h('code', null, 'geosite:youtube'), ', ', h('code', null, 'geoip:ru'), ', ', h('code', null, '1.2.3.4'), ' или ', h('code', null, '10.0.0.0/8'),
        '. Изменения применяются сразу, даже во время подключения.'),
    );
    DR.store.on('settings', render);
    DR.store.on('core', render);
    DR.store.on('progress', renderPresets);
    render();
  }

  DR.pages = DR.pages || {};
  DR.pages.rules = { mount, render };
})();
