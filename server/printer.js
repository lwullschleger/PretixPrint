const { print } = require('pdf-to-printer');
const { getConfig } = require('./config');
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

// Build pdf-to-printer options from the selected printer plus the print
// settings. `override` (used by the Test Print with the not-yet-saved dropdown
// values) takes priority; otherwise the values saved in config are used. Unset
// values are omitted so the printer's own default is used (backward compatible).
function buildPrintOptions(override) {
  const cfg = getConfig();
  const printer     = override?.printer || selectedPrinter;
  const paperSize   = override?.paperSize   ?? cfg.PRINT_PAPER_SIZE;
  const scale       = override?.scale       ?? cfg.PRINT_SCALE;
  const orientation = override?.orientation ?? cfg.PRINT_ORIENTATION;
  const options = {};
  if (printer)   options.printer   = printer;
  if (paperSize) options.paperSize = paperSize;
  if (scale)     options.scale     = scale;
  if (orientation && orientation !== 'auto') options.orientation = orientation;
  return options;
}

async function downloadAndPrint(pdfBuffer, override) {
  const tmpPath = path.join(os.tmpdir(), `ticket_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, Buffer.from(pdfBuffer));

  await print(tmpPath, buildPrintOptions(override));

  fs.unlinkSync(tmpPath);
}

module.exports = { downloadAndPrint, setSelectedPrinter, getSelectedPrinter };
