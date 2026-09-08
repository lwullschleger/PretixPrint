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
| `pdf-lib` | Generazione PDF del badge (`badgeRenderer.js`), usato anche dal Test Print |
| `qrcode` | Generazione QR/barcode nel badge |
| `pdfkit` | *(non più usato)* — il Test Print ora renderizza il badge reale; rimovibile in futuro |

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

**Gestione errori del polling (anti-spam):**

Il timer parte sempre, ma ogni tick esegue dei controlli preliminari per evitare di generare un errore a video ad ogni ciclo:

1. **Configurazione incompleta** — se `PRETIX_API_TOKEN`, `PRETIX_ORGANIZER` o `PRETIX_EVENT` sono vuoti, il tick viene saltato senza chiamare l'API (un solo `console.log` informativo, non un errore). Appena la configurazione è completa, il polling riprende da solo al tick successivo.
2. **Errore di accesso (HTTP 401/403/404)** — token invalido/revocato oppure organizer/evento inesistenti: viene loggato **un solo** `console.error` (che il main process inoltra alla UI) e il polling viene **sospeso** (`pollSuspended = true`). La sospensione viene rimossa da `resumePolling()`, chiamata dall'handler IPC `save-config` in `electron.js` quando l'utente salva la configurazione.
3. **Errore transitorio (rete, timeout, 5xx)** — il polling continua a riprovare ad ogni tick, ma l'errore viene loggato solo al passaggio di stato OK→errore (`networkErrorActive`); al ripristino della connessione viene loggato un messaggio informativo e il flag si azzera.

Funzioni esportate da `server/index.js`: `setAutoPrint`, `reprintPosition`, `previewPosition`, `testPrintBadge`, `resumePolling`.

---

## 7. JSON Log (`server/db.js`)

The check-in log is stored as a JSON array in `data/checkins.json`.
Ogni voce ha: `id`, `position_id`, `order_code`, `timestamp`, `printed` (booleano) e i dati partecipante (`attendee_name`, `first_name`, `last_name`, `attendee_company`, `attendee_email`, `secret`).

**Deduplica stampa (una sola stampa per badge):**
Il record è identificato univocamente dalla `position_id`. Se arriva un check-in per una `position_id` **già presente** (riscansione dello stesso biglietto con PretixScan), `logPrint` aggiorna i dati ma **preserva** il flag `printed`, così un badge già stampato non viene ristampato in automatico. Se invece la prima stampa era fallita (`printed` resta `false`), una riscansione la riprova.

`logPrint` restituisce `{ id, printed }`, dove `printed` è lo stato **prima** di questo check-in. `server/index.js` avvia la stampa automatica solo se `autoPrint && details && !printed`. La ristampa manuale dalla UI resta sempre disponibile e chiama `markPrinted` indipendentemente da questo flag.

```javascript
function logPrint({ order, positionid, timestamp, details }) {
  const records = readAll();
  const existing = records.find(r => r.position_id === positionid);
  if (existing) {
    // riscansione: aggiorna i dati ma PRESERVA `printed`
    existing.timestamp = timestamp;
    /* ...aggiorna order_code e dati partecipante... */
    writeAll(records);
    return { id: existing.id, printed: existing.printed };
  }
  const id = records.length > 0 ? records[records.length - 1].id + 1 : 1;
  records.push({ id, position_id: positionid, order_code: order, timestamp, printed: false, /* ...dati partecipante... */ });
  writeAll(records);
  return { id, printed: false };
}

function markPrinted(id) { /* imposta printed = true sul record */ }

function getRecentPrints(limit = 50) {
  const records = readAll();
  return records.slice(-limit).reverse();
}
```

---

## 8. Pretix API Client (`server/pretixApi.js`)

```javascript
const BASE = 'https://pretix.eu/api/v1';

// Recupera dati partecipante da una posizione
async function getPositionDetails(positionId) { ... }
// Endpoint: GET /orderpositions/{id}/
// Restituisce { name, order_code, secret }

// Recupera il layout badge default dell'evento (con cache, invalidata al salvataggio config)
async function getDefaultBadgeLayout() { ... }
// Endpoint: GET /badgelayouts/ — cerca il layout con default: true

// Scarica il PDF di sfondo del badge layout (richiede auth token)
async function downloadBackground(url) { ... }

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

### Badge Renderer (`server/badgeRenderer.js`) — risoluzione contenuto campi

`resolveContent(el, values)` mappa il campo `content` di ogni elemento del layout
Pretix sui valori del partecipante. Oltre alle chiavi dirette (`attendee_name`,
`attendee_name:given_name`, `attendee_name:family_name`, `attendee_company`,
`attendee_email`, `order_code`, `secret`) gestisce le **chiavi composte del nome**
generate dall'editor badge di Pretix (es. `attendee_name_given_name_family_name`,
scelta "Nome Cognome"): le parti note (`given_name`, `family_name`) vengono unite
nell'ordine in cui compaiono nella chiave; se nessuna parte è riconosciuta si usa
il nome completo `attendee_name` come fallback. Senza questa gestione i campi con
chiave composta risultavano vuoti e venivano saltati (nome mancante sul badge).

---

## 9. Printer Module (`server/printer.js`)

Le opzioni passate a `pdf-to-printer` (che internamente usa SumatraPDF) vengono
costruite da `buildPrintOptions()` a partire dalla stampante selezionata e dalle
**impostazioni di stampa** salvate in config: `PRINT_PAPER_SIZE` (`paperSize`),
`PRINT_SCALE` (`scale`: `noscale`/`fit`/`shrink`), `PRINT_ORIENTATION`
(`orientation`: `portrait`/`landscape`; `auto` = omesso). I valori non impostati
vengono omessi, così si usa il default della stampante (retro-compatibile).
Queste opzioni valgono sia per la stampa automatica dei badge sia per il Test Print.

**Test Print = badge reale con dati di esempio:** il Test Print non stampa più una pagina diagnostica separata, ma renderizza il **layout badge reale** (stesso `generateBadgePdf` dell'auto-print) con dati fittizi (`testPrintBadge` in `server/index.js`), così il formato/dimensione della stampa di prova coincide con quello effettivo. Riceve un `override` con le impostazioni di stampa correnti dei dropdown (stampante, formato, scala, orientamento), quindi si può verificare l'A5 anche prima di salvare la config.

```javascript
function buildPrintOptions(printerOverride) {
  const cfg = getConfig();
  const options = {};
  const printer = printerOverride || selectedPrinter;
  if (printer) options.printer = printer;
  if (cfg.PRINT_PAPER_SIZE) options.paperSize = cfg.PRINT_PAPER_SIZE;
  if (cfg.PRINT_SCALE)      options.scale     = cfg.PRINT_SCALE;
  if (cfg.PRINT_ORIENTATION && cfg.PRINT_ORIENTATION !== 'auto') {
    options.orientation = cfg.PRINT_ORIENTATION;
  }
  return options;
}

async function downloadAndPrint(pdfBuffer, printerOverride) {
  const tmpPath = path.join(os.tmpdir(), `ticket_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, Buffer.from(pdfBuffer));
  await print(tmpPath, buildPrintOptions(printerOverride));
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
ipcMain.handle('test-print',           async (_, override) => await testPrintBadge(override));
ipcMain.handle('get-config',           () => getConfig());
ipcMain.handle('save-config',          (_, cfg) => saveConfig(cfg));
ipcMain.handle('check-status',         async () => await checkStatus());
```

---

## 11. UI (Renderer)

The UI includes a printer selector, auto-print toggle, test print button, and print log table.
See `renderer/index.html` and `renderer/renderer.js` for implementation.

**Test Print (badge reale + selezione corrente):** il bottone **Test Print** renderizza il layout badge reale con dati di esempio (vedi `testPrintBadge` in sez. 9) e lo stampa usando la stampante e le impostazioni di stampa **attualmente selezionate nei dropdown**, **anche se la configurazione non è ancora stata salvata**. I valori correnti (stampante, formato, scala, orientamento) vengono passati come `override` a `testPrint(override)` → `downloadAndPrint(pdfBuffer, override)`, quindi non serve salvare prima di testare. La `selectedPrinter` persistente e le impostazioni salvate (usate dalla stampa automatica) vengono aggiornate solo al salvataggio della config.

**Update layout badge e selezione corrente:** il bottone **Update** del layout badge ricarica il layout per l'organizzatore/evento **attualmente selezionati nei dropdown**, anche prima di salvare. I valori correnti (token, organizzatore, evento) vengono passati come override esplicito (`refreshBadgeCache(override)` → `warmBadgeCache(override)` → `getDefaultBadgeLayout(override)`, risolto da `resolvePretix(override)` in `pretixApi.js`). Senza override le funzioni continuano a usare la config salvata.

**Svuotamento check-in al cambio evento (con conferma):** se al salvataggio l'organizzatore o l'evento risultano **diversi** dai precedenti, il renderer mostra un `confirm()` di avviso ("i check-in precedenti verranno eliminati"). Se l'utente annulla, il salvataggio viene interrotto (evento e check-in correnti restano invariati). Se conferma, l'handler `save-config` in `electron.js` rileva il cambio e invoca `clearCheckins()`, poi il renderer aggiorna la tabella. La conferma **non** appare al primo setup (quando non c'era ancora un organizzatore/evento) né salvando senza cambiare evento (es. solo intervallo polling): in quei casi i check-in vengono preservati.

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
| Usa sfondo badge | Se abilitato, scarica il PDF di sfondo dal layout badge default di Pretix e lo usa come base per la stampa. |
| Formato carta (`PRINT_PAPER_SIZE`) | Formato passato alla stampante: `A4`/`A5`/`A6`/`Letter`, oppure vuoto = default stampante. Default UI: **A5**. |
| Scala (`PRINT_SCALE`) | `noscale` (dimensione reale 1:1), `fit` (adatta alla pagina), `shrink` (riduci se necessario). Default UI: **noscale**. |
| Orientamento (`PRINT_ORIENTATION`) | `auto` (default stampante), `portrait` (verticale), `landscape` (orizzontale). Default UI: **auto**. |

> Non esistono più file `.env` nel progetto.
> Le impostazioni di stampa (formato/scala/orientamento) sono nel pannello **Impostazioni di stampa** della scheda Configurazione, colonna *Stampa*.

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

# (Una tantum) Genera l'icona PNG da build/icon.svg
npm run generate-icons

# Run in development
npm start

# Build Windows installer
npm run build
# Output: /dist/pretix-print-service Setup.exe
```

### Icona applicazione

| File | Descrizione |
|---|---|
| `build/icon.svg` | Sorgente vettoriale (stampante + ticket + checkmark) |
| `build/icon.png` | PNG 512×512 generato via `sharp` — usato da electron-builder |
| `scripts/generate-icons.js` | Script di conversione SVG→PNG |

electron-builder converte automaticamente il PNG in `.ico` durante la build Windows.

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
