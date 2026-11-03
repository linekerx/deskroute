/* Связь с главным процессом (или с демо-режимом, если окно открыто в браузере) */
(function () {
  const DR = (window.DR = window.DR || {});
  const bridge = window.deskroute || (DR.mock && DR.mock.bridge) || null;

  DR.api = {
    available: !!bridge,
    demo: !window.deskroute,
    platform: (bridge && bridge.platform) || 'win32',
    async invoke(method, ...args) {
      if (!bridge) throw new Error('Нет связи с приложением');
      const r = await bridge.invoke(method, ...args);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Неизвестная ошибка');
      return r.value;
    },
    on(cb) {
      return bridge ? bridge.on(cb) : () => {};
    },
    setZoom(f) {
      const v = Math.min(1.3, Math.max(0.8, Number(f) || 1));
      if (bridge && bridge.setZoom) bridge.setZoom(v);
      else document.documentElement.style.zoom = String(v);
    },
  };
})();
