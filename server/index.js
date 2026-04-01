const express = require('express');
const { downloadAndPrint } = require('./printer');
const { logPrint } = require('./db');
const { getTicketPDF } = require('./pretixApi');

const app = express();
app.use(express.json());

let autoPrint = true;

app.post('/webhook', async (req, res) => {
  const body = req.body;
  // pretix sends checkin event data
  const order = body?.checkin?.order;
  const positionid = body?.checkin?.positionid;

  if (!order) return res.sendStatus(400);
  if (!autoPrint) return res.sendStatus(200); // auto-print disabled

  try {
    const pdfBuffer = await getTicketPDF(order, positionid);
    await downloadAndPrint(pdfBuffer);
    logPrint({ order, positionid, timestamp: new Date().toISOString() });
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(process.env.WEBHOOK_PORT || 3000);
module.exports = { setAutoPrint: (v) => { autoPrint = v; } };
