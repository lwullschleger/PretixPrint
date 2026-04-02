const CONFIG_KEYS = ['PRETIX_API_TOKEN', 'PRETIX_ORGANIZER', 'PRETIX_EVENT', 'POLL_INTERVAL'];

async function init() {

  // ── Tab navigation ────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
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
  select.addEventListener('change', () => window.api.setPrinter(select.value));

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
  toggle.addEventListener('change', () => window.api.setAutoPrint(toggle.checked));

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
    if (input) input.value = cfg[key] || '';
  });

  document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newCfg = {};
    CONFIG_KEYS.forEach(key => {
      const input = document.getElementById(`cfg-${key}`);
      if (input) newCfg[key] = input.value.trim();
    });
    await window.api.saveConfig(newCfg);
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.textContent = 'Salvato!';
    setTimeout(() => { saveStatus.textContent = ''; }, 2500);
    checkStatus(); // refresh status bar after saving
  });

  // ── Status bar ────────────────────────────────────────────────
  document.getElementById('statusRefreshBtn').addEventListener('click', checkStatus);
  checkStatus();
  setInterval(checkStatus, 30000); // auto-refresh every 30s
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
  el.querySelector('.status-label').textContent = label;
}

init();
