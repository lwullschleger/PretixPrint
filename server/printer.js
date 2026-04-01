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

module.exports = { downloadAndPrint, setSelectedPrinter, getSelectedPrinter };
