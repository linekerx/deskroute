/* Запуск интерфейса: каркас окна, навигация, общие окна (добавление, выбор сервера, QR) */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon, svgEl, clear, plural, latencyClass } = DR.util;
  const S = () => DR.store.state;

  const PAGES = [
    { id: 'home', label: 'Маршрут', icon: 'route' },
    { id: 'servers', label: 'Серверы', icon: 'server' },
    { id: 'rules', label: 'Правила', icon: 'list-filter' },
    { id: 'logs', label: 'Журнал', icon: 'terminal' },
    { id: 'settings', label: 'Настройки', icon: 'settings' },
  ];
  let currentPage = 'home';
  const pageEls = {};
  const railBtns = {};
  let pill;
  let maxBtn;

  function logoSvg(size = 26, colors) {
    const c = colors || { bg: 'var(--line)', fg: 'var(--on-line)', st: 'var(--line)' };
    const svg = svgEl('svg', { viewBox: '0 0 32 32', width: size, height: size, class: 'brand-mark', 'aria-hidden': 'true' });
    svg.append(
      svgEl('rect', { x: 1, y: 1, width: 30, height: 30, rx: 9, fill: c.bg }),
      svgEl('path', { d: 'M8 22 H12.5 L19.5 11 H24', fill: 'none', stroke: c.fg, 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svgEl('circle', { cx: 8, cy: 22, r: 3.4, fill: c.st, stroke: c.fg, 'stroke-width': 2.4 }),
      svgEl('circle', { cx: 24, cy: 11, r: 3.4, fill: c.st, stroke: c.fg, 'stroke-width': 2.4 }),
    );
    return svg;
  }

  /* ---------- каркас ---------- */
  function buildShell() {
    const app = document.getElementById('app');
    app.dataset.platform = S().platform;
    pill = h('button', { class: 'status-pill no-drag', onclick: () => go('home') }, h('span', { class: 'dot' }), h('span', { class: 'label' }));
    pill.style.border = '1px solid var(--hair)';
    maxBtn = h('button', { class: 'win-btn', 'aria-label': 'Развернуть', onclick: () => DR.api.invoke('windowAction', 'maximize') });
    const controls = h('div', { class: 'win-controls' },
      h('button', { class: 'win-btn', 'aria-label': 'Свернуть', onclick: () => DR.api.invoke('windowAction', 'minimize') }, icon('minus', 16)),
      maxBtn,
      h('button', { class: 'win-btn close', 'aria-label': 'Закрыть', onclick: () => DR.api.invoke('windowAction', 'close') }, icon('x', 17)));
    const title = h('header', { class: 'titlebar' }, h('div', { class: 'brand' }, logoSvg(24), 'DeskRoute'), h('div', { class: 'spacer' }), pill, h('div', { style: { width: '6px' } }), controls);
    const rail = h('nav', { class: 'rail', 'aria-label': 'Разделы' });
    for (const p of PAGES) {
      const b = h('button', { class: 'rail-item', onclick: () => go(p.id), 'aria-label': p.label }, icon(p.icon, 21), h('span', null, p.label));
      railBtns[p.id] = b;
      rail.append(b);
    }
    rail.append(h('div', { class: 'spacer' }), h('div', { class: 'rail-foot num' }, `v${S().version || '1.0.0'}`));
    const pages = h('main', { class: 'pages' });
    for (const p of PAGES) {
      pageEls[p.id] = h('section', { class: 'page', dataset: { page: p.id } });
      pages.append(pageEls[p.id]);
    }
    clear(app).append(title, rail, pages);
    renderMax();
    renderPill();
  }

  function renderMax() {
    clear(maxBtn).append(icon(S().maximized ? 'square-stack' : 'square', 14));
  }

  function renderPill() {
    const c = S().conn;
    const srv = DR.store.selected();
    const label = pill.querySelector('.label');
    const name = srv ? DR.flags.cleanName(srv.name) : '';
    label.textContent = { connected: name || 'Подключено', connecting: 'Подключаемся…', disconnecting: 'Отключаемся…', error: 'Ошибка подключения', disconnected: 'Не подключено' }[c.status] || '';
    pill.dataset.tip = c.status === 'connected' ? 'Подключено — открыть схему маршрута' : 'Открыть схему маршрута';
    document.documentElement.dataset.conn = c.status;
  }

  function go(id) {
    if (!pageEls[id]) return;
    currentPage = id;
    for (const p of PAGES) {
      pageEls[p.id].classList.toggle('active', p.id === id);
      railBtns[p.id].classList.toggle('active', p.id === id);
    }
    if (id === 'home') requestAnimationFrame(() => DR.pages.home.layout());
  }

  /* ---------- действия ---------- */
  async function selectServer(id) {
    try {
      await DR.api.invoke('select', id);
    } catch (e) {
      DR.ui.toast('error', e.message);
    }
  }
  async function connectTo(id) {
    try {
      await DR.api.invoke('connect', id);
    } catch (e) {
      DR.ui.toast('error', e.message);
    }
  }
  async function testLatency(ids) {
    try {
      await DR.api.invoke('testLatency', ids || null);
    } catch (e) {
      DR.ui.toast('error', e.message);
    }
  }
  async function updateAll() {
    if (!S().subscriptions.length) return DR.ui.toast('info', 'Подписок пока нет — добавьте ссылку от провайдера');
    const res = await DR.api.invoke('updateAll').catch((e) => DR.ui.toast('error', e.message));
    if (!res) return;
    const bad = res.filter((r) => r.error);
    if (bad.length) DR.ui.toast('warn', `Не обновились: ${bad.map((b) => DR.store.subTitle(b)).join(', ')}. Причина в списке серверов.`);
    else DR.ui.toast('ok', `Подписки обновлены (${res.length})`);
  }
  async function installCore() {
    try {
      const c = await DR.api.invoke('installCore');
      DR.ui.toast('ok', `Ядро Xray ${c.version} установлено`);
    } catch (e) {
      DR.ui.toast('error', `Не удалось скачать ядро: ${e.message}`);
    }
  }
  async function installGeo(source) {
    try {
      await DR.api.invoke('installGeo', source);
      DR.ui.toast('ok', 'Гео-базы обновлены');
    } catch (e) {
      DR.ui.toast('error', `Не удалось скачать гео-базы: ${e.message}`);
    }
  }

  function importSummary(r) {
    const parts = [];
    if (r.added) parts.push(`${r.added} ${plural(r.added, 'сервер добавлен', 'сервера добавлено', 'серверов добавлено')}`);
    if (r.subs) parts.push(`${r.subs} ${plural(r.subs, 'подписка добавлена', 'подписки добавлено', 'подписок добавлено')}`);
    if (r.dup) parts.push(`${r.dup} уже были в списке`);
    if (parts.length) DR.ui.toast('ok', parts.join(', '));
    if (r.errors && r.errors.length) DR.ui.toast(parts.length ? 'warn' : 'error', r.errors.length === 1 ? r.errors[0] : `Не распознано строк: ${r.errors.length}. Например: ${r.errors[0]}`);
    return parts.length > 0;
  }

  function openAdd(prefill) {
    const ta = h('textarea', { class: 'textarea', placeholder: 'https://… — ссылка на подписку\nvless://…, vmess://…, trojan://…, ss://…, hy2://… — серверы (можно несколько строк)', autofocus: true, spellcheck: 'false' });
    const nameField = h('div', { class: 'field hidden' }, h('label', null, 'Название подписки (необязательно)'), h('input', { class: 'input', placeholder: 'Возьмём из подписки, если провайдер его указал' }));
    const detect = h('p', { class: 'hint' }, 'Подойдёт ссылка от провайдера, deep link вида happ://add/… или JSON-конфиг Xray.');
    const submit = h('button', { class: 'btn primary', disabled: true }, 'Добавить');
    const check = DR.util.debounce(async () => {
      const t = ta.value.trim();
      if (!t) {
        submit.disabled = true;
        detect.textContent = 'Подойдёт ссылка от провайдера, deep link вида happ://add/… или JSON-конфиг Xray.';
        nameField.classList.add('hidden');
        return;
      }
      const d = await DR.api.invoke('detect', t).catch(() => null);
      if (!d) return;
      const parts = [];
      if (d.subscriptions) parts.push(`${d.subscriptions} ${plural(d.subscriptions, 'подписка', 'подписки', 'подписок')}`);
      if (d.profiles) parts.push(`${d.profiles} ${plural(d.profiles, 'сервер', 'сервера', 'серверов')}`);
      submit.disabled = !parts.length;
      nameField.classList.toggle('hidden', !(d.subscriptions === 1 && !d.profiles));
      detect.textContent = parts.length ? `Найдено: ${parts.join(' и ')}${d.errors ? `. Не распознано строк: ${d.errors}` : ''}` : d.firstError || 'Не удалось распознать ссылку';
      detect.style.color = parts.length ? 'var(--ok)' : 'var(--bad)';
    }, 150);
    ta.addEventListener('input', check);
    const paste = h('button', { class: 'btn ghost', onclick: async () => {
      const t = await DR.api.invoke('readClipboard').catch(() => '');
      if (t) {
        ta.value = t.trim();
        check();
      } else DR.ui.toast('info', 'В буфере обмена нет текста');
    } }, icon('clipboard-paste', 16), 'Вставить из буфера');
    const m = DR.ui.modal({
      title: 'Добавить',
      width: 600,
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, ta, detect, nameField),
      actions: [paste, h('div', { class: 'spacer' }), h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'), submit],
    });
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      clear(submit).append(icon('loader-circle', 16, 'spin'), 'Загружаем…');
      const text = ta.value.trim();
      const name = nameField.querySelector('input').value.trim();
      try {
        let r;
        if (!nameField.classList.contains('hidden') && name) {
          const res = await DR.api.invoke('addSubscription', text, name);
          r = { added: 0, subs: 1, dup: 0, errors: res.error ? [res.error] : [] };
        } else r = await DR.api.invoke('importText', text);
        importSummary(r);
        m.close();
      } catch (e) {
        DR.ui.toast('error', e.message);
        submit.disabled = false;
        clear(submit).append('Добавить');
      }
    });
    if (prefill) {
      ta.value = prefill;
      check();
    }
  }

  async function pasteImport(textArg) {
    const t = (textArg || (await DR.api.invoke('readClipboard').catch(() => '')) || '').trim();
    if (!t) return DR.ui.toast('info', 'В буфере обмена пусто');
    const d = await DR.api.invoke('detect', t).catch(() => null);
    if (!d || (!d.profiles && !d.subscriptions)) return openAdd(t);
    const r = await DR.api.invoke('importText', t).catch((e) => DR.ui.toast('error', e.message));
    if (r) importSummary(r);
  }

  function quickPicker() {
    const s = S();
    if (!s.servers.length) return openAdd();
    const input = h('input', { class: 'input', placeholder: 'Сервер, страна или протокол', spellcheck: 'false' });
    const list = h('div', { class: 'picker-list' });
    let items = [];
    let active = 0;
    const subTitle = (id) => DR.store.subTitle(s.subscriptions.find((x) => x.id === id) || null);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      items = s.servers.filter((x) => !q || `${x.name} ${x.address} ${x.protocol} ${x.network}`.toLowerCase().includes(q));
      items.sort((a, b) => (b.favorite - a.favorite));
      active = Math.min(active, Math.max(0, items.length - 1));
      clear(list);
      const cur = DR.store.selected();
      items.slice(0, 200).forEach((x, i) => {
        list.append(h('button', { class: `pick ${i === active ? 'active' : ''}`, style: { '--sub': DR.store.subColor(x.subId) }, onclick: () => choose(x), onmousemove: () => {
          if (active !== i) {
            active = i;
            for (const [k, n] of [...list.children].entries()) n.classList.toggle('active', k === i);
          }
        } },
        h('span', { class: 'sub-dot' }),
        DR.flags.flagEl(x.name),
        h('span', { class: 'name' }, DR.flags.cleanName(x.name), cur && cur.id === x.id ? h('span', { class: 'faint' }, '  — текущий') : null),
        h('span', { class: 'grp' }, subTitle(x.subId)),
        x.latency != null ? h('span', { class: `ping ${latencyClass(x.latency)}` }, `${x.latency} мс`) : h('span', { class: 'ping none' }, '—')));
      });
      if (!items.length) list.append(h('p', { class: 'faint', style: { padding: '12px 10px' } }, 'Ничего не нашлось'));
    };
    const choose = async (x) => {
      m.close();
      const st = S().conn.status;
      if (st === 'connecting' || st === 'disconnecting') return;
      await selectServer(x.id);
      if (st !== 'connected' && S().core.installed) connectTo(x.id);
    };
    input.addEventListener('input', () => {
      active = 0;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        for (const [k, n] of [...list.children].entries()) n.classList.toggle('active', k === active);
        const a = list.children[active];
        if (a) a.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && items[active]) choose(items[active]);
    });
    const m = DR.ui.modal({ title: 'Выбор сервера', className: 'picker-modal', body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div', { class: 'search' }, icon('search', 17), input), list, h('p', { class: 'hint' }, h('span', { class: 'kbd' }, '↑'), ' ', h('span', { class: 'kbd' }, '↓'), ' выбор, ', h('span', { class: 'kbd' }, 'Enter'), ' подключиться, ', h('span', { class: 'kbd' }, 'Esc'), ' закрыть')) });
    setTimeout(() => input.focus(), 30);
    draw();
  }

  async function shareServer(s) {
    let link;
    try {
      link = await DR.api.invoke('exportLink', s.id);
    } catch (e) {
      return DR.ui.toast('error', e.message);
    }
    let qrBox;
    try {
      qrBox = h('div', { class: 'qr', html: DR.qr.toSvg(link) });
    } catch (e) {
      qrBox = h('p', { class: 'dim' }, 'Ссылка слишком длинная для QR-кода — скопируйте её текстом.');
    }
    const m = DR.ui.modal({
      title: DR.flags.cleanName(s.name),
      width: 420,
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, qrBox, h('p', { class: 'hint' }, 'Отсканируйте камерой в Happ, v2rayNG или другом клиенте.'), h('div', { class: 'copy-line selectable' }, link)),
      actions: [S().platform === 'android' ? h('button', { class: 'btn', onclick: () => DR.api.invoke('share', link) }, icon('share-2', 16), 'Поделиться') : null, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => DR.util.copyText(link).then(() => {
        DR.ui.toast('ok', 'Ссылка скопирована');
        m.close();
      }) }, icon('copy', 16), 'Копировать ссылку')],
    });
  }

  /* ---------- события главного процесса ---------- */
  function onEvent(type, p) {
    const s = S();
    switch (type) {
      case 'data':
        s.servers = p.servers;
        s.subscriptions = p.subscriptions;
        s.selectedId = p.selectedId;
        DR.store.emit('data', p);
        renderPill();
        break;
      case 'conn': {
        const was = s.conn.status;
        s.conn = p;
        if (p.status === 'connected' && was !== 'connected') s.speed = [];
        if (p.status !== 'connected') s.stats = null;
        DR.store.emit('conn', p);
        renderPill();
        break;
      }
      case 'stats':
        s.stats = p;
        DR.store.emit('stats', p);
        break;
      case 'logs':
        s.logs.push(...p);
        if (s.logs.length > 1500) s.logs.splice(0, s.logs.length - 1500);
        DR.store.emit('logs', p);
        break;
      case 'zapret':
        s.zapret = p;
        DR.store.emit('zapret', p);
        break;
      case 'core':
        s.core = p;
        DR.store.emit('core', p);
        break;
      case 'progress':
        s.progress[p.kind] = p.p;
        DR.store.emit('progress', p);
        break;
      case 'latency': {
        const srv = DR.store.server(p.id);
        if (srv) {
          srv.latency = p.latency;
          srv.latencyError = p.error;
          srv.latencyAt = Date.now();
        }
        s.testing.delete(p.id);
        DR.store.emit('latency', p);
        break;
      }
      case 'latency:start':
        s.testing = new Set(p.ids);
        DR.store.emit('testing');
        break;
      case 'latency:done':
        s.testing.clear();
        DR.store.emit('testing');
        DR.store.emit('latency', {});
        break;
      case 'toast':
        DR.ui.toast(p.type, p.text);
        break;
      case 'deeplink':
        DR.api.invoke('consumeDeepLink').catch(() => {});
        openAdd(p);
        break;
      case 'window':
        s.maximized = p.maximized;
        renderMax();
        break;
      default:
        break;
    }
  }

  /* ---------- клавиатура и вставка ---------- */
  /** Кнопка «Назад» в Android: закрыть окно или меню, затем вернуться на главную. */
  window.__drBack = () => {
    if (document.querySelector('.popover')) {
      DR.ui.closePopover();
      return true;
    }
    const bd = document.querySelectorAll('.backdrop');
    if (bd.length) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    if (currentPage !== 'home') {
      go('home');
      return true;
    }
    return false;
  };

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        quickPicker();
      } else if ((e.ctrlKey || e.metaKey) && /^[1-5]$/.test(e.key) && !inField) {
        e.preventDefault();
        go(PAGES[Number(e.key) - 1].id);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !inField) {
        e.preventDefault();
        openAdd();
      }
    });
    document.addEventListener('paste', (e) => {
      const inField = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
      if (inField || document.querySelector('.backdrop')) return;
      const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (t.trim()) {
        e.preventDefault();
        pasteImport(t);
      }
    });
    window.addEventListener('resize', DR.util.debounce(() => currentPage === 'home' && DR.pages.home.layout(), 80));
  }

  async function init() {
    let snap;
    try {
      snap = await DR.api.invoke('snapshot');
    } catch (e) {
      document.getElementById('app').textContent = `Не удалось запустить интерфейс: ${e.message}`;
      return;
    }
    DR.store.init(snap);
    DR.themes.apply(S().appearance);
    buildShell();
    for (const p of PAGES) DR.pages[p.id].mount(pageEls[p.id]);
    DR.api.on(onEvent);
    bindKeys();
    go('home');
    if (snap.deepLink) {
      DR.api.invoke('consumeDeepLink').catch(() => {});
      openAdd(snap.deepLink);
    }
    document.body.classList.add('ready');
  }

  async function releaseKillSwitch() {
    try {
      await DR.api.invoke('releaseKillSwitch');
      DR.ui.toast('ok', 'Блокировка снята, интернет снова работает напрямую');
    } catch (e) {
      DR.ui.toast('error', e.message);
    }
  }

  DR.app = { releaseKillSwitch, init, go, openAdd, pasteImport, quickPicker, selectServer, connectTo, testLatency, updateAll, installCore, installGeo, shareServer, logoSvg };
  document.addEventListener('DOMContentLoaded', init);
})();
