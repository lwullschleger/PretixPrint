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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [226, 150] });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', async () => {
      try {
        await downloadAndPrint(Buffer.concat(chunks));
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    doc.fontSize(16).text('Test Print', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Pretix Gate Print`, { align: 'center' });
    doc.text(new Date().toLocaleString(), { align: 'center' });
    doc.end();
  });
}

module.exports = { downloadAndPrint, setSelectedPrinter, getSelectedPrinter, testPrint };
