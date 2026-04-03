const CONFIG_KEYS = ['PRETIX_API_TOKEN', 'POLL_INTERVAL'];
let configDirty = false;
let _pollCountdownTimer = null;

function startPollCountdown(intervalSec) {
  if (_pollCountdownTimer) clearInterval(_pollCountdownTimer);
  const label = document.querySelector('#status-poll .status-label');
  let remaining = intervalSec;
  const tick = () => { label.textContent = `Polling: ${remaining}s`; remaining--; if (remaining < 0) remaining = intervalSec; };
  tick();
  _pollCountdownTimer = setInterval(tick, 1000);
}

function setConfigDirty(dirty) {
  configDirty = dirty;
  const saveBtn = document.getElementById('saveConfigBtn');
  const unsavedMsg = document.getElementById('unsavedMsg');
  if (dirty) {
    saveBtn.classList.add('unsaved');
    unsavedMsg.textContent = 'Modifiche non salvate';
  } else {
    saveBtn.classList.remove('unsaved');
    unsavedMsg.textContent = '';
  }
}

async function init() {

  // ── Tab navigation ────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const currentTab = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (currentTab === 'config' && configDirty && btn.dataset.tab !== 'config') {
        const ok = confirm('Hai modifiche non salvate nella configurazione.\nSe esci ora andranno perse. Continuare?');
        if (!ok) return;
        setConfigDirty(false);
      }
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ── Printers ──────────────────────────────────────────────────
  const printers = await window.api.getPrinters();
  const select = document.getElementById('printerSelect');
  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  const selected = await window.api.getSelectedPrinter();
  if (selected) select.value = selected;
  select.addEventListener('change', () => setConfigDirty(true));

  // ── Test print ────────────────────────────────────────────────
  const testBtn = document.getElementById('testPrintBtn');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Stampa in corso...';
    try {
      await window.api.testPrint();
      testBtn.textContent = 'Fatto!';
    } catch {
      testBtn.textContent = 'Errore';
    }
    setTimeout(() => { testBtn.textContent = 'Test Print'; testBtn.disabled = false; }, 2000);
  });

  // ── Auto-print toggle ─────────────────────────────────────────
  const toggle = document.getElementById('autoPrintToggle');
  toggle.addEventListener('change', () => setConfigDirty(true));

  // ── Print log ─────────────────────────────────────────────────
  const rows = await window.api.getLog();
  const tbody = document.querySelector('#logTable tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td>${r.order_code}</td><td>${r.position_id}</td><td>${r.timestamp}</td>`;
    tbody.appendChild(tr);
  });

  // ── Config form ───────────────────────────────────────────────
  const cfg = await window.api.getConfig();
  CONFIG_KEYS.forEach(key => {
    const input = document.getElementById(`cfg-${key}`);
    if (input) {
      input.value = cfg[key] || '';
      input.addEventListener('input', () => setConfigDirty(true));
    }
  });
  startPollCountdown(parseInt(cfg.POLL_INTERVAL) || 5);

  // ── Cascading dropdowns: organizer & event ────────────────────
  const orgSelect = document.getElementById('cfg-PRETIX_ORGANIZER');
  const eventSelect = document.getElementById('cfg-PRETIX_EVENT');
  const loadBtn = document.getElementById('loadOrgBtn');

  async function populateEvents(token, org, savedEvent) {
    eventSelect.innerHTML = '<option value="">— seleziona —</option>';
    eventSelect.disabled = true;
    try {
      const events = await window.api.getEvents(token, org);
      events.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.slug;
        opt.textContent = e.name;
        eventSelect.appendChild(opt);
      });
      eventSelect.disabled = false;
      if (savedEvent) eventSelect.value = savedEvent;
    } catch {
      eventSelect.innerHTML = '<option value="">Errore caricamento eventi</option>';
    }
  }

  async function populateOrganizers(token, savedOrg, savedEvent) {
    loadBtn.disabled = true;
    loadBtn.textContent = '…';
    orgSelect.innerHTML = '<option value="">— seleziona —</option>';
    orgSelect.disabled = true;
    eventSelect.innerHTML = '<option value="">— seleziona prima l\'organizzatore —</option>';
    eventSelect.disabled = true;
    try {
      const orgs = await window.api.getOrganizers(token);
      orgs.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.slug;
        opt.textContent = o.name;
        orgSelect.appendChild(opt);
      });
      orgSelect.disabled = false;
      if (savedOrg) {
        orgSelect.value = savedOrg;
        if (orgSelect.value === savedOrg) await populateEvents(token, savedOrg, savedEvent);
      }
    } catch {
      orgSelect.innerHTML = '<option value="">Errore — token non valido?</option>';
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Carica';
    }
  }

  loadBtn.addEventListener('click', async () => {
    const token = document.getElementById('cfg-PRETIX_API_TOKEN').value.trim();
    if (!token) return;
    await populateOrganizers(token, null, null);
    setConfigDirty(true);
  });

  orgSelect.addEventListener('change', async () => {
    const token = document.getElementById('cfg-PRETIX_API_TOKEN').value.trim();
    if (orgSelect.value) await populateEvents(token, orgSelect.value, null);
    setConfigDirty(true);
  });

  eventSelect.addEventListener('change', () => setConfigDirty(true));

  if (cfg.PRETIX_API_TOKEN) {
    await populateOrganizers(cfg.PRETIX_API_TOKEN, cfg.PRETIX_ORGANIZER, cfg.PRETIX_EVENT);
  }

  document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newCfg = {};
    CONFIG_KEYS.forEach(key => {
      const input = document.getElementById(`cfg-${key}`);
      if (input) newCfg[key] = input.value.trim();
    });
    newCfg.PRETIX_ORGANIZER = orgSelect.value;
    newCfg.PRETIX_EVENT = eventSelect.value;
    await window.api.setPrinter(select.value);
    window.api.setAutoPrint(toggle.checked);
    await window.api.saveConfig(newCfg);
    setConfigDirty(false);
    startPollCountdown(parseInt(newCfg.POLL_INTERVAL) || 5);
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.textContent = 'Salvato!';
    setTimeout(() => { saveStatus.textContent = ''; }, 2500);
    checkStatus(); // refresh status bar after saving
  });

  // ── API log auto-refresh ──────────────────────────────────────
  setInterval(refreshApiLog, 2000);

  // ── Status bar ────────────────────────────────────────────────
  document.getElementById('statusRefreshBtn').addEventListener('click', checkStatus);
  checkStatus();
  setInterval(checkStatus, 30000); // auto-refresh every 30s
}

async function refreshApiLog() {
  const rows = await window.api.getApiLog();
  const tbody = document.querySelector('#apiLogTable tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const statusClass = r.ok ? 'status-ok' : 'status-err';
    tr.innerHTML = `<td>${r.timestamp}</td><td>${r.method}</td><td class="endpoint">${r.endpoint}</td><td class="${statusClass}">${r.status || '—'}</td>`;
    tbody.appendChild(tr);
  });
}

async function checkStatus() {
  // Set all dots to "loading" (orange) while waiting
  ['status-api', 'status-organizer', 'status-event'].forEach(id => {
    document.getElementById(id).querySelector('.dot').className = 'dot loading';
  });

  try {
    const s = await window.api.checkStatus();

    setStatus('status-api',
      s.api,
      s.api ? 'API OK' : 'API non raggiungibile'
    );
    setStatus('status-organizer',
      s.organizer,
      s.organizer ? 'Organizer OK' : 'Organizer non trovato'
    );
    setStatus('status-event',
      s.event,
      s.event ? 'Evento OK' : 'Evento non trovato'
    );
  } catch {
    ['status-api', 'status-organizer', 'status-event'].forEach(id => {
      setStatus(id, false, 'Errore');
    });
  }
}

function setStatus(id, ok, label) {
  const el = document.getElementById(id);
  el.querySelector('.dot').className = 'dot ' + (ok ? 'ok' : 'error');
  el.title = label; // dettaglio errore al hover
}

init();
