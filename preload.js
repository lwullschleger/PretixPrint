const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPrinters:        () => ipcRenderer.invoke('get-printers'),
  setPrinter:         (name) => ipcRenderer.invoke('set-printer', name),
  getSelectedPrinter: () => ipcRenderer.invoke('get-selected-printer'),
  setAutoPrint:       (v) => ipcRenderer.invoke('set-auto-print', v),
  getLog:             () => ipcRenderer.invoke('get-log'),
  testPrint:          () => ipcRenderer.invoke('test-print'),
  getConfig:          () => ipcRenderer.invoke('get-config'),
  saveConfig:         (cfg) => ipcRenderer.invoke('save-config', cfg),
  checkStatus:        () => ipcRenderer.invoke('check-status'),
  getApiLog:          () => ipcRenderer.invoke('get-api-log'),
  getOrganizers:      (token) => ipcRenderer.invoke('get-organizers', token),
  getEvents:          (token, org) => ipcRenderer.invoke('get-events', token, org)
});
