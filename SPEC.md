# Pretix Print Service — Technical Specification
**Version 1.4 | April 2026**

---

## 1. Overview

A Windows desktop application built with **Electron + Node.js** that:

- Interroga periodicamente l'API **pretix** (polling) per rilevare nuovi check-in
- Downloads the pre-generated ticket PDF from the **pretix API**
- Automatically prints it to a locally connected **Brother QL** label printer
- Maintains a **JSON log** of all printed tickets, surviving restarts
- Provides a simple **GUI** with three tabs:
  - **Dashboard**: log stampe
  - **Configurazione**: selettore stampante + Test Print, toggle stampa automatica, form per impostare API token, organizer, evento e intervallo polling — salvati in `data/config.json` e ricaricati automaticamente ad ogni avvio
  - **Log API**: tabella in-memory delle chiamate HTTP effettuate verso Pretix (ora, metodo, endpoint, status code), aggiornata ogni 2 secondi; max 200 voci, resettata al riavvio
- Mostra una **barra di stato** (in basso) con l'esito della connessione all'API Pretix, la validità dell'organizer e dell'evento configurati

> **Non richiede porte aperte o indirizzi IP raggiungibili dall'esterno.** Il traffico è esclusivamente uscente verso `pretix.eu`.

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
│  │ - Dashboard  │    │ - Polling loop (axios)   │   │
│  │   (printer,  │    │ - Pretix API client      │   │
│  │    toggle,   │    │ - PDF downloader         │   │
│  │    log)      │    │ - Printer driver         │   │
│  │ - Config tab │    │ - JSON file logger       │   │
│  │ - Status bar │    │ - Config manager         │   │
│  └──────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                               │
                    GET /checkins/ (polling)
                    GET /orders/.../pdf/
                               │
                               ▼
                        ┌──────────────┐
                        │  pretix API  │
                        │  (REST)      │
                        └──────────────┘
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
│   ├── index.js              ← Polling loop (check-in → stampa)
│   ├── pretixApi.js          ← Pretix REST API client + checkStatus() + getRecentCheckins()
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
| `axios` | HTTP client for pretix API (polling + PDF download) |
| `pdf-to-printer` | Windows printer driver |
| `pdfkit` | PDF generation (used for test print) |

> **`express` rimosso**: non è più necessario un server HTTP locale. Il flusso è interamente uscente.
> `better-sqlite3` rimosso (richiedeva compilazione C++); log e config usano file JSON.
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

## 6. Polling Loop (`server/index.js`)

L'app interroga periodicamente l'endpoint `/checkins/` di Pretix per rilevare nuovi check-in, senza necessità di esporre porte.

**Endpoint Pretix:**
```
GET /api/v1/organizers/{org}/events/{event}/checkins/
  ?datetime_since={iso8601}
  &ordering=datetime
  &type=entry
```

**Risposta:** `{ results: [{ id, datetime, type, order, position, list }, ...] }`
- `order` = codice ordine (stringa)
- `position` = position ID (intero)

**Flusso:**
1. All'avvio: `lastPollTime = now`
2. Ogni N secondi: `GET /checkins/?datetime_since={lastPollTime}`
3. Se la chiamata ha successo: aggiorna `lastPollTime = now`
4. Per ogni check-in ricevuto (se `autoPrint` attivo):
   - `GET /orders/{order}/positions/{position}/pdf/` → PDF buffer
   - Stampa il PDF → log su JSON
5. In caso di errore di rete: `lastPollTime` NON avanza → riprova al prossimo tick

```javascript
let autoPrint = true;
let lastPollTime = new Date().toISOString();
let pollTimer = null;

function startPolling() {
  const intervalMs = (parseInt(getConfig().POLL_INTERVAL) || 5) * 1000;
  pollTimer = setInterval(async () => {
    const since = lastPollTime;
    const now = new Date().toISOString();
    try {
      const checkins = await getRecentCheckins(since);
      lastPollTime = now;
      for (const checkin of checkins) {
        if (!autoPrint) continue;
        const pdfBuffer = await getTicketPDF(checkin.order, checkin.position);
        await downloadAndPrint(pdfBuffer);
        logPrint({ order: checkin.order, positionid: checkin.position, timestamp: checkin.datetime });
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }
  }, intervalMs);
}

startPolling();
module.exports = { setAutoPrint: (v) => { autoPrint = v; } };
```

---

## 7. JSON Log (`server/db.js`)

The print log is stored as a JSON array in `data/prints.json`.
Each entry has: `id`, `order_code`, `position_id`, `timestamp`.

```javascript
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
```

---

## 8. Pretix API Client (`server/pretixApi.js`)

```javascript
const BASE = 'https://pretix.eu/api/v1';

// Scarica il PDF di un biglietto
async function getTicketPDF(orderCode, positionId) { ... }

// Verifica connettività API, organizer ed evento
async function checkStatus() { ... }

// Restituisce i check-in avvenuti dopo `since` (ISO 8601)
async function getRecentCheckins(since) {
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/checkins/`;
  const response = await axios.get(url, {
    headers: { Authorization: `Token ${TOKEN}` },
    params: { datetime_since: since, ordering: 'datetime', type: 'entry' }
  });
  return response.data.results;
}
```

---

## 9. Printer Module (`server/printer.js`)

```javascript
async function downloadAndPrint(pdfBuffer) {
  const tmpPath = path.join(os.tmpdir(), `ticket_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, Buffer.from(pdfBuffer));
  const options = selectedPrinter ? { printer: selectedPrinter } : {};
  await print(tmpPath, options);
  fs.unlinkSync(tmpPath);
}
```

---

## 10. Electron Main Process

**electron.js:**
```javascript
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

---

## 11. UI (Renderer)

The UI includes a printer selector, auto-print toggle, test print button, and print log table.
See `renderer/index.html` and `renderer/renderer.js` for implementation.

### Unsaved Changes Tracking (Config tab)

La scheda **Configurazione** traccia le modifiche non salvate con un flag `configDirty`:

- Ogni campo input del form registra un listener `input`; appena l'utente modifica un valore, `configDirty` diventa `true`.
- Il bottone **Salva configurazione** cambia colore (arancione) e compare il testo *"Modifiche non salvate"* accanto al bottone.
- Se l'utente tenta di passare a un'altra tab con `configDirty = true`, appare un `confirm()` di avviso; se l'utente annulla, la navigazione non avviene.
- Al salvataggio del form `configDirty` viene resettato a `false` e l'UI torna allo stato normale.

---

## 12. Configurazione

La configurazione avviene interamente dalla scheda **Configurazione** nell'interfaccia grafica.
I parametri vengono salvati in `data/config.json` e ricaricati automaticamente ad ogni avvio.

| Parametro | Descrizione |
|---|---|
| API Token | pretix admin → Impostazioni → Team → API token (permesso: **Leggi tutti gli ordini**) |
| Organizzatore | Selezionato da dropdown popolato via `GET /api/v1/organizers/` dopo aver inserito il token |
| Evento | Selezionato da dropdown a cascata via `GET /api/v1/organizers/{org}/events/` |
| Intervallo polling | Secondi tra una chiamata e l'altra all'API (default: 5). Modificabile dalla UI; richiede riavvio. |
| Stampante selezionata | Nome della stampante scelta nella Dashboard; salvata in `data/config.json` e ripristinata all'avvio. |

> Non esistono più file `.env` nel progetto.

---

## 13. Pretix Configuration

Per il token API:
1. pretix admin → **Impostazioni → Team → Token API**
2. Crea token con permesso **Leggi tutti gli ordini**
3. Inserisci il token nella scheda **Configurazione** dell'app

> Non è necessario configurare webhook su pretix. L'app interroga Pretix in polling — nessuna porta da aprire, nessun IP da esporre.

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
| Checkins API endpoint | Verificare che l'endpoint `/checkins/` risponda correttamente con il token configurato |
| PDF API endpoint | Test `GET /orders/{code}/positions/{id}/pdf/` sul tuo pretix instance |
| Brother QL compatibility | Confirm `pdf-to-printer` works with your model on Windows |
| Reprint feature | Add reprint button in log table (future iteration) |
| Auto-print state persistence | Save toggle state across restarts (currently resets to `true`) |
| Polling con paginating | Se l'evento ha molti check-in simultanei, gestire la paginazione dei risultati |
