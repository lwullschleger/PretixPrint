const axios = require('axios');
const { getConfig } = require('./config');

const BASE = 'https://pretix.eu/api/v1';

async function getTicketPDF(orderCode, positionId) {
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/orders/${orderCode}/positions/${positionId}/pdf/`;
  const response = await axios.get(url, {
    headers: { Authorization: `Token ${TOKEN}` },
    responseType: 'arraybuffer'
  });
  return response.data;
}

async function checkStatus() {
  const { PRETIX_API_TOKEN: token, PRETIX_ORGANIZER: org, PRETIX_EVENT: event } = getConfig();

  if (!token || !org) return { api: false, organizer: false, event: false };

  try {
    await axios.get(`${BASE}/organizers/${org}/`, {
      headers: { Authorization: `Token ${token}` },
      timeout: 5000
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return { api: false, organizer: false, event: false };
    if (status === 404) return { api: true, organizer: false, event: false };
    return { api: false, organizer: false, event: false };
  }

  if (!event) return { api: true, organizer: true, event: false };

  try {
    await axios.get(`${BASE}/organizers/${org}/events/${event}/`, {
      headers: { Authorization: `Token ${token}` },
      timeout: 5000
    });
    return { api: true, organizer: true, event: true };
  } catch {
    return { api: true, organizer: true, event: false };
  }
}

async function getRecentCheckins(since) {
  const { PRETIX_ORGANIZER: ORG, PRETIX_EVENT: EVENT, PRETIX_API_TOKEN: TOKEN } = getConfig();
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/checkins/`;
  const response = await axios.get(url, {
    headers: { Authorization: `Token ${TOKEN}` },
    params: { datetime_since: since, ordering: 'datetime', type: 'entry' }
  });
  return response.data.results;
}

module.exports = { getTicketPDF, checkStatus, getRecentCheckins };
