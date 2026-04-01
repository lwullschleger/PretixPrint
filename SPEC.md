# Pretix Print Service — Technical Specification
**Version 1.3 | April 2026**

---

## 1. Overview

A Windows desktop application built with **Electron + Node.js** that:

- Listens for check-in webhook events from **pretix**
- Downloads the pre-generated ticket PDF from the **pretix API**
- Automatically prints it to a locally connected **Brother QL** label printer
- Maintains a **JSON log** of all printed tickets, surviving restarts
- Provides a simple **GUI** with two tabs:
  - **Dashboard**: seleziona stampante, toggle auto-print, log stampe
  - **Configurazione**: form per impostare API token, organizer, evento, secret e porta — salvati in `data/config.json` e ricaricati automaticamente ad ogni avvio
- Mostra una **barra di stato** (in basso) con l'esito della connessione all'API Pretix, la validità dell'organizer e dell'evento configurati

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Electron App (Windows)             │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  Renderer    │    │     Main Process         │   │
│  │  (HTML/CSS)  │◄──►│     (Node.js)            │   │
│  │              │    │                          │   │
│  │ - Dashboard  │    │ - Express webhook server │   │
│  │   (printer,  │    │ - Pretix API client      │   │
│  │    toggle,   │    │ - PDF downloader         │   │
│  │    log)      │    │ - Printer driver         │   │
│  │ - Config tab │    │ - JSON file logger       │   │
│  │ - Status bar │    │ - Config manager         │   │
│  └──────────────┘    └──────────────────────────┘   │
│                      └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         ▲                        │
         │ webhook POST           │ PDF download
         │                        ▼
    ┌─────────┐           ┌──────────────┐
    │  pretix  │           │  pretix API  │
    │ (cloud)  │           │  (REST)      │
    └─────────┘           └──────────────┘
                                  │
                                  ▼
                         ┌──────────────┐
                         │  Brother QL  │
                         │  (USB/LAN)   │
                         └──────────────┘
```

---

## 3. Folder Structure

```
pretix-print-service/
├── package.json
├── launch.js                 ← Launcher script (fixes ELECTRON_RUN_AS_NODE)
├── electron.js               ← Electron main entry point
├── preload.js                ← Electron preload (IPC bridge)
├── server/
│   ├── index.js              ← Express webhook server
│   ├── pretixApi.js          ← Pretix REST API client + checkStatus()
│   ├── printer.js            ← Printer logic (pdf-to-printer)
│   ├── db.js                 ← JSON file logger
│   └── config.js             ← Config manager (read/write data/config.json)
├── renderer/
│   ├── index.html            ← Main UI (tabs Dashboard / Config + status bar)
│   ├── renderer.js           ← Frontend JS
│   └── styles.css            ← UI styles
└── data/
    ├── prints.json           ← JSON log file (auto-created at runtime)
    └── config.json           ← Configurazione salvata dalla UI (auto-created)
```

---

## 4. Dependencies

| Package | Purpose |
|---|---|
| `electron` | Desktop app wrapper |
| `electron-builder` | Build `.exe` installer |
| `express` | Webhook HTTP server |
| `axios` | HTTP client for pretix API |
| `pdf-to-printer` | Windows printer driver |
| `pdfkit` | PDF generation (used for test print) |

> **Note:** `better-sqlite3` rimosso (richiedeva compilazione C++); log e config usano file JSON.
> `dotenv` rimosso: la configurazione è gestita interamente dalla scheda **Configurazione** nell'app
> e persiste in `data/config.json`. I file `.env` e `.env.example` non esistono più nel progetto.

**package.json scripts:**
```json
{
  "main": "electron.js",
  "scripts": {
    "start": "node launch.js",
    "build": "electron-builder --win"
  }
}
```

---

## 5. Launcher Script (`launch.js`)

VS Code (and other Electron-based editors) set the environment variable
`ELECTRON_RUN_AS_NODE=1` in their terminal sessions. When this variable is set,
Electron runs as plain Node.js and does not expose its built-in API
(`app`, `BrowserWindow`, etc.).

`launch.js` removes this variable from the environment before spawning `electron.exe`:

```javascript
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code || 0));
```

---

## 6. Webhook Endpoint

pretix sends a `POST` to your app when a check-in occurs.

**Endpoint:** `POST http://localhost:3000/webhook`

**pretix event type:** `pretix.event.checkin`

**Flow:**
1. Receive POST body from pretix
2. Verify HMAC-SHA256 signature (`X-Pretix-Signature` header)
3. Extract `order_code` and `position_id` from payload
4. Call pretix API to download ticket PDF
5. Send PDF to selected printer
6. Log to JSON file

**server/index.js:**
```javascript
const express = require('express');
const crypto = require('crypto');
const { downloadAndPrint } = require('./printer');
const { logPrint } = require('./db');
const { getTicketPDF } = require('./pretixApi');

const app = express();

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

let autoPrint = true;

function verifySignature(req) {
  const secret = process.env.PRETIX_WEBHOOK_SECRET;
  if (!secret) return true; // non configurato, skip
  const signature = req.headers['x-pretix-signature'];
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(401);

  const body = req.body;
  const order = body?.checkin?.order;
  const positionid = body?.checkin?.positionid;

  if (!order) return res.sendStatus(400);
  if (!autoPrint) return res.sendStatus(200);

  try {
    const pdfBuffer = await getTicketPDF(order, positionid);
    await downloadAndPrint(pdfBuffer);
    logPrint({ order, positionid, timestamp: new Date().toISOString() });
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(process.env.WEBHOOK_PORT || 3000, () => {
  console.log(`Webhook server listening on port ${process.env.WEBHOOK_PORT || 3000}`);
});

module.exports = { setAutoPrint: (v) => { autoPrint = v; } };
```

---

## 7. JSON Log (`server/db.js`)

The print log is stored as a JSON array in `data/prints.json`.
Each entry has: `id`, `order_code`, `position_id`, `timestamp`.

```javascript
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, 'prints.json');

function readAll() {
  if (!fs.existsSync(dbPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(records) {
  fs.writeFileSync(dbPath, JSON.stringify(records, null, 2));
}

function logPrint({ order, positionid, timestamp }) {
  const records = readAll();
  const id = records.length > 0 ? records[records.length - 1].id + 1 : 1;
  records.push({ id, order_code: order, position_id: positionid, timestamp });
  writeAll(records);
}

function getRecentPrints(limit = 50) {
  const records = readAll();
  return records.slice(-limit).reverse();
}

module.exports = { logPrint, getRecentPrints };
```

---

## 8. Pretix API Client

**server/pretixApi.js:**
```javascript
const axios = require('axios');
require('dotenv').config();

const BASE = 'https://pretix.eu/api/v1';
const ORG = process.env.PRETIX_ORGANIZER;
const EVENT = process.env.PRETIX_EVENT;
const TOKEN = process.env.PRETIX_API_TOKEN;

async function getTicketPDF(orderCode, positionId) {
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/orders/${orderCode}/positions/${positionId}/pdf/`;
  const response = await axios.get(url, {
    headers: { Authorization: `Token ${TOKEN}` },
    responseType: 'arraybuffer'
  });
  return response.data;
}

module.exports = { getTicketPDF };
```

---

## 9. Printer Module

**server/printer.js:**
```javascript
const { print } = require('pdf-to-printer');
const fs = require('fs');
const path = require('path');
const os = require('os');

let selectedPrinter = null;

function setSelectedPrinter(name) { selectedPrinter = name; }
function getSelectedPrinter() { return selectedPrinter; }

async function downloadAndPrint(pdfBuffer) {
  const tmpPath = path.join(os.tmpdir(), `ticket_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, Buffer.from(pdfBuffer));
  const options = selectedPrinter ? { printer: selectedPrinter } : {};
  await print(tmpPath, options);
  fs.unlinkSync(tmpPath);
}

async function testPrint() {
  // Lazy requires to avoid circular dependencies
  const PDFDocument = require('pdfkit');
  const { getConfig } = require('./config');
  const { checkStatus } = require('./pretixApi');

  const cfg = getConfig();
  let status = { api: false, organizer: false, event: false };
  try { status = await checkStatus(); } catch {}

  return new Promise((resolve, reject) => {
    const W = 255; // ~90mm
    const doc = new PDFDocument({ size: [W, 175], margin: 14 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', async () => {
      try { await downloadAndPrint(Buffer.concat(chunks)); resolve(); }
      catch (err) { reject(err); }
    });

    const separator = () => {
      doc.moveDown(0.3);
      doc.moveTo(14, doc.y).lineTo(W - 14, doc.y).lineWidth(0.5).stroke();
      doc.moveDown(0.3);
    };
    const statusTag = ok => ok ? '[  OK  ]' : '[  --  ]';

    doc.fontSize(12).font('Helvetica-Bold').text('PRETIX PRINT SERVICE', { align: 'center' });
    doc.fontSize(7).font('Helvetica').text('Pagina di test', { align: 'center' });
    separator();

    doc.fontSize(7).font('Helvetica-Bold').text('CONFIGURAZIONE');
    doc.fontSize(7).font('Helvetica');
    doc.text(`Organizer : ${cfg.PRETIX_ORGANIZER || '—'}`);
    doc.text(`Evento    : ${cfg.PRETIX_EVENT    || '—'}`);
    doc.text(`Porta     : ${cfg.WEBHOOK_PORT    || '3000'}`);
    separator();

    doc.fontSize(7).font('Helvetica-Bold').text('STATO CONNESSIONE');
    doc.fontSize(7).font('Helvetica');
    doc.text(`${statusTag(status.api)}       API Pretix`);
    doc.text(`${statusTag(status.organizer)} Organizer`);
    doc.text(`${statusTag(status.event)}     Evento`);
    separator();

    doc.fontSize(6).font('Helvetica').text(new Date().toLocaleString('it-IT'), { align: 'center' });
    doc.end();
  });
}

module.exports = { downloadAndPrint, setSelectedPrinter, getSelectedPrinter, testPrint };
```

---

## 10. Electron Main Process

**electron.js:**
```javascript
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { getPrinters } = require('pdf-to-printer');
const { setSelectedPrinter, getSelectedPrinter, testPrint } = require('./server/printer');
const { getRecentPrints } = require('./server/db');
const { setAutoPrint } = require('./server/index');
const { getConfig, saveConfig } = require('./server/config');
const { checkStatus } = require('./server/pretixApi');

Menu.setApplicationMenu(null);

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

ipcMain.handle('get-printers',         async () => await getPrinters());
ipcMain.handle('set-printer',          (_, name) => setSelectedPrinter(name));
ipcMain.handle('get-selected-printer', () => getSelectedPrinter());
ipcMain.handle('set-auto-print',       (_, value) => setAutoPrint(value));
ipcMain.handle('get-log',              () => getRecentPrints(50));
ipcMain.handle('test-print',           async () => await testPrint());
ipcMain.handle('get-config',           () => getConfig());
ipcMain.handle('save-config',          (_, cfg) => saveConfig(cfg));
ipcMain.handle('check-status',         async () => await checkStatus());
```

**preload.js:**
```javascript
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
  checkStatus:        () => ipcRenderer.invoke('check-status')
});
```

---

## 11. UI (Renderer)

The UI includes a printer selector, auto-print toggle, test print button, and print log table.
See `renderer/index.html` and `renderer/renderer.js` for implementation.

---

## 12. Configurazione

La configurazione avviene interamente dalla scheda **Configurazione** nell'interfaccia grafica.
I parametri vengono salvati in `data/config.json` e ricaricati automaticamente ad ogni avvio.

| Parametro | Dove trovarlo |
|---|---|
| API Token | pretix admin → Impostazioni → Team → API token (permesso: Leggi ordini) |
| Organizer Slug | Nell'URL: `pretix.eu/control/event/`**organizer**`/evento/` |
| Event Slug | Nell'URL: `pretix.eu/control/event/organizer/`**evento**`/` |
| Webhook Secret | pretix admin → Impostazioni → Webhook → chiave di firma |
| Porta Webhook | Default: 3000 (cambia solo se la porta è già occupata) |

> Non esistono più file `.env` nel progetto.

---

## 13. Pretix Configuration

1. In pretix admin → **Settings → Webhooks** → Add new
2. URL: `http://<gate-laptop-ip>:3000/webhook`
3. Event type: **Check-in created**
4. Copy signing secret → set as `PRETIX_WEBHOOK_SECRET`

For the API token:
1. **Settings → Teams → API tokens**
2. Create token with **Read orders** permission
3. Set as `PRETIX_API_TOKEN`

> **Note:** For testing from pretix cloud to your laptop, use [ngrok](https://ngrok.com) to expose localhost temporarily: `ngrok http 3000`

---

## 14. Build & Deploy

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build Windows installer
npm run build
# Output: /dist/pretix-print-service Setup.exe
```

---

## 15. Open Points

| Item | Action Required |
|---|---|
| Pretix webhook payload format | Verify exact JSON structure with a real test check-in |
| PDF API endpoint | Test `GET /orders/{code}/positions/{id}/pdf/` on your pretix instance |
| Webhook signature format | Verify pretix sends `X-Pretix-Signature` as hex HMAC-SHA256 |
| Brother QL compatibility | Confirm `pdf-to-printer` works with your model on Windows |
| Network exposure | Use ngrok for dev; fixed LAN IP for production at gate |
| Reprint feature | Add reprint button in log table (future iteration) |
| Auto-print state persistence | Save toggle state across restarts (currently resets to `true`) |
