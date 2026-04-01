const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getPrinters } = require('pdf-to-printer');
const { setSelectedPrinter, getSelectedPrinter, testPrint } = require('./server/printer');
const { getRecentPrints } = require('./server/db');
const { setAutoPrint } = require('./server/index');

require('./server/index'); // start webhook server

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWindow.loadFile('renderer/index.html');
});

ipcMain.handle('get-printers', async () => await getPrinters());
ipcMain.handle('set-printer', (_, name) => setSelectedPrinter(name));
ipcMain.handle('get-selected-printer', () => getSelectedPrinter());
ipcMain.handle('set-auto-print', (_, value) => setAutoPrint(value));
ipcMain.handle('get-log', () => getRecentPrints(50));
ipcMain.handle('test-print', async () => await testPrint());
