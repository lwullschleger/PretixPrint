const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'prints.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS prints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT,
    position_id TEXT,
    timestamp TEXT
  )
`);

function logPrint({ order, positionid, timestamp }) {
  db.prepare(`
    INSERT INTO prints (order_code, position_id, timestamp)
    VALUES (?, ?, ?)
  `).run(order, positionid, timestamp);
}

function getRecentPrints(limit = 50) {
  return db.prepare(`
    SELECT * FROM prints ORDER BY id DESC LIMIT ?
  `).all(limit);
}

module.exports = { logPrint, getRecentPrints };
