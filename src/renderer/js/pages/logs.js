/* Журнал ядра и приложения */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon, clear, fmtTime } = DR.util;
  const S = () => DR.store.state;
  let box;
  let filter = 'all';
  let follow = true;

  function visible(e) {
    if (filter === 'all') return true;
    if (filter === 'problems') return e.level === 'error' || e.level === 'warning';
    if (filter === 'app') return e.level === 'app';
    return true;
  }

  function lineEl(e) {
    return h('div', { class: `log-line ${e.level}` }, h('span', { class: 't' }, fmtTime(e.t)), h('span', { class: 'x' }, e.text.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d(\.\d+)? /, '')));
  }

  function renderAll() {
    clear(box);
    const list = S().logs.filter(visible).slice(-800);
    if (!list.length) box.append(h('div', { class: 'faint' }, 'Здесь появятся сообщения ядра и приложения.'));
    for (const e of list) box.append(lineEl(e));
    box.scrollTop = box.scrollHeight;
  }

  function append(entries) {
    if (!box) return;
    if (box.firstChild && box.firstChild.classList.contains('faint')) clear(box);
    for (const e of entries) if (visible(e)) box.append(lineEl(e));
    while (box.childElementCount > 900) box.firstChild.remove();
    if (follow) box.scrollTop = box.scrollHeight;
  }

  function mount(root) {
    box = h('div', { class: 'console panel selectable' });
    box.addEventListener('scroll', () => {
      follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    });
    const seg = DR.ui.segmented(
      [
        { value: 'all', label: 'Все' },
        { value: 'problems', label: 'Ошибки и предупреждения' },
        { value: 'app', label: 'Действия' },
      ],
      'all',
      (v) => {
        filter = v;
        renderAll();
      },
    );
    root.append(
      h('div', { class: 'page-head' },
        h('h1', null, 'Журнал'),
        h('div', { class: 'spacer' }),
        seg,
        h('button', { class: 'btn', onclick: () => DR.util.copyText(S().logs.map((e) => `${fmtTime(e.t)} ${e.text}`).join('\n')).then(() => DR.ui.toast('ok', 'Журнал скопирован')) }, icon('copy', 16), 'Копировать'),
        h('button', { class: 'btn ghost', onclick: () => DR.api.invoke('clearLogs').then(() => {
          S().logs = [];
          renderAll();
        }) }, icon('trash', 16), 'Очистить')),
      box,
    );
    DR.store.on('logs', append);
    renderAll();
  }

  DR.pages = DR.pages || {};
  DR.pages.logs = { mount, renderAll };
})();
