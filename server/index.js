const express = require('express');
const crypto = require('crypto');
const { downloadAndPrint } = require('./printer');
const { logPrint } = require('./db');
const { getTicketPDF } = require('./pretixApi');

const app = express();

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

let autoPrint = true;

function verifySignature(req) {
  const secret = process.env.PRETIX_WEBHOOK_SECRET;
  if (!secret) return true; // non configurato, skip
  const signature = req.headers['x-pretix-signature'];
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(401);

  const body = req.body;
  const order = body?.checkin?.order;
  const positionid = body?.checkin?.positionid;

  if (!order) return res.sendStatus(400);
  if (!autoPrint) return res.sendStatus(200);

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

app.listen(process.env.WEBHOOK_PORT || 3000, () => {
  console.log(`Webhook server listening on port ${process.env.WEBHOOK_PORT || 3000}`);
});

module.exports = { setAutoPrint: (v) => { autoPrint = v; } };
