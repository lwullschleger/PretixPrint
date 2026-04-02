const { print } = require('pdf-to-printer');
const fs = require('fs');
const path = require('path');
const os = require('os');

let selectedPrinter = null;

function setSelectedPrinter(name) {
  selectedPrinter = name;
}

function getSelectedPrinter() {
  return selectedPrinter;
}

async function downloadAndPrint(pdfBuffer) {
  const tmpPath = path.join(os.tmpdir(), `ticket_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, Buffer.from(pdfBuffer));

  const options = selectedPrinter ? { printer: selectedPrinter } : {};
  await print(tmpPath, options);

  fs.unlinkSync(tmpPath);
}

async function testPrint() {
  const PDFDocument = require('pdfkit');
  const { getConfig } = require('./config');
  const { checkStatus } = require('./pretixApi');

  const cfg = getConfig();
  let status = { api: false, organizer: false, event: false };
  try { status = await checkStatus(); } catch {}

  return new Promise((resolve, reject) => {
    const W = 255; // ~90mm width
    const doc = new PDFDocument({ size: [W, 175], margin: 14 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', async () => {
      try {
        await downloadAndPrint(Buffer.concat(chunks));
        resolve();
      } catch (err) { reject(err); }
    });

    const separator = () => {
      doc.moveDown(0.3);
      doc.moveTo(14, doc.y).lineTo(W - 14, doc.y).lineWidth(0.5).stroke();
      doc.moveDown(0.3);
    };

    const statusTag = ok => ok ? '[  OK  ]' : '[  --  ]';

    // ── Titolo ───────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold')
       .text('PRETIX PRINT SERVICE', { align: 'center' });
    doc.fontSize(7).font('Helvetica')
       .text('Pagina di test', { align: 'center' });

    separator();

    // ── Configurazione ───────────────────────────────
    doc.fontSize(7).font('Helvetica-Bold').text('CONFIGURAZIONE');
    doc.fontSize(7).font('Helvetica');
    doc.text(`Organizer : ${cfg.PRETIX_ORGANIZER || '—'}`);
    doc.text(`Evento    : ${cfg.PRETIX_EVENT    || '—'}`);
    doc.text(`Polling   : ${cfg.POLL_INTERVAL   || '5'}s`);

    separator();

    // ── Stato connessione ────────────────────────────
    doc.fontSize(7).font('Helvetica-Bold').text('STATO CONNESSIONE');
    doc.fontSize(7).font('Helvetica');
    doc.text(`${statusTag(status.api)}       API Pretix`);
    doc.text(`${statusTag(status.organizer)} Organizer`);
    doc.text(`${statusTag(status.event)}     Evento`);

    separator();

    // ── Timestamp ────────────────────────────────────
    doc.fontSize(6).font('Helvetica')
       .text(new Date().toLocaleString('it-IT'), { align: 'center' });

    doc.end();
  });
}

module.exports = { downloadAndPrint, setSelectedPrinter, getSelectedPrinter, testPrint };
