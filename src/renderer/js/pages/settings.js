/* Настройки и студия оформления */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon, svgEl, clear } = DR.util;
  const S = () => DR.store.state;
  const T = () => DR.themes;

  const SECTIONS = [
    { id: 'look', label: 'Оформление', icon: 'palette' },
    { id: 'conn', label: 'Подключение', icon: 'plug' },
    { id: 'subs', label: 'Подписки и проверка', icon: 'rss' },
    { id: 'core', label: 'Ядро и гео-базы', icon: 'cpu' },
    { id: 'about', label: 'О программе', icon: 'info' },
  ];
  const PERSONAL = ['scale', 'animations', 'anim', 'fontUi', 'fontDisplay', 'noise'];

  let root;
  let nav;
  const sections = {};
  let current = 'look';
  const refs = {};

  /* ---------- общее ---------- */
  function setRow(title, desc, ctl) {
    return h('div', { class: 'set-row' }, h('div', { class: 'txt' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), h('div', { class: 'ctl' }, ctl));
  }
  function save(patch) {
    return DR.store.setSettings(patch).catch((e) => {
      DR.ui.toast('error', e.message);
      renderConn();
    });
  }

  /* ---------- студия оформления ---------- */
  function themePreview(colors, params) {
    const svg = svgEl('svg', { viewBox: '0 0 172 86', preserveAspectRatio: 'xMidYMid slice' });
    const lw = Math.max(3, Math.min(8, (params.lineWidth || 6) * 0.75));
    svg.append(
      svgEl('rect', { width: 172, height: 86, fill: colors.bg }),
      svgEl('rect', { x: 120, y: 10, width: 44, height: 66, rx: 6, fill: colors.panel, stroke: colors.border }),
      svgEl('rect', { x: 127, y: 18, width: 22, height: 4, rx: 2, fill: colors['text-2'] }),
      svgEl('rect', { x: 127, y: 28, width: 30, height: 6, rx: 3, fill: colors.text }),
      svgEl('path', { d: 'M127 64 L134 56 L140 60 L148 48 L157 52', fill: 'none', stroke: colors.down, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      svgEl('path', { d: 'M12 60 H34 L50 44 H72 L88 60 H108', fill: 'none', stroke: colors.line, 'stroke-width': lw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svgEl('circle', { cx: 12, cy: 60, r: 5, fill: colors.bg, stroke: colors.line, 'stroke-width': 3 }),
      svgEl('circle', { cx: 61, cy: 44, r: 12, fill: colors.line, stroke: colors.bg, 'stroke-width': 3 }),
      svgEl('circle', { cx: 108, cy: 60, r: 5, fill: colors.bg, stroke: colors.line, 'stroke-width': 3 }),
      svgEl('rect', { x: 12, y: 12, width: 40, height: 6, rx: 3, fill: colors.text }),
      svgEl('rect', { x: 12, y: 22, width: 26, height: 4, rx: 2, fill: colors['text-3'] }),
      svgEl('circle', { cx: 100, cy: 18, r: 4, fill: colors.ok }),
      svgEl('circle', { cx: 110, cy: 18, r: 4, fill: colors['line-2'] }),
    );
    return svg;
  }

  function applyThemeChoice(theme) {
    DR.store.setAppearance((ap) => {
      ap.themeId = theme.id;
      ap.colors = {};
      const keep = {};
      for (const k of Object.keys(ap.params || {})) if (!(k in (theme.params || {})) || PERSONAL.includes(k)) keep[k] = ap.params[k];
      ap.params = keep;
    });
    renderLook();
  }

  function snapshotTheme(name) {
    const r = T().resolve(S().appearance);
    const params = { ...r.params };
    for (const k of PERSONAL) delete params[k];
    delete params.bgImage;
    return { id: `c-${Date.now().toString(36)}`, name: name || 'Моя тема', colors: { ...r.colors }, params };
  }

  async function saveCustom() {
    const name = await DR.ui.promptDialog({ title: 'Сохранить тему', label: 'Название', value: 'Моя тема', ok: 'Сохранить' });
    if (name == null) return;
    const t = snapshotTheme(name);
    DR.store.setAppearance((ap) => {
      ap.saved = [...(ap.saved || []), t];
      ap.themeId = t.id;
      ap.colors = {};
      const keep = {};
      for (const k of PERSONAL) if (ap.params && k in ap.params) keep[k] = ap.params[k];
      if (ap.params && ap.params.bgImage) keep.bgImage = ap.params.bgImage;
      ap.params = keep;
    });
    DR.ui.toast('ok', `Тема «${t.name}» сохранена`);
    renderLook();
  }

  function importDialog() {
    const ta = h('textarea', { class: 'textarea', placeholder: 'DRT1.…', style: { minHeight: '90px' } });
    const m = DR.ui.modal({
      title: 'Импорт темы',
      width: 480,
      body: h('div', { class: 'field' }, h('label', null, 'Вставьте код темы, которым с вами поделились'), ta),
      actions: [
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            try {
              const t = T().fromCode(ta.value);
              const theme = { id: `c-${Date.now().toString(36)}`, ...t };
              DR.store.setAppearance((ap) => {
                ap.saved = [...(ap.saved || []), theme];
              });
              applyThemeChoice(theme);
              m.close();
              DR.ui.toast('ok', `Тема «${theme.name}» добавлена`);
            } catch (e) {
              DR.ui.toast('error', e.message || 'Не удалось прочитать код темы');
            }
          },
        }, 'Добавить тему'),
      ],
    });
  }

  function renderThemes() {
    const box = refs.themes;
    clear(box);
    const ap = S().appearance;
    const all = [...T().PRESETS, ...(ap.saved || [])];
    for (const t of all) {
      const colors = { ...T().PRESETS[0].colors, ...t.colors };
      const custom = t.id.startsWith('c-');
      box.append(
        h('button', { class: `theme-card ${ap.themeId === t.id ? 'on' : ''}`, onclick: () => applyThemeChoice(t) },
          h('div', { class: 'pv' }, themePreview(colors, { ...T().DEFAULT_PARAMS, ...t.params })),
          h('div', { class: 'nm' }, h('span', null, t.name), h('span', { class: 'spacer' }),
            custom
              ? h('span', { class: 'del', role: 'button', 'data-tip': 'Удалить тему', onclick: (e) => {
                e.stopPropagation();
                DR.store.setAppearance((a) => {
                  a.saved = a.saved.filter((x) => x.id !== t.id);
                  if (a.themeId === t.id) a.themeId = 'night';
                });
                renderLook();
              } }, icon('x', 14))
              : null)),
      );
    }
    box.append(
      h('button', { class: 'theme-card action', onclick: () => {
        const r = T().random();
        DR.store.setAppearance((ap2) => {
          ap2.colors = r.colors;
          ap2.params = { ...ap2.params, ...r.params };
        });
        renderLook();
      } }, h('div', { class: 'pv' }, icon('dices', 26)), h('div', { class: 'nm' }, 'Случайная')),
      h('button', { class: 'theme-card action', onclick: importDialog }, h('div', { class: 'pv' }, icon('clipboard-paste', 24)), h('div', { class: 'nm' }, 'Импорт по коду')),
    );
  }

  function renderColors() {
    const box = refs.colors;
    clear(box);
    const ap = S().appearance;
    const r = T().resolve(ap);
    const groups = {};
    for (const t of T().TOKENS) (groups[t.group] = groups[t.group] || []).push(t);
    const swatches = Object.values(r.colors);
    for (const [g, list] of Object.entries(groups)) {
      const col = h('div', { class: 'color-group panel panel-pad' }, h('h3', null, g));
      for (const t of list) {
        const sw = h('span', { class: 'sw', style: { background: r.colors[t.key] } });
        const hx = h('span', { class: 'hx' }, r.colors[t.key]);
        const rowEl = h('button', { class: `color-row ${ap.colors && ap.colors[t.key] ? 'changed' : ''}` }, sw, h('span', { class: 'lb' }, t.label), hx);
        rowEl.addEventListener('click', () => {
          let raf = 0;
          DR.ui.colorPicker(rowEl, r.colors[t.key], {
            swatches,
            onInput: (v) => {
              sw.style.background = v;
              hx.textContent = v;
              cancelAnimationFrame(raf);
              raf = requestAnimationFrame(() => DR.store.setAppearance((a) => {
                a.colors = { ...(a.colors || {}), [t.key]: v };
              }));
            },
            onDone: () => renderColors(),
          });
        });
        col.append(rowEl);
      }
      box.append(col);
    }
  }

  function renderParams() {
    const box = refs.params;
    clear(box);
    const r = T().resolve(S().appearance);
    const p = r.params;
    const setP = (k, v) => DR.store.setAppearance((ap) => {
      ap.params = { ...(ap.params || {}), [k]: v };
    });
    const sl = (label, k, min, max, step, fmt, scale = 1, onRelease) =>
      h('div', { class: 'field' }, h('label', null, label), DR.ui.slider({ min, max, step, value: p[k] * scale, format: fmt, onInput: onRelease ? null : (v) => setP(k, v / scale), onChange: onRelease ? (v) => setP(k, v / scale) : null }));
    box.append(
      sl('Скругление углов', 'radius', 0, 24, 1, (v) => `${v} px`),
      sl('Толщина линий маршрута', 'lineWidth', 3, 10, 1, (v) => `${v} px`),
      sl('Плотность панелей', 'panelAlpha', 35, 100, 1, (v) => `${v}%`, 100),
      sl('Размытие под панелями', 'blur', 0, 30, 1, (v) => `${v} px`),
      sl('Яркость свечения', 'glow', 0, 100, 1, (v) => `${v}%`, 100),
      sl('Скорость анимаций', 'anim', 25, 200, 5, (v) => `${v}%`, 100),
      sl('Масштаб интерфейса', 'scale', 85, 120, 5, (v) => `${v}%`, 100, true),
      h('div', { class: 'field' }, h('label', null, 'Движение и текстура'),
        h('div', { class: 'row', style: { minHeight: '22px', gap: '18px' } },
          h('label', { class: 'opt' }, DR.ui.toggle(p.animations, (v) => setP('animations', v)), h('span', { class: 't' }, 'Анимации')),
          h('label', { class: 'opt' }, DR.ui.toggle(p.noise, (v) => setP('noise', v)), h('span', { class: 't' }, 'Зерно на фоне')))),
    );
    // фон
    const bgBox = refs.bg;
    clear(bgBox);
    const opts = h('div', { class: 'bg-options' });
    for (const b of T().BG_EFFECTS) {
      opts.append(h('button', { class: `bg-opt ${p.bgEffect === b.id ? 'on' : ''}`, onclick: async () => {
        if (b.id === 'image' && !p.bgImage) {
          const url = await DR.api.invoke('pickBackground').catch((e) => DR.ui.toast('error', e.message));
          if (!url) return;
          DR.store.setAppearance((ap) => {
            ap.params = { ...(ap.params || {}), bgEffect: 'image', bgImage: url };
          });
        } else setP('bgEffect', b.id);
        renderParams();
      } }, icon(b.icon, 20), b.label));
    }
    bgBox.append(opts);
    if (p.bgEffect === 'image') {
      bgBox.append(
        h('div', { class: 'param-grid', style: { marginTop: '14px' } },
          h('div', { class: 'field' }, h('label', null, 'Затемнение картинки'), DR.ui.slider({ min: 0, max: 90, step: 1, value: p.bgDim, format: (v) => `${v}%`, onInput: (v) => setP('bgDim', v) })),
          h('div', { class: 'field' }, h('label', null, 'Изображение'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
            const url = await DR.api.invoke('pickBackground').catch((e) => DR.ui.toast('error', e.message));
            if (url) setP('bgImage', url);
          } }, icon('image', 16), 'Выбрать другое')))),
      );
    }
    // шрифты
    const fontBox = refs.fonts;
    clear(fontBox);
    const fontSel = (k) => {
      const sel = h('select', { class: 'select' }, ...Object.entries(T().FONTS).map(([id, f]) => h('option', { value: id, selected: p[k] === id }, f.label)));
      sel.addEventListener('change', () => setP(k, sel.value));
      return sel;
    };
    fontBox.append(h('div', { class: 'field' }, h('label', null, 'Основной текст'), fontSel('fontUi')), h('div', { class: 'field' }, h('label', null, 'Заголовки и статус'), fontSel('fontDisplay')));
  }

  function renderLook() {
    if (!refs.themes) return;
    renderThemes();
    renderColors();
    renderParams();
    const ap = S().appearance;
    refs.resetBtn.disabled = !(ap.colors && Object.keys(ap.colors).length) && !Object.keys(ap.params || {}).some((k) => !PERSONAL.includes(k));
  }

  function buildLook() {
    refs.themes = h('div', { class: 'theme-grid' });
    refs.colors = h('div', { class: 'color-groups' });
    refs.params = h('div', { class: 'param-grid panel panel-pad' });
    refs.bg = h('div');
    refs.fonts = h('div', { class: 'param-grid panel panel-pad' });
    refs.resetBtn = h('button', { class: 'btn ghost', onclick: () => {
      DR.store.setAppearance((ap) => {
        ap.colors = {};
        const keep = {};
        for (const k of PERSONAL) if (ap.params && k in ap.params) keep[k] = ap.params[k];
        ap.params = keep;
      });
      renderLook();
    } }, icon('rotate-ccw', 16), 'Сбросить правки');
    return h('div', null,
      h('div', { class: 'set-group' }, h('h2', null, 'Тема'), refs.themes,
        h('div', { class: 'studio-actions' },
          h('button', { class: 'btn', onclick: saveCustom }, icon('save', 16), 'Сохранить как свою тему'),
          h('button', { class: 'btn', onclick: () => {
            const code = T().toCode(snapshotTheme(T().findTheme(S().appearance, S().appearance.themeId).name));
            DR.util.copyText(code).then(() => DR.ui.toast('ok', 'Код темы скопирован — отправьте его друзьям'));
          } }, icon('share-2', 16), 'Скопировать код темы'),
          refs.resetBtn)),
      h('div', { class: 'set-group' }, h('h2', null, 'Цвета'), h('p', { class: 'hint', style: { margin: '-4px 0 12px' } }, 'Нажмите на цвет, чтобы изменить его. Изменения видны сразу во всём приложении.'), refs.colors),
      h('div', { class: 'set-group' }, h('h2', null, 'Форма и движение'), refs.params),
      h('div', { class: 'set-group' }, h('h2', null, 'Фон'), refs.bg),
      h('div', { class: 'set-group' }, h('h2', null, 'Шрифты'), refs.fonts),
    );
  }

  /* ---------- подключение ---------- */
  function buildConn() {
    refs.conn = h('div');
    return refs.conn;
  }
  async function renderConn() {
    const box = refs.conn;
    if (!box) return;
    clear(box);
    const s = S().settings;
    if (!s) return;
    const modes = [
      { id: 'system', icon: 'monitor', title: 'Системный прокси', text: 'Браузеры и большинство программ сразу идут через сервер.' },
      { id: 'proxy', icon: 'plug', title: 'Только порт', text: 'Ничего не меняем в системе — настройте прокси в нужной программе сами.' },
      { id: 'tun', icon: 'network', title: 'TUN', text: 'Весь трафик компьютера, включая игры и мессенджеры. Нужны права администратора.', beta: true },
    ];
    const cards = h('div', { class: 'mode-cards' }, ...modes.map((m) => h('button', { class: `mode-card ${s.mode === m.id ? 'on' : ''}`, onclick: () => save({ mode: m.id }).then(renderConn) }, icon(m.icon, 20), h('b', null, m.title, m.beta ? h('span', { class: 'beta' }, 'бета') : null), h('span', null, m.text))));
    box.append(h('div', { class: 'set-group' }, h('h2', null, 'Режим работы'), cards));
    box.append(buildProtection(s), buildZapret(s));
    if ((s.mode === 'tun' || s.killSwitch === 'strict') && S().platform === 'win32') {
      const elevated = await DR.api.invoke('isElevated').catch(() => false);
      if (!elevated) {
        box.append(h('div', { class: 'banner info', style: { marginBottom: '18px' } }, icon('shield', 18), h('div', { class: 'grow' }, h('b', null, 'Права администратора выдаются сами'), h('span', { class: 'dim' }, 'При подключении DeskRoute перезапустится с правами администратора и сразу подключится. Windows спросит разрешение только в первый раз.'))));
      }
    }
    const portInput = (key) => {
      const i = h('input', { class: 'input num', type: 'number', min: 1024, max: 65535, value: s[key] });
      i.addEventListener('change', () => save({ [key]: Number(i.value) }));
      return i;
    };
    const dns = h('input', { class: 'input wide', value: s.dns, spellcheck: 'false' });
    dns.addEventListener('change', () => save({ dns: dns.value.trim() || 'https://1.1.1.1/dns-query' }));
    const lvl = h('select', { class: 'select', style: { width: '170px' } }, ...[['warning', 'Предупреждения'], ['info', 'Подробно'], ['debug', 'Отладка'], ['error', 'Только ошибки'], ['none', 'Выключен']].map(([v, l]) => h('option', { value: v, selected: s.logLevel === v }, l)));
    lvl.addEventListener('change', () => save({ logLevel: lvl.value }));
    box.append(
      h('div', { class: 'set-group' }, h('h2', null, 'Локальные порты'),
        h('div', { class: 'panel' },
          setRow('HTTP-прокси', 'Этот порт прописывается в системный прокси', portInput('httpPort')),
          setRow('SOCKS5-прокси', 'Для программ, которые умеют работать через SOCKS5', portInput('socksPort')),
          setRow('Доступ из локальной сети', 'Телефон или приставка в той же Wi-Fi-сети смогут использовать этот компьютер как прокси', DR.ui.toggle(s.allowLan, (v) => save({ allowLan: v }))))),
      h('div', { class: 'set-group' }, h('h2', null, 'Сеть'),
        h('div', { class: 'panel' },
          setRow('DNS-сервер', 'Используется в режиме TUN и при определении IP по домену. Запросы идут через сервер.', dns),
          setRow('Мультиплексирование (Mux)', 'Несколько соединений в одном. Иногда ускоряет WebSocket и gRPC, с Vision не используется.', DR.ui.toggle(s.mux, (v) => save({ mux: v }))),
          setRow('Подробность журнала ядра', null, lvl))),
      h('div', { class: 'set-group' }, h('h2', null, 'Запуск'),
        h('div', { class: 'panel' },
          setRow('Подключаться при запуске', 'К последнему выбранному серверу', DR.ui.toggle(s.autoConnect, (v) => save({ autoConnect: v }))),
          setRow('Запускать вместе с системой', null, DR.ui.toggle(s.launchAtLogin, (v) => save({ launchAtLogin: v }))),
          setRow('Запускать свёрнутым', 'Окно не появится, приложение будет в трее', DR.ui.toggle(s.startMinimized, (v) => save({ startMinimized: v }))),
          setRow('Сворачивать в трей при закрытии', 'Соединение продолжит работать, когда окно закрыто', DR.ui.toggle(s.closeToTray, (v) => save({ closeToTray: v }))))),
    );
  }

  /* ---------- kill switch ---------- */
  function buildProtection(s) {
    const plat = S().platform;
    const kinds = [
      { id: 'off', icon: 'unplug', title: 'Выключен', text: 'Если VPN отвалится, программы продолжат работать напрямую.' },
      { id: 'soft', icon: 'shield', title: 'Мягкий', text: 'Без прав администратора. При сбое браузеры и программы с системным прокси перестают открывать сайты.' },
      {
        id: 'strict',
        icon: 'shield-check',
        title: 'Строгий',
        text: plat === 'linux' ? 'Весь компьютер: в интернет выпускается только ядро VPN. Правила nftables, при включении система спросит пароль.' : 'Весь компьютер: в интернет выпускается только ядро VPN. Брандмауэр Windows, нужны права администратора.',
      },
    ];
    const cards = h('div', { class: 'mode-cards' }, ...kinds.map((k) => h('button', { class: `mode-card ${s.killSwitch === k.id ? 'on' : ''}`, onclick: () => save({ killSwitch: k.id }).then(renderConn) }, icon(k.icon, 20), h('b', null, k.title), h('span', null, k.text))));
    const notes = [];
    if (s.killSwitch === 'soft' && s.mode !== 'system') notes.push('Мягкий kill switch работает только в режиме «Системный прокси».');
    if (s.killSwitch !== 'off') notes.push('Блокировка снимается, когда вы сами нажимаете «Отключить» или выходите из программы. Если программа упадёт, блокировка останется до следующего запуска — там будет кнопка «Снять блокировку».');
    const ks = S().conn.killSwitch;
    return h('div', { class: 'set-group' }, h('h2', null, 'Kill switch'), cards,
      notes.length ? h('p', { class: 'hint', style: { marginTop: '10px' } }, notes.join(' ')) : null,
      ks && S().conn.status !== 'connected'
        ? h('div', { class: 'banner', style: { marginTop: '12px' } }, icon('lock', 18), h('div', { class: 'grow' }, h('b', null, 'Интернет заблокирован'), h('span', { class: 'dim' }, 'Kill switch держит блокировку, потому что VPN не подключён.')), h('button', { class: 'btn sm', onclick: () => DR.app.releaseKillSwitch() }, 'Снять блокировку'))
        : null);
  }

  /* ---------- zapret ---------- */
  function buildZapret(s) {
    const box = h('div', { class: 'set-group' }, h('h2', null, 'Совместимость с zapret'));
    const z = S().zapret || {};
    const plat = S().platform;
    const mode = DR.ui.segmented([{ value: 'auto', label: 'Авто' }, { value: 'on', label: 'Всегда' }, { value: 'off', label: 'Выключено' }], s.zapretCompat || 'auto', (v) => save({ zapretCompat: v }));
    const status = z.running ? `zapret запущен${z.kind ? ` (${z.kind})` : ''}${z.root ? `: ${z.root}` : ''}` : 'zapret сейчас не запущен';
    const rows = [
      setRow('Режим', 'Discord и YouTube идут мимо VPN напрямую — их обрабатывает zapret. «Авто» включает это, только когда zapret запущен.', mode),
      setRow('Состояние', status, h('button', { class: 'btn sm', onclick: async () => {
        S().zapret = await DR.api.invoke('zapretStatus').catch(() => S().zapret);
        renderConn();
      } }, icon('refresh-cw', 15), 'Проверить')),
    ];
    if (plat === 'win32') {
      const lists = z.lists || {};
      const has = lists.ipsetExclude || lists.listExclude;
      rows.push(
        setRow(
          'Исключить VPN-серверы из обработки zapret',
          has
            ? 'zapret подмешивает пакеты в соединения со «своими» адресами и может ломать подключение к VPN. Кнопка допишет адреса ваших серверов в ipset-exclude.txt и list-exclude.txt. После этого перезапустите zapret.'
            : 'Не нашли списки исключений zapret (lists\\ipset-exclude.txt). Укажите папку zapret-discord-youtube вручную.',
          h('div', { class: 'row' },
            h('button', { class: 'btn sm ghost', onclick: async () => {
              const r = await DR.api.invoke('pickZapretFolder').catch((e) => DR.ui.toast('error', e.message));
              if (r) {
                S().zapret = r;
                renderConn();
              }
            } }, icon('folder-open', 15), 'Папка'),
            h('button', { class: 'btn sm', disabled: !has, onclick: async () => {
              try {
                const r = await DR.api.invoke('zapretAddExclusions');
                DR.ui.toast('ok', r.ips || r.domains ? `Добавлено: ${r.ips} IP и ${r.domains} доменов. Перезапустите zapret.` : 'Все серверы уже в исключениях');
              } catch (e) {
                DR.ui.toast('error', e.message);
              }
            } }, icon('plus', 15), 'Добавить')),
        ),
      );
    } else if (plat === 'linux') {
      const capsRow = setRow('Права ядра', 'С ними соединения с VPN-сервером помечаются так, что zapret (nfqws) их не трогает. Они же нужны для TUN и строгого kill switch.', h('span', { class: 'faint' }, 'проверяем…'));
      rows.push(capsRow);
      DR.api.invoke('coreCaps').then((c) => {
        const ctl = capsRow.querySelector('.ctl');
        clear(ctl);
        if (c.has) ctl.append(h('span', { class: 'dim' }, 'выданы'));
        else ctl.append(h('button', { class: 'btn sm', onclick: () => DR.api.invoke('grantCoreCaps').then(() => {
          DR.ui.toast('ok', 'Права выданы');
          renderConn();
        }).catch((e) => DR.ui.toast('error', e.message)) }, icon('shield-check', 15), 'Выдать'));
      }).catch(() => {});
    }
    box.append(h('div', { class: 'panel' }, ...rows));
    return box;
  }

  /* ---------- подписки и проверка ---------- */
  function buildSubs() {
    refs.subs = h('div');
    return refs.subs;
  }
  function renderSubs() {
    const box = refs.subs;
    if (!box) return;
    clear(box);
    const s = S().settings;
    if (!s) return;
    const ua = h('input', { class: 'input wide', value: s.sub.userAgent, spellcheck: 'false' });
    ua.addEventListener('change', () => save({ sub: { userAgent: ua.value.trim() || 'DeskRoute/1.0' } }));
    const interval = h('select', { class: 'select', style: { width: '170px' } }, ...[1, 3, 6, 12, 24, 48].map((v) => h('option', { value: v, selected: s.sub.intervalHours === v }, `каждые ${v} ч`)));
    interval.addEventListener('change', () => save({ sub: { intervalHours: Number(interval.value) } }));
    const method = DR.ui.segmented([{ value: 'url', label: 'Реальная задержка' }, { value: 'tcp', label: 'TCP-пинг' }], s.latency.method, (v) => save({ latency: { method: v } }));
    const url = h('input', { class: 'input wide', value: s.latency.url, spellcheck: 'false' });
    url.addEventListener('change', () => save({ latency: { url: url.value.trim() || 'http://www.gstatic.com/generate_204' } }));
    const to = h('select', { class: 'select', style: { width: '120px' } }, ...[3000, 5000, 6000, 8000, 12000].map((v) => h('option', { value: v, selected: s.latency.timeout === v }, `${v / 1000} с`)));
    to.addEventListener('change', () => save({ latency: { timeout: Number(to.value) } }));
    box.append(
      h('div', { class: 'set-group' }, h('h2', null, 'Подписки'),
        h('div', { class: 'panel' },
          setRow('Обновлять при запуске', null, DR.ui.toggle(s.sub.updateOnStart, (v) => save({ sub: { updateOnStart: v } }))),
          setRow('Автообновление', 'Если провайдер указал свой интервал, используется он', h('div', { class: 'row' }, DR.ui.toggle(s.sub.autoUpdate, (v) => save({ sub: { autoUpdate: v } })), interval)),
          setRow('User-Agent', 'Некоторые провайдеры отдают разные форматы для разных клиентов. Если подписка не загружается, попробуйте Happ/1.0 или v2rayN/7.0', ua))),
      h('div', { class: 'set-group' }, h('h2', null, 'Проверка задержки'),
        h('div', { class: 'panel' },
          setRow('Способ', 'Реальная задержка — запрос через сам сервер, как при работе. TCP-пинг быстрее, но показывает только доступность порта.', method),
          setRow('Адрес для проверки', null, url),
          setRow('Ждать ответа не дольше', null, to))),
    );
  }

  /* ---------- ядро ---------- */
  function buildCore() {
    refs.core = h('div');
    return refs.core;
  }
  function renderCore() {
    const box = refs.core;
    if (!box) return;
    clear(box);
    const c = S().core;
    const pc = S().progress.core;
    const pg = S().progress.geo;
    const g = c.geo || {};
    const coreBtn = h('button', { class: 'btn primary', disabled: pc != null, onclick: () => DR.app.installCore() }, icon('download', 16), pc != null ? `Скачивание ${Math.round(pc * 100)}%` : c.installed ? 'Переустановить последнюю версию' : 'Скачать ядро');
    const checkBtn = h('button', { class: 'btn', onclick: async () => {
      checkBtn.disabled = true;
      const v = await DR.api.invoke('checkCoreUpdate').catch(() => null);
      checkBtn.disabled = false;
      if (!v) DR.ui.toast('warn', 'Не удалось узнать последнюю версию — GitHub недоступен?');
      else if (v === c.version) DR.ui.toast('ok', `У вас последняя версия Xray ${v}`);
      else DR.ui.toast('info', `Доступна версия ${v}. Нажмите «Переустановить», чтобы обновиться.`);
    } }, icon('refresh-cw', 16), 'Проверить обновления');
    const status = c.installed ? `Xray ${c.version}` : 'Не установлено';
    const geoSel = h('select', { class: 'select', style: { width: '240px' } },
      h('option', { value: 'standard', selected: g.source !== 'russia' }, 'Стандартные (Loyalsoldier)'),
      h('option', { value: 'russia', selected: g.source === 'russia' }, 'Для России (runetfreedom)'));
    const geoBtn = h('button', { class: 'btn', disabled: pg != null, onclick: () => DR.app.installGeo(geoSel.value) }, icon('download', 16), pg != null ? `${Math.round(pg * 100)}%` : 'Скачать');
    const yes = (b) => (b ? 'есть' : 'нет');
    box.append(
      h('div', { class: 'set-group' }, h('h2', null, 'Ядро Xray-core'),
        h('div', { class: 'panel' },
          setRow('Установленная версия', c.bin ? c.bin : 'Ядро скачивается с официальной страницы XTLS/Xray-core на GitHub', h('b', { class: 'num' }, status)),
          h('div', { class: 'set-row' }, h('div', { class: 'row', style: { flexWrap: 'wrap' } }, coreBtn, checkBtn, h('button', { class: 'btn ghost', onclick: () => DR.api.invoke('openFolder', 'core') }, icon('folder-open', 16), 'Открыть папку'))),
          pc != null ? h('div', { class: 'set-row' }, h('div', { class: 'progress', style: { flex: 1 } }, h('i', { style: { width: `${Math.round(pc * 100)}%` } }))) : null)),
      h('div', { class: 'set-group' }, h('h2', null, 'Гео-базы'),
        h('div', { class: 'panel' },
          setRow('Списки сайтов и адресов', `Российские сайты: ${yes(g.ru)}. Заблокированные в РФ: ${yes(g.ruBlocked)}. Реклама: ${yes(g.ads)}.`, h('span', { class: 'faint num' }, g.present ? `${(g.siteCodes || []).length} категорий` : 'не найдены')),
          setRow('Источник', 'Для режима «Только заблокированное» нужны базы для России', h('div', { class: 'row' }, geoSel, geoBtn)),
          pg != null ? h('div', { class: 'set-row' }, h('div', { class: 'progress', style: { flex: 1 } }, h('i', { style: { width: `${Math.round(pg * 100)}%` } }))) : null)),
    );
  }

  /* ---------- о программе ---------- */
  function buildAbout() {
    const logo = DR.app.logoSvg(84);
    logo.classList.add('logo');
    return h('div', null,
      h('div', { class: 'panel about' }, logo, h('div', null, h('h2', null, 'DeskRoute'), h('p', { class: 'dim num' }, `Версия ${S().version || '1.0.0'}`), h('p', { class: 'dim', style: { marginTop: '6px', maxWidth: '520px' } }, 'Десктопный клиент для подписок Xray: VLESS, VMess, Trojan, Shadowsocks, Hysteria2. Работает через ядро Xray-core.'))),
      h('div', { class: 'set-group', style: { marginTop: '18px' } }, h('h2', null, 'Данные'),
        h('div', { class: 'panel' },
          setRow('Папка с настройками', 'Подписки, серверы, тема и журнал конфигурации', h('button', { class: 'btn', onclick: () => DR.api.invoke('openFolder', 'data') }, icon('folder-open', 16), 'Открыть')),
          setRow('Горячие клавиши', 'Ctrl+K — быстрый выбор сервера, Ctrl+V — добавить ссылку из буфера, Ctrl+1…5 — разделы', null))),
      h('div', { class: 'set-group' }, h('h2', null, 'Компоненты'),
        h('div', { class: 'panel panel-pad license-list' },
          h('div', null, 'Xray-core — Project X, лицензия MPL-2.0'),
          h('div', null, 'Иконки Lucide — лицензия ISC'),
          h('div', null, 'Шрифты Onest, Jost, Inter, JetBrains Mono — SIL Open Font License 1.1'),
          h('div', null, 'Гео-базы — Loyalsoldier/v2ray-rules-dat (GPL-3.0), runetfreedom/russia-v2ray-rules-dat'))),
    );
  }

  /* ---------- каркас ---------- */
  function show(id) {
    current = id;
    for (const b of nav.children) b.classList.toggle('on', b.dataset.id === id);
    for (const [k, sec] of Object.entries(sections)) sec.classList.toggle('on', k === id);
    if (id === 'conn') renderConn();
    if (id === 'subs') renderSubs();
    if (id === 'core') renderCore();
    if (id === 'look') renderLook();
  }

  function mount(el) {
    root = el;
    nav = h('nav', { class: 'subnav' }, ...SECTIONS.map((s) => h('button', { dataset: { id: s.id }, onclick: () => show(s.id) }, icon(s.icon, 17), s.label)));
    const content = h('div');
    const builders = { look: buildLook, conn: buildConn, subs: buildSubs, core: buildCore, about: buildAbout };
    for (const s of SECTIONS) {
      sections[s.id] = h('section', { class: 'set-section' }, builders[s.id]());
      content.append(sections[s.id]);
    }
    root.append(h('div', { class: 'page-head' }, h('h1', null, 'Настройки')), h('div', { class: 'settings' }, nav, content));
    DR.store.on('conn', () => current === 'conn' && renderConn());
    DR.store.on('zapret', () => current === 'conn' && renderConn());
    DR.store.on('settings', () => {
      if (current === 'conn') renderConn();
      if (current === 'subs') renderSubs();
    });
    DR.store.on('core', () => current === 'core' && renderCore());
    DR.store.on('progress', () => current === 'core' && renderCore());
    show('look');
  }

  DR.pages = DR.pages || {};
  DR.pages.settings = { mount, show, renderLook };
})();
