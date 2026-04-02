const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const configPath = path.join(dataDir, 'config.json');

const KEYS = ['PRETIX_API_TOKEN', 'PRETIX_ORGANIZER', 'PRETIX_EVENT', 'POLL_INTERVAL'];

// Returns merged config: data/config.json takes priority over process.env (from .env)
function getConfig() {
  let stored = {};
  if (fs.existsSync(configPath)) {
    try { stored = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  }
  const result = {};
  for (const key of KEYS) {
    result[key] = stored[key] !== undefined ? stored[key] : (process.env[key] || '');
  }
  return result;
}

// Persists config to data/config.json and updates process.env immediately
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  for (const [k, v] of Object.entries(cfg)) {
    process.env[k] = v;
  }
}

module.exports = { getConfig, saveConfig };
