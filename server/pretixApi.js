const axios = require('axios');
const { getConfig } = require('./config');

const BASE = 'https://pretix.eu/api/v1';

// ── In-memory API log ─────────────────────────────────────────
const apiLog = [];
const MAX_LOG = 200;

function logCall(method, url, status, ok) {
  const endpoint = url.replace(BASE, '');
  const timestamp = new Date().toLocaleTimeString('it-IT');
  apiLog.unshift({ timestamp, method, endpoint, status, ok });
  if (apiLog.length > MAX_LOG) apiLog.length = MAX_LOG;
}

function getApiLog() { return apiLog; }

// ── API functions ─────────────────────────────────────────────
async function getBadgePDF(positionId) {
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/orderpositions/${positionId}/download/badge/`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Token ${TOKEN}` },
      responseType: 'arraybuffer'
    });
    logCall('GET', url, response.status, true);
    return response.data;
  } catch (err) {
    logCall('GET', url, err.response?.status ?? 0, false);
    throw err;
  }
}

async function getPositionDetails(positionId) {
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/orderpositions/${positionId}/`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Token ${TOKEN}` } });
    logCall('GET', url, res.status, true);
    const d = res.data;
    const name = d.attendee_name ||
      (d.attendee_name_parts
        ? [d.attendee_name_parts.given_name, d.attendee_name_parts.family_name].filter(Boolean).join(' ')
        : '—');
    return { name, order_code: d.order, secret: d.secret };
  } catch (err) {
    logCall('GET', url, err.response?.status ?? 0, false);
    throw err;
  }
}

// ── Badge layout + background cache ──────────────────────────
let _badgeLayoutCache = null;
let _backgroundBytesCache = null;

function clearBadgeLayoutCache() {
  _badgeLayoutCache = null;
  _backgroundBytesCache = null;
}

async function getDefaultBadgeLayout() {
  if (_badgeLayoutCache) return _badgeLayoutCache;
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/badgelayouts/`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Token ${TOKEN}` } });
    logCall('GET', url, res.status, true);
    const layouts = res.data.results || [];
    _badgeLayoutCache = layouts.find(l => l.default) || layouts[0] || null;
    return _badgeLayoutCache;
  } catch (err) {
    logCall('GET', url, err.response?.status ?? 0, false);
    return null;
  }
}

async function downloadBackground(backgroundUrl) {
  const { PRETIX_API_TOKEN: TOKEN } = getConfig();
  try {
    const res = await axios.get(backgroundUrl, {
      headers: { Authorization: `Token ${TOKEN}` },
      responseType: 'arraybuffer'
    });
    return Buffer.from(res.data);
  } catch (err) {
    console.error('Badge: impossibile scaricare il background:', err.message);
    return null;
  }
}

async function getCachedBackground(backgroundUrl) {
  if (_backgroundBytesCache) return _backgroundBytesCache;
  _backgroundBytesCache = await downloadBackground(backgroundUrl);
  return _backgroundBytesCache;
}

async function warmBadgeCache() {
  try {
    const layout = await getDefaultBadgeLayout();
    if (layout && layout.background && typeof layout.background === 'string') {
      await getCachedBackground(layout.background);
    }
    console.log('Badge cache pronta.');
  } catch (err) {
    console.error('Warm badge cache fallito:', err.message);
  }
}

function getBadgeLayoutName() {
  return _badgeLayoutCache?.name || null;
}

async function refreshBadgeCache() {
  clearBadgeLayoutCache();
  await warmBadgeCache();
  return getBadgeLayoutName();
}

async function checkStatus() {
  const { PRETIX_API_TOKEN: token, PRETIX_ORGANIZER: org, PRETIX_EVENT: event } = getConfig();

  if (!token || !org) return { api: false, organizer: false, event: false };

  const orgUrl = `${BASE}/organizers/${org}/`;
  try {
    const res = await axios.get(orgUrl, {
      headers: { Authorization: `Token ${token}` },
      timeout: 5000
    });
    logCall('GET', orgUrl, res.status, true);
  } catch (err) {
    const status = err.response?.status;
    logCall('GET', orgUrl, status ?? 0, false);
    if (status === 401 || status === 403) return { api: false, organizer: false, event: false };
    if (status === 404) return { api: true, organizer: false, event: false };
    return { api: false, organizer: false, event: false };
  }

  if (!event) return { api: true, organizer: true, event: false };

  const eventUrl = `${BASE}/organizers/${org}/events/${event}/`;
  try {
    const res = await axios.get(eventUrl, {
      headers: { Authorization: `Token ${token}` },
      timeout: 5000
    });
    logCall('GET', eventUrl, res.status, true);
    return { api: true, organizer: true, event: true };
  } catch (err) {
    logCall('GET', eventUrl, err.response?.status ?? 0, false);
    return { api: true, organizer: true, event: false };
  }
}

async function getRecentCheckins(since) {
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/checkins/`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Token ${TOKEN}` },
      params: { datetime_since: since, ordering: 'datetime', type: 'entry' }
    });
    logCall('GET', url, response.status, true);
    return response.data.results;
  } catch (err) {
    logCall('GET', url, err.response?.status ?? 0, false);
    throw err;
  }
}

async function getOrganizers(token) {
  const results = [];
  let url = `${BASE}/organizers/`;
  while (url) {
    try {
      const res = await axios.get(url, { headers: { Authorization: `Token ${token}` } });
      logCall('GET', url, res.status, true);
      results.push(...res.data.results);
      url = res.data.next || null;
    } catch (err) {
      logCall('GET', url, err.response?.status ?? 0, false);
      throw err;
    }
  }
  return results.map(o => ({ slug: o.slug, name: o.name }));
}

async function getEvents(token, org) {
  const results = [];
  let url = `${BASE}/organizers/${org}/events/`;
  while (url) {
    try {
      const res = await axios.get(url, { headers: { Authorization: `Token ${token}` } });
      logCall('GET', url, res.status, true);
      results.push(...res.data.results);
      url = res.data.next || null;
    } catch (err) {
      logCall('GET', url, err.response?.status ?? 0, false);
      throw err;
    }
  }
  return results.map(e => {
    const name = typeof e.name === 'object' ? (Object.values(e.name)[0] || e.slug) : e.name;
    return { slug: e.slug, name };
  });
}

module.exports = { getPositionDetails, getDefaultBadgeLayout, getCachedBackground, warmBadgeCache, getBadgeLayoutName, refreshBadgeCache, clearBadgeLayoutCache, checkStatus, getRecentCheckins, getApiLog, getOrganizers, getEvents };
