/* Серверы: подписки показаны как линии метро, серверы — как станции */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon, clear, fmtBytes, fmtAgo, fmtDate, plural, latencyClass, serverBadges, svgEl } = DR.util;
  const S = () => DR.store.state;

  let el;
  let listEl;
  let countEl;
  let query = '';
  let sort = 'order';
  let favOnly = false;
  const rows = new Map();

  function emptyArt() {
    const svg = svgEl('svg', { viewBox: '0 0 240 90', class: 'art', 'aria-hidden': 'true' });
    svg.append(
      svgEl('path', { d: 'M20 60 H90 L120 30 H150', fill: 'none', stroke: 'var(--line)', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svgEl('path', { d: 'M150 30 L180 60 H220', fill: 'none', stroke: 'var(--text-3)', 'stroke-width': 4, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }),
      svgEl('circle', { cx: 20, cy: 60, r: 9, fill: 'var(--bg)', stroke: 'var(--line)', 'stroke-width': 5 }),
      svgEl('circle', { cx: 150, cy: 30, r: 13, fill: '#fff', stroke: 'var(--line)', 'stroke-width': 6 }),
      svgEl('circle', { cx: 220, cy: 60, r: 9, fill: 'var(--bg)', stroke: 'var(--text-3)', 'stroke-width': 4 }),
    );
    return svg;
  }

  function lineBadge(g) {
    return h('span', { class: 'line-badge' }, g.sub ? String(g.index + 1) : icon('pencil', 15));
  }

  function usageBlock(info) {
    const ui = info && info.userinfo;
    if (!ui || (!ui.total && !ui.expire && !ui.download && !ui.upload)) return null;
    const used = (ui.upload || 0) + (ui.download || 0);
    const box = h('div', { class: 'usage' });
    if (ui.total) {
      const p = Math.min(100, (used / ui.total) * 100);
      box.append(h('div', { class: 'bar' }, h('i', { class: p > 90 ? 'warn' : '', style: { width: `${p}%` } })));
    }
    const left = ui.total ? `${fmtBytes(used)} из ${fmtBytes(ui.total)}` : `${fmtBytes(used)}, без лимита`;
    let right = '';
    if (ui.expire) {
      const days = Math.ceil((ui.expire * 1000 - Date.now()) / 86400e3);
      right = days < 0 ? 'срок истёк' : days === 0 ? 'истекает сегодня' : `ещё ${days} ${plural(days, 'день', 'дня', 'дней')}`;
      box.title = `Действует до ${fmtDate(ui.expire * 1000)}`;
    }
    box.append(h('div', { class: 'txt num' }, h('span', null, left), h('span', { class: right.includes('ист') ? 'faint' : '' }, right)));
    return box;
  }

  function subMenu(anchor, g) {
    const sub = g.sub;
    DR.ui.menu(anchor, [
      { icon: 'refresh-cw', label: 'Обновить', onClick: () => updateSub(sub.id) },
      { icon: 'pencil', label: 'Переименовать', onClick: () => renameSub(sub) },
      { icon: sub.collapsed ? 'chevron-down' : 'chevron-up', label: sub.collapsed ? 'Развернуть' : 'Свернуть', onClick: () => DR.api.invoke('editSubscription', sub.id, { collapsed: !sub.collapsed }) },
      { icon: 'copy', label: 'Копировать ссылку подписки', onClick: () => DR.util.copyText(sub.url).then(() => DR.ui.toast('ok', 'Ссылка подписки скопирована')) },
      sub.info && sub.info.webPageUrl ? { icon: 'external-link', label: 'Сайт провайдера', onClick: () => DR.api.invoke('openExternal', sub.info.webPageUrl) } : null,
      sub.info && sub.info.supportUrl ? { icon: 'life-buoy', label: 'Поддержка', onClick: () => DR.api.invoke('openExternal', sub.info.supportUrl) } : null,
      { sep: true },
      { icon: 'trash', label: 'Удалить подписку', danger: true, onClick: () => removeSub(sub) },
    ]);
  }

  async function updateSub(id) {
    try {
      const r = await DR.api.invoke('updateSubscription', id);
      DR.ui.toast('ok', `Подписка обновлена: ${r.count} ${plural(r.count, 'сервер', 'сервера', 'серверов')}`);
    } catch (e) {
      DR.ui.toast('error', e.message);
    }
  }
  async function renameSub(sub) {
    const v = await DR.ui.promptDialog({ title: 'Название подписки', value: DR.store.subTitle(sub), placeholder: 'Например, «Основной VPN»' });
    if (v != null) DR.api.invoke('editSubscription', sub.id, { name: v });
  }
  async function removeSub(sub) {
    const ok = await DR.ui.confirmDialog({ title: 'Удалить подписку?', text: `«${DR.store.subTitle(sub)}» и все её серверы исчезнут из списка. Ссылку можно будет добавить снова.` });
    if (ok) DR.api.invoke('removeSubscription', sub.id).then(() => DR.ui.toast('ok', 'Подписка удалена'));
  }

  function serverMenu(anchor, s) {
    DR.ui.menu(anchor, [
      { icon: 'power', label: 'Подключиться', onClick: () => DR.app.connectTo(s.id) },
      { icon: 'zap', label: 'Проверить задержку', onClick: () => DR.app.testLatency([s.id]) },
      s.exportable ? { icon: 'qr-code', label: 'Поделиться (QR-код)', onClick: () => DR.app.shareServer(s) } : null,
      s.exportable ? { icon: 'copy', label: 'Копировать ссылку', onClick: () => DR.api.invoke('exportLink', s.id).then((l) => DR.util.copyText(l)).then(() => DR.ui.toast('ok', 'Ссылка скопирована')) } : null,
      { icon: 'pencil', label: 'Переименовать', onClick: () => renameServer(s) },
      !s.subId ? { sep: true } : null,
      !s.subId ? { icon: 'trash', label: 'Удалить', danger: true, onClick: () => removeServer(s) } : null,
    ]);
  }
  async function renameServer(s) {
    const v = await DR.ui.promptDialog({ title: 'Название сервера', value: DR.flags.cleanName(s.name), placeholder: s.originalName });
    if (v != null) DR.api.invoke('renameServer', s.id, v);
  }
  async function removeServer(s) {
    const ok = await DR.ui.confirmDialog({ title: 'Удалить сервер?', text: `«${DR.flags.cleanName(s.name)}» будет удалён из списка.` });
    if (ok) DR.api.invoke('removeServer', s.id);
  }

  function pingEl(s) {
    if (S().testing.has(s.id)) return h('span', { class: 'ping none testing' }, 'проверка');
    if (s.latency != null) return h('span', { class: `ping ${latencyClass(s.latency)}` }, `${s.latency} мс`);
    if (s.latencyAt) return h('span', { class: 'ping bad', 'data-tip': s.latencyError || 'Нет ответа' }, 'нет ответа');
    return h('span', { class: 'ping none' }, '—');
  }

  function row(s) {
    const st = S();
    const live = st.conn.status === 'connected' && st.conn.serverId === s.id;
    const selected = (DR.store.selected() || {}).id === s.id;
    const issue = s.issue || (s.warnings && s.warnings[0]) || '';
    const li = h(
      'li',
      {
        class: `srv ${selected ? 'selected' : ''} ${live ? 'live' : ''} ${s.issue ? 'has-issue' : ''}`,
        dataset: { id: s.id },
        onclick: (e) => {
          if (e.target.closest('button')) return;
          DR.app.selectServer(s.id);
        },
        ondblclick: (e) => {
          if (e.target.closest('button')) return;
          DR.app.connectTo(s.id);
        },
      },
      h('span', { class: 'stop' }),
      DR.flags.flagEl(s.name),
      h('div', { class: 'srv-main' },
        h('div', { class: 'srv-name' }, h('span', { class: 'txt' }, DR.flags.cleanName(s.name)), live ? h('span', { class: 'live-tag' }, 'в сети') : null),
        h('div', { class: 'badges' }, ...serverBadges(s).map((b) => h('span', { class: `badge ${b.c}` }, b.t)), h('span', { class: 'addr selectable' }, `${s.address}:${s.port}`))),
      issue ? h('span', { class: 'warn-ic', 'data-tip': issue }, icon('triangle-alert', 16)) : null,
      pingEl(s),
      h('div', { class: 'acts' },
        h('button', { class: `btn ghost icon sm fav ${s.favorite ? 'on' : ''}`, 'data-tip': s.favorite ? 'Убрать из избранного' : 'В избранное', onclick: () => DR.api.invoke('toggleFavorite', s.id) }, icon('star', 16)),
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Действия', onclick: (e) => serverMenu(e.currentTarget, s) }, icon('ellipsis', 16))),
    );
    rows.set(s.id, li);
    return li;
  }

  function filtered(list) {
    const q = query.trim().toLowerCase();
    let out = list;
    if (q) out = out.filter((s) => `${s.name} ${s.address} ${s.protocol} ${s.network} ${s.inner || ''}`.toLowerCase().includes(q));
    if (favOnly) out = out.filter((s) => s.favorite);
    if (sort === 'ping') out = [...out].sort((a, b) => (a.latency == null) - (b.latency == null) || (a.latency || 0) - (b.latency || 0));
    else if (sort === 'name') out = [...out].sort((a, b) => DR.flags.cleanName(a.name).localeCompare(DR.flags.cleanName(b.name), 'ru'));
    return out;
  }

  function render() {
    if (!listEl) return;
    rows.clear();
    clear(listEl);
    const st = S();
    countEl.textContent = st.servers.length ? `${st.servers.length} ${plural(st.servers.length, 'сервер', 'сервера', 'серверов')}` : '';
    if (!st.servers.length && !st.subscriptions.length) {
      listEl.append(
        h('div', { class: 'empty servers-empty' },
          emptyArt(),
          h('h2', null, 'Здесь пока пусто'),
          h('p', null, 'Добавьте ссылку на подписку от провайдера или конфигурацию сервера. Можно скопировать ссылку и просто нажать Ctrl+V в этом окне.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: () => DR.app.openAdd() }, icon('plus', 16), 'Добавить подписку'),
            h('button', { class: 'btn', onclick: () => DR.app.pasteImport() }, icon('clipboard-paste', 16), 'Вставить из буфера'))),
      );
      return;
    }
    let shown = 0;
    for (const g of DR.store.groups()) {
      const servers = filtered(g.servers);
      if ((query || favOnly) && !servers.length) continue;
      shown += servers.length;
      const sub = g.sub;
      const metaItems = [];
      if (sub) {
        metaItems.push(h('span', null, icon('clock', 13), sub.updating ? 'обновляется…' : `обновлена ${fmtAgo(sub.updatedAt)}`));
        metaItems.push(h('span', null, icon('server', 13), `${g.servers.length} ${plural(g.servers.length, 'сервер', 'сервера', 'серверов')}`));
        if (sub.error) metaItems.push(h('span', { class: 'err', 'data-tip': sub.error }, icon('circle-alert', 13), sub.error.length > 60 ? `${sub.error.slice(0, 60)}…` : sub.error));
      } else metaItems.push(h('span', null, icon('server', 13), `${g.servers.length} ${plural(g.servers.length, 'сервер', 'сервера', 'серверов')}, добавлены вручную`));
      const head = h(
        'header',
        { class: 'line-head' },
        lineBadge(g),
        h('div', { class: 'line-title' }, h('h3', null, DR.store.subTitle(sub)), h('div', { class: 'line-meta' }, ...metaItems)),
        sub ? usageBlock(sub.info) : null,
        sub
          ? h('div', { class: 'line-actions' },
            h('button', { class: 'btn ghost icon sm', 'data-tip': 'Обновить подписку', disabled: sub.updating, onclick: () => updateSub(sub.id) }, icon('refresh-cw', 16, sub.updating ? 'spin' : '')),
            h('button', { class: 'btn ghost icon sm', 'aria-label': 'Действия с подпиской', onclick: (e) => subMenu(e.currentTarget, g) }, icon('ellipsis', 16)))
          : null,
      );
      const announce = sub && sub.info && sub.info.announce ? h('div', { class: 'announce selectable' }, icon('megaphone', 16), sub.info.announce) : null;
      const ul = h('ul', { class: 'stations' }, ...servers.map(row));
      listEl.append(h('section', { class: `line-group panel ${sub && sub.collapsed && !query ? 'collapsed' : ''}`, style: { '--sub': g.color } }, head, announce, ul));
    }
    if (!shown && (query || favOnly)) {
      listEl.append(h('div', { class: 'empty' }, h('p', null, favOnly && !query ? 'В избранном пока нет серверов — отметьте звёздочкой те, которыми пользуетесь чаще.' : 'Ничего не нашлось. Попробуйте другое название, страну или протокол.')));
    }
  }

  function patchLatency(id) {
    const li = rows.get(id);
    const s = DR.store.server(id);
    if (!li || !s) return;
    const old = li.querySelector('.ping');
    if (old) old.replaceWith(pingEl(s));
  }

  function mount(root) {
    el = root;
    countEl = h('span', { class: 'sub' });
    const search = h('input', { class: 'input', placeholder: 'Поиск сервера', spellcheck: 'false' });
    search.addEventListener('input', DR.util.debounce(() => {
      query = search.value;
      render();
    }, 120));
    const sortSel = h('select', { class: 'select', style: { width: '170px' }, 'aria-label': 'Сортировка' },
      h('option', { value: 'order' }, 'Как в подписке'),
      h('option', { value: 'ping' }, 'По задержке'),
      h('option', { value: 'name' }, 'По названию'));
    sortSel.addEventListener('change', () => {
      sort = sortSel.value;
      render();
    });
    const favBtn = h('button', { class: 'btn icon', 'data-tip': 'Только избранные', onclick: () => {
      favOnly = !favOnly;
      favBtn.classList.toggle('primary', favOnly);
      render();
    } }, icon('star', 17));
    const testBtn = h('button', { class: 'btn', onclick: () => DR.app.testLatency() }, icon('zap', 16), 'Проверить задержку');
    const updBtn = h('button', { class: 'btn', onclick: () => DR.app.updateAll() }, icon('refresh-cw', 16), 'Обновить подписки');
    el.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Серверы'), countEl, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => DR.app.openAdd() }, icon('plus', 16), 'Добавить')),
      h('div', { class: 'servers-tools' }, h('div', { class: 'search' }, icon('search', 16), search), sortSel, favBtn, h('div', { class: 'spacer' }), testBtn, updBtn),
    );
    listEl = h('div');
    el.append(listEl);
    DR.store.on('data', render);
    DR.store.on('conn', render);
    DR.store.on('latency', (d) => (d && d.id ? patchLatency(d.id) : render()));
    DR.store.on('testing', () => {
      testBtn.disabled = S().testing.size > 0;
      clear(testBtn).append(icon('zap', 16), S().testing.size ? 'Проверяем…' : 'Проверить задержку');
      for (const id of rows.keys()) patchLatency(id);
    });
    render();
  }

  DR.pages = DR.pages || {};
  DR.pages.servers = { mount, render };
})();
