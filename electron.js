const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Must be set before requiring server modules, so they use the correct writable path
// (inside app.asar __dirname is not writable)
process.env.DATA_DIR = app.getPath('userData');

const { getPrinters } = require('pdf-to-printer');
const { setSelectedPrinter, getSelectedPrinter } = require('./server/printer');
const { getRecentPrints, clearCheckins } = require('./server/db');
const { setAutoPrint, reprintPosition, previewPosition, testPrintBadge } = require('./server/index');
const { getConfig, saveConfig } = require('./server/config');
const { checkStatus, getApiLog, getOrganizers, getEvents, clearBadgeLayoutCache, warmBadgeCache, getBadgeLayoutName, refreshBadgeCache } = require('./server/pretixApi');

Menu.setApplicationMenu(null);

// ── Single instance lock ──────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Error forwarding to renderer ──────────────────────────────
let mainWindow;

function sendError(msg) {
  try { mainWindow?.webContents.send('show-error', msg); } catch {}
}

const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  _origConsoleError(...args);
  const msg = args.map(a => (a instanceof Error ? a.stack || a.message : String(a))).join(' ');
  sendError(msg);
};

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  _origConsoleError('Unhandled rejection:', msg);
  sendError(msg);
});

// Restore selected printer from persisted config
const _initCfg = getConfig();
if (_initCfg.SELECTED_PRINTER) setSelectedPrinter(_initCfg.SELECTED_PRINTER);

// Pre-load badge layout + background PDF into memory cache
warmBadgeCache();

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
ipcMain.handle('test-print',        async (_, override) => await testPrintBadge(override));
ipcMain.handle('get-config',        () => getConfig());
ipcMain.handle('save-config',       (_, cfg) => {
  const prev = getConfig();
  const hadEvent = !!(prev.PRETIX_ORGANIZER || prev.PRETIX_EVENT);
  const eventChanged = hadEvent
    && ((cfg.PRETIX_ORGANIZER !== undefined && cfg.PRETIX_ORGANIZER !== prev.PRETIX_ORGANIZER)
     || (cfg.PRETIX_EVENT     !== undefined && cfg.PRETIX_EVENT     !== prev.PRETIX_EVENT));
  clearBadgeLayoutCache();
  saveConfig({ ...prev, ...cfg });
  // Switching organizer/event invalidates the previous check-ins, so drop them.
  // The renderer asks the user for confirmation before triggering this save.
  if (eventChanged) clearCheckins();
});
ipcMain.handle('check-status',      async () => await checkStatus());
ipcMain.handle('get-api-log',       () => getApiLog());
ipcMain.handle('get-organizers',    (_, token) => getOrganizers(token));
ipcMain.handle('get-events',        (_, token, org) => getEvents(token, org));
ipcMain.handle('reprint-badge',         (_, logId, positionId) => reprintPosition(logId, positionId));
ipcMain.handle('get-version',           () => app.getVersion());
ipcMain.handle('clear-checkins',        () => clearCheckins());
ipcMain.handle('get-badge-layout-name', () => getBadgeLayoutName());
ipcMain.handle('refresh-badge-cache',   (_, override) => refreshBadgeCache(override));
ipcMain.handle('preview-badge',     async (_, logId, positionId) => {
  const pdfBuffer = await previewPosition(positionId);
  const tmpPath = path.join(os.tmpdir(), `badge_preview_${logId}.pdf`);
  fs.writeFileSync(tmpPath, pdfBuffer);
  await shell.openPath(tmpPath);
});
