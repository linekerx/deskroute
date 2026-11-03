/* Компоненты интерфейса: уведомления, окна, меню, палитра, переключатели */
(function () {
  const DR = (window.DR = window.DR || {});
  const { h, icon } = DR.util;
  const layer = () => document.getElementById('layer');

  /* ---------- уведомления ---------- */
  let toastBox = null;
  function toast(type, text, ms) {
    if (!toastBox) {
      toastBox = h('div', { class: 'toasts' });
      document.body.append(toastBox);
    }
    const ic = { ok: 'circle-check', error: 'circle-alert', warn: 'triangle-alert', info: 'info' }[type] || 'info';
    const el = h('div', { class: `toast ${type}`, role: 'status' }, icon(ic, 18), h('div', { class: 'selectable' }, text));
    toastBox.append(el);
    const close = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    };
    el.addEventListener('click', close);
    setTimeout(close, ms || (type === 'error' ? 7000 : 3800));
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
  }

  /* ---------- модальные окна ---------- */
  const openModals = [];
  function modal({ title, body, actions = [], width, onClose, className }) {
    const close = () => {
      if (!wrap.isConnected) return;
      wrap.remove();
      openModals.splice(openModals.indexOf(api), 1);
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === api) {
        e.stopPropagation();
        close();
      }
    };
    const foot = actions.length ? h('div', { class: 'modal-foot' }, ...actions) : null;
    const box = h(
      'div',
      { class: `modal ${className || ''}`, role: 'dialog', 'aria-modal': 'true', style: width ? { width: `min(${width}px, calc(100vw - 48px))` } : null },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn ghost icon sm', 'aria-label': 'Закрыть', onclick: close }, icon('x', 18))),
      h('div', { class: 'modal-body' }, body),
      foot,
    );
    const wrap = h('div', { class: 'backdrop' }, box);
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) close();
    });
    layer().append(wrap);
    document.addEventListener('keydown', onKey, true);
    const api = { close, el: box, body: box.querySelector('.modal-body'), foot };
    openModals.push(api);
    setTimeout(() => {
      const f = box.querySelector('[autofocus], input, textarea');
      if (f) f.focus();
    }, 30);
    return api;
  }

  function confirmDialog({ title, text, ok = 'Удалить', danger = true }) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title,
        body: h('p', { class: 'dim' }, text),
        width: 440,
        onClose: () => !done && resolve(false),
        actions: [
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'),
          h('button', {
            class: `btn ${danger ? 'danger solid' : 'primary'}`,
            onclick: () => {
              done = true;
              m.close();
              resolve(true);
            },
          }, ok),
        ],
      });
    });
  }

  function promptDialog({ title, label, value = '', placeholder = '', ok = 'Сохранить' }) {
    return new Promise((resolve) => {
      let done = false;
      const input = h('input', { class: 'input', value, placeholder, autofocus: true });
      const submit = () => {
        done = true;
        m.close();
        resolve(input.value.trim());
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      const m = modal({
        title,
        width: 460,
        body: h('div', { class: 'field' }, label ? h('label', null, label) : null, input),
        onClose: () => !done && resolve(null),
        actions: [h('div', { class: 'spacer' }), h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Отмена'), h('button', { class: 'btn primary', onclick: submit }, ok)],
      });
      setTimeout(() => input.select(), 40);
    });
  }

  /* ---------- всплывающие окна и меню ---------- */
  let currentPop = null;
  function closePopover() {
    if (currentPop) {
      currentPop.remove();
      if (currentPop._onClose) currentPop._onClose();
      currentPop = null;
    }
  }
  function popover(anchor, content, { align = 'end', onClose, className = '' } = {}) {
    closePopover();
    const el = h('div', { class: `popover ${className}` }, content);
    el._onClose = onClose;
    document.body.append(el);
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let left = align === 'start' ? r.left : r.right - pw;
    let top = r.bottom + 6;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    left = Math.max(8, Math.min(left, innerWidth - pw - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    currentPop = el;
    setTimeout(() => {
      const away = (e) => {
        if (!el.contains(e.target)) {
          document.removeEventListener('mousedown', away, true);
          if (currentPop === el) closePopover();
        }
      };
      document.addEventListener('mousedown', away, true);
    }, 0);
    return el;
  }
  function menu(anchor, items, opts) {
    const list = h('div', { role: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) {
        list.append(h('div', { class: 'menu-sep' }));
        continue;
      }
      list.append(
        h('button', {
          class: `menu-item ${it.danger ? 'danger' : ''}`,
          role: 'menuitem',
          disabled: it.disabled,
          onclick: () => {
            closePopover();
            it.onClick && it.onClick();
          },
        }, it.icon ? icon(it.icon, 16) : null, h('span', null, it.label)),
      );
    }
    return popover(anchor, list, opts);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentPop) closePopover();
  });
  window.addEventListener('blur', closePopover);
  window.addEventListener('resize', closePopover);

  /* ---------- подсказки ---------- */
  let tipEl = null;
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return;
    if (tipEl) tipEl.remove();
    tipEl = h('div', { class: 'tip' }, t.dataset.tip);
    document.body.append(tipEl);
    const r = t.getBoundingClientRect();
    const side = t.dataset.tipSide || 'bottom';
    let x;
    let y;
    if (side === 'right') {
      x = r.right + 10;
      y = r.top + r.height / 2 - tipEl.offsetHeight / 2;
    } else {
      x = r.left + r.width / 2 - tipEl.offsetWidth / 2;
      y = r.bottom + 8;
      if (y + tipEl.offsetHeight > innerHeight - 6) y = r.top - tipEl.offsetHeight - 8;
    }
    tipEl.style.left = `${Math.max(6, Math.min(x, innerWidth - tipEl.offsetWidth - 6))}px`;
    tipEl.style.top = `${y}px`;
    const leave = () => {
      if (tipEl) tipEl.remove();
      tipEl = null;
      t.removeEventListener('mouseleave', leave);
    };
    t.addEventListener('mouseleave', leave);
    t.addEventListener('mousedown', leave, { once: true });
  });

  /* ---------- элементы управления ---------- */
  function toggle(value, onChange, label) {
    const b = h('button', { class: `switch ${value ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!value), 'aria-label': label || '' });
    b.addEventListener('click', () => {
      const v = !b.classList.contains('on');
      b.classList.toggle('on', v);
      b.setAttribute('aria-checked', String(v));
      onChange(v);
    });
    b.set = (v) => {
      b.classList.toggle('on', !!v);
      b.setAttribute('aria-checked', String(!!v));
    };
    return b;
  }

  function segmented(options, value, onChange, cls) {
    const el = h('div', { class: `seg ${cls || ''}`, role: 'radiogroup' });
    const set = (v) => {
      for (const b of el.children) b.classList.toggle('on', b.dataset.v === String(v));
    };
    for (const o of options) {
      el.append(
        h('button', {
          dataset: { v: String(o.value) },
          role: 'radio',
          'data-tip': o.tip || null,
          onclick: () => {
            set(o.value);
            onChange(o.value);
          },
        }, o.label),
      );
    }
    set(value);
    el.set = set;
    return el;
  }

  function slider({ min, max, step = 1, value, format = (v) => v, onInput, onChange }) {
    const input = h('input', { type: 'range', min, max, step, value });
    const val = h('span', { class: 'val num' }, format(value));
    const upd = () => {
      const p = ((input.value - min) / (max - min)) * 100;
      input.style.setProperty('--p', `${p}%`);
      val.textContent = format(Number(input.value));
    };
    input.addEventListener('input', () => {
      upd();
      if (onInput) onInput(Number(input.value));
    });
    if (onChange) input.addEventListener('change', () => onChange(Number(input.value)));
    upd();
    const el = h('div', { class: 'range' }, input, val);
    el.set = (v) => {
      input.value = v;
      upd();
    };
    return el;
  }

  /** Поле с метками: значения в виде чипов, Enter/запятая — добавить, подсказки по началу ввода */
  function chipInput({ values = [], placeholder = '', suggest, onChange, color }) {
    let list = [...values];
    const input = h('input', { placeholder, spellcheck: 'false' });
    const box = h('div', { class: 'chips', style: color ? { '--chip': color } : null });
    const render = () => {
      for (const c of [...box.querySelectorAll('.chip')]) c.remove();
      list.forEach((v, i) => {
        box.insertBefore(
          h('span', { class: 'chip', title: v }, h('span', null, v), h('button', { 'aria-label': 'Удалить', onclick: (e) => {
            e.stopPropagation();
            list.splice(i, 1);
            render();
            onChange(list);
          } }, icon('x', 13))),
          input,
        );
      });
    };
    const add = (raw) => {
      const parts = String(raw).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      let changed = false;
      for (const p of parts) {
        if (!list.includes(p)) {
          list.push(p);
          changed = true;
        }
      }
      input.value = '';
      closePopover();
      if (changed) {
        render();
        onChange(list);
      }
    };
    const showSuggest = () => {
      const q = input.value.trim().toLowerCase();
      if (!suggest || q.length < 2) return closePopover();
      const items = suggest(q).slice(0, 40);
      if (!items.length) return closePopover();
      const content = h('div', { class: 'suggest' }, ...items.map((s) => h('button', { class: 'menu-item', onmousedown: (e) => {
        e.preventDefault();
        add(s);
        input.focus();
      } }, s)));
      popover(box, content, { align: 'start' });
    };
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
        e.preventDefault();
        add(input.value);
      } else if (e.key === 'Backspace' && !input.value && list.length) {
        list.pop();
        render();
        onChange(list);
      }
    });
    input.addEventListener('input', DR.util.debounce(showSuggest, 120));
    input.addEventListener('paste', (e) => {
      const t = (e.clipboardData || window.clipboardData).getData('text');
      if (/[\s,;]/.test(t.trim())) {
        e.preventDefault();
        add(t);
      }
    });
    input.addEventListener('blur', () => setTimeout(() => input.value.trim() && add(input.value), 150));
    box.addEventListener('click', () => input.focus());
    box.append(input);
    render();
    box.set = (v) => {
      list = [...v];
      render();
    };
    return box;
  }

  /* ---------- палитра цвета ---------- */
  function colorPicker(anchor, value, { onInput, onDone, swatches = [] } = {}) {
    const u = DR.util;
    let hsv = u.rgbToHsv(u.hexToRgb(value) || { r: 255, g: 122, b: 26 });
    const sv = h('div', { class: 'sv' }, h('i', { class: 'knob' }));
    const hue = h('div', { class: 'hue' }, h('i', { class: 'knob' }));
    const hex = h('input', { class: 'input', value: value, maxlength: 7, spellcheck: 'false' });
    const prev = h('span', { class: 'preview' });
    const sw = h('div', { class: 'swatches' }, ...[...new Set(swatches)].slice(0, 16).map((c) => h('button', { style: { background: c }, 'data-tip': c, onclick: () => setHex(c, true) })));
    const box = h('div', { class: 'picker' }, sv, hue, h('div', { class: 'row' }, prev, hex), swatches.length ? sw : null);
    let current = u.normalizeHex(value) || '#ff7a1a';
    const paint = () => {
      const base = u.rgbToHex(u.hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
      sv.style.backgroundColor = base;
      sv.firstChild.style.left = `${hsv.s * 100}%`;
      sv.firstChild.style.top = `${(1 - hsv.v) * 100}%`;
      sv.firstChild.style.background = current;
      hue.firstChild.style.left = `${(hsv.h / 360) * 100}%`;
      hue.firstChild.style.background = base;
      prev.style.background = current;
    };
    const emit = () => {
      current = u.rgbToHex(u.hsvToRgb(hsv));
      hex.value = current;
      paint();
      onInput && onInput(current);
    };
    function setHex(v, fire) {
      const n = u.normalizeHex(v);
      if (!n) return;
      current = n;
      hsv = u.rgbToHsv(u.hexToRgb(n));
      hex.value = n;
      paint();
      if (fire && onInput) onInput(n);
    }
    const drag = (el, fn) => {
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = el.getBoundingClientRect();
          fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
          emit();
        };
        move(e);
        el.onpointermove = move;
        el.onpointerup = () => {
          el.onpointermove = null;
        };
      });
    };
    drag(sv, (x, y) => {
      hsv.s = x;
      hsv.v = 1 - y;
    });
    drag(hue, (x) => {
      hsv.h = Math.min(359.9, x * 360);
    });
    hex.addEventListener('input', () => {
      const v = hex.value.startsWith('#') ? hex.value : `#${hex.value}`;
      if (/^#[0-9a-f]{6}$/i.test(v)) setHex(v, true);
    });
    paint();
    popover(anchor, box, { align: 'start', onClose: () => onDone && onDone(current) });
  }

  DR.ui = { toast, modal, confirmDialog, promptDialog, popover, menu, closePopover, toggle, segmented, slider, chipInput, colorPicker };
})();
