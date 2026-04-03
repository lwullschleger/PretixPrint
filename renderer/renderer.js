const CONFIG_KEYS = ['PRETIX_API_TOKEN', 'POLL_INTERVAL'];

// ── Error modal ───────────────────────────────────────────────
const _errorQueue = [];
let _errorModalOpen = false;

function showNextError() {
  if (_errorModalOpen || _errorQueue.length === 0) return;
  _errorModalOpen = true;
  const modal = document.getElementById('errorModal');
  document.getElementById('errorModalMsg').textContent = _errorQueue.shift();
  modal.style.display = 'flex';
}

function initErrorModal() {
  document.getElementById('errorModalOk').addEventListener('click', () => {
    document.getElementById('errorModal').style.display = 'none';
    _errorModalOpen = false;
    showNextError();
  });
  window.api.onError(msg => {
    _errorQueue.push(msg);
    showNextError();
  });
  window.addEventListener('unhandledrejection', e => {
    _errorQueue.push(e.reason?.message || String(e.reason));
    showNextError();
  });
}

initErrorModal();
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

function updateAutoPrintWarning(active) {
  const el = document.getElementById('autoPrintWarning');
  el.style.display = active ? 'none' : 'inline-block';
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

  // ── Badge background toggle ───────────────────────────────────
  const badgeBgToggle = document.getElementById('badgeBackgroundToggle');
  badgeBgToggle.addEventListener('change', () => setConfigDirty(true));

  // ── Print log ─────────────────────────────────────────────────
  await refreshLog();
  setInterval(refreshLog, 3000);

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
  badgeBgToggle.checked = cfg.BADGE_USE_BACKGROUND === 'true';
  toggle.checked = cfg.AUTO_PRINT !== 'false';
  updateAutoPrintWarning(toggle.checked);

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
    newCfg.BADGE_USE_BACKGROUND = String(badgeBgToggle.checked);
    newCfg.AUTO_PRINT = String(toggle.checked);
    await window.api.setPrinter(select.value);
    window.api.setAutoPrint(toggle.checked);
    await window.api.saveConfig(newCfg);
    setConfigDirty(false);
    updateAutoPrintWarning(toggle.checked);
    startPollCountdown(parseInt(newCfg.POLL_INTERVAL) || 5);
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.textContent = 'Salvato!';
    setTimeout(() => { saveStatus.textContent = ''; }, 2500);
    checkStatus(); // refresh status bar after saving
  });

  // ── Clear checkins ────────────────────────────────────────────
  document.getElementById('clearCheckinsBtn').addEventListener('click', async () => {
    const ok = confirm('Sei sicuro di voler cancellare tutti i check-in effettuati?\nL\'operazione non è reversibile.');
    if (!ok) return;
    await window.api.clearCheckins();
    await refreshLog();
  });

  // ── Badge layout info ─────────────────────────────────────────
  async function refreshBadgeLayoutName() {
    const name = await window.api.getBadgeLayoutName();
    document.getElementById('badgeLayoutName').textContent = name || '—';
  }
  await refreshBadgeLayoutName();
  document.getElementById('updateBadgeLayoutBtn').addEventListener('click', async () => {
    const btn = document.getElementById('updateBadgeLayoutBtn');
    btn.disabled = true;
    btn.textContent = '…';
    await window.api.refreshBadgeCache();
    await refreshBadgeLayoutName();
    btn.textContent = 'Update';
    btn.disabled = false;
  });

  // ── API log auto-refresh ──────────────────────────────────────
  document.getElementById('apiLogErrorFilter').addEventListener('change', refreshApiLog);
  document.getElementById('apiLogHideDebug').addEventListener('change', refreshApiLog);
  setInterval(refreshApiLog, 2000);

  // ── Status bar ────────────────────────────────────────────────
  document.getElementById('statusRefreshBtn').addEventListener('click', checkStatus);
  checkStatus();
  setInterval(checkStatus, 30000); // auto-refresh every 30s
}

async function refreshLog() {
  const rows = await window.api.getLog();
  const tbody = document.querySelector('#logTable tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const printedFlag = r.printed
      ? '<span class="printed-flag printed-yes" title="Badge stampato">&#10003;</span>'
      : '<span class="printed-flag printed-no" title="Non stampato">&ndash;</span>';
    const ts = r.timestamp ? new Date(r.timestamp).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    tr.innerHTML = `<td>${r.id}</td><td>${ts}</td><td>${r.attendee_name || '—'}</td><td>${r.attendee_company || '—'}</td><td>${printedFlag}</td><td></td>`;
    const btnCell = tr.querySelector('td:last-child');

    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.title = 'Ristampa badge';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await window.api.reprintBadge(r.id, r.position_id);
        await refreshLog();
      } finally {
        btn.disabled = false;
      }
    });

    const previewBtn = document.createElement('button');
    previewBtn.className = 'icon-btn';
    previewBtn.title = 'Anteprima badge';
    previewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    previewBtn.addEventListener('click', async () => {
      previewBtn.disabled = true;
      try {
        await window.api.previewBadge(r.id, r.position_id);
      } finally {
        previewBtn.disabled = false;
      }
    });

    btnCell.appendChild(btn);
    btnCell.appendChild(previewBtn);
    tbody.appendChild(tr);
  });
}

async function refreshApiLog() {
  const errorsOnly = document.getElementById('apiLogErrorFilter')?.checked;
  const hideDebug  = document.getElementById('apiLogHideDebug')?.checked;
  let rows = await window.api.getApiLog();
  if (errorsOnly) rows = rows.filter(r => !r.ok);
  if (hideDebug)  rows = rows.filter(r => !r.debug);
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
