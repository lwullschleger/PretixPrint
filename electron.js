const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { getPrinters } = require('pdf-to-printer');
const { setSelectedPrinter, getSelectedPrinter, testPrint } = require('./server/printer');
const { getRecentPrints } = require('./server/db');
const { setAutoPrint } = require('./server/index');
const { getConfig, saveConfig } = require('./server/config');
const { checkStatus, getApiLog } = require('./server/pretixApi');

Menu.setApplicationMenu(null);

// Restore selected printer from persisted config
const _initCfg = getConfig();
if (_initCfg.SELECTED_PRINTER) setSelectedPrinter(_initCfg.SELECTED_PRINTER);

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWindow.loadFile('renderer/index.html');
});

ipcMain.handle('get-printers',      async () => await getPrinters());
ipcMain.handle('set-printer',       (_, name) => { setSelectedPrinter(name); saveConfig({ ...getConfig(), SELECTED_PRINTER: name }); });
ipcMain.handle('get-selected-printer', () => getSelectedPrinter());
ipcMain.handle('set-auto-print',    (_, value) => setAutoPrint(value));
ipcMain.handle('get-log',           () => getRecentPrints(50));
ipcMain.handle('test-print',        async () => await testPrint());
ipcMain.handle('get-config',        () => getConfig());
ipcMain.handle('save-config',       (_, cfg) => saveConfig({ ...getConfig(), ...cfg }));
ipcMain.handle('check-status',      async () => await checkStatus());
ipcMain.handle('get-api-log',       () => getApiLog());
