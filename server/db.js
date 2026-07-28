const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'checkins.json');

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

function logPrint({ order, positionid, timestamp, details }) {
  const records = readAll();
  const existing = records.find(r => r.position_id === positionid);
  if (existing) {
    // Rescan of an already-known ticket: refresh data but PRESERVE the
    // printed state so an already-printed badge is not printed again.
    existing.timestamp        = timestamp;
    existing.order_code       = order;
    existing.attendee_name    = details?.name             || existing.attendee_name;
    existing.first_name       = details?.first_name       ?? existing.first_name;
    existing.last_name        = details?.last_name        ?? existing.last_name;
    existing.attendee_company = details?.attendee_company ?? existing.attendee_company;
    existing.attendee_email   = details?.attendee_email   ?? existing.attendee_email;
    existing.secret           = details?.secret           ?? existing.secret;
    writeAll(records);
    return { id: existing.id, printed: existing.printed };
  }
  const id = records.length > 0 ? records[records.length - 1].id + 1 : 1;
  records.push({
    id,
    position_id:      positionid,
    order_code:       order,
    timestamp,
    printed:          false,
    attendee_name:    details?.name             || '—',
    first_name:       details?.first_name       || '',
    last_name:        details?.last_name        || '',
    attendee_company: details?.attendee_company || '',
    attendee_email:   details?.attendee_email   || '',
    secret:           details?.secret           || ''
  });
  writeAll(records);
  return { id, printed: false };
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

function clearCheckins() {
  writeAll([]);
}

module.exports = { logPrint, markPrinted, getRecentPrints, clearCheckins };
