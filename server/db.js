const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, 'prints.json');

function readAll() {
  if (!fs.existsSync(dbPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(records) {
  fs.writeFileSync(dbPath, JSON.stringify(records, null, 2));
}

function logPrint({ order, positionid, name, timestamp }) {
  const records = readAll();
  const id = records.length > 0 ? records[records.length - 1].id + 1 : 1;
  records.push({ id, attendee_name: name || '—', order_code: order, position_id: positionid, timestamp, printed: false });
  writeAll(records);
  return id;
}

function markPrinted(id) {
  const records = readAll();
  const rec = records.find(r => r.id === id);
  if (rec) { rec.printed = true; writeAll(records); }
}

function getRecentPrints(limit = 50) {
  const records = readAll();
  return records.slice(-limit).reverse();
}

module.exports = { logPrint, markPrinted, getRecentPrints };
