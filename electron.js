const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getPrinters } = require('pdf-to-printer');
const { setSelectedPrinter, getSelectedPrinter, testPrint } = require('./server/printer');
const { getRecentPrints } = require('./server/db');
const { setAutoPrint, reprintPosition, previewPosition } = require('./server/index');
const { getConfig, saveConfig } = require('./server/config');
const { checkStatus, getApiLog, getOrganizers, getEvents, clearBadgeLayoutCache, warmBadgeCache, getBadgeLayoutName, refreshBadgeCache } = require('./server/pretixApi');

Menu.setApplicationMenu(null);

// Restore selected printer from persisted config
const _initCfg = getConfig();
if (_initCfg.SELECTED_PRINTER) setSelectedPrinter(_initCfg.SELECTED_PRINTER);

// Pre-load badge layout + background PDF into memory cache
warmBadgeCache();

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
ipcMain.handle('save-config',       (_, cfg) => { clearBadgeLayoutCache(); saveConfig({ ...getConfig(), ...cfg }); });
ipcMain.handle('check-status',      async () => await checkStatus());
ipcMain.handle('get-api-log',       () => getApiLog());
ipcMain.handle('get-organizers',    (_, token) => getOrganizers(token));
ipcMain.handle('get-events',        (_, token, org) => getEvents(token, org));
ipcMain.handle('reprint-badge',         (_, logId, positionId) => reprintPosition(logId, positionId));
ipcMain.handle('get-badge-layout-name', () => getBadgeLayoutName());
ipcMain.handle('refresh-badge-cache',   () => refreshBadgeCache());
ipcMain.handle('preview-badge',     async (_, logId, positionId) => {
  const pdfBuffer = await previewPosition(positionId);
  const tmpPath = path.join(os.tmpdir(), `badge_preview_${logId}.pdf`);
  fs.writeFileSync(tmpPath, pdfBuffer);
  await shell.openPath(tmpPath);
});
