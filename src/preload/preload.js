'use strict';
/**
 * Мост между интерфейсом и главным процессом. Наружу — только invoke, подписка на события и масштаб.
 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('deskroute', {
  platform: process.platform,
  invoke: (method, ...args) => ipcRenderer.invoke('dr:invoke', method, ...args),
  on: (cb) => {
    const handler = (_e, type, payload) => cb(type, payload);
    ipcRenderer.on('dr:event', handler);
    return () => ipcRenderer.removeListener('dr:event', handler);
  },
  setZoom: (f) => {
    const v = Number(f);
    if (v >= 0.8 && v <= 1.3) webFrame.setZoomFactor(v);
  },
});
