async function init() {
  // Load printers
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

  // Test print button
  const btn = document.getElementById('testPrintBtn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Printing...';
    try {
      await window.api.testPrint();
      btn.textContent = 'Done!';
    } catch {
      btn.textContent = 'Failed';
    }
    setTimeout(() => { btn.textContent = 'Test Print'; btn.disabled = false; }, 2000);
  });

  // Auto-print toggle
  const toggle = document.getElementById('autoPrintToggle');
  toggle.addEventListener('change', () => window.api.setAutoPrint(toggle.checked));

  // Load log
  const rows = await window.api.getLog();
  const tbody = document.querySelector('#logTable tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td>${r.order_code}</td><td>${r.position_id}</td><td>${r.timestamp}</td>`;
    tbody.appendChild(tr);
  });
}

init();
