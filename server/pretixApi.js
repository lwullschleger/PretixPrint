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
async function getTicketPDF(orderCode, positionId) {
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/orders/${orderCode}/positions/${positionId}/pdf/`;
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

module.exports = { getTicketPDF, checkStatus, getRecentCheckins, getApiLog };
