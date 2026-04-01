const axios = require('axios');
require('dotenv').config();

const BASE = 'https://pretix.eu/api/v1';
const ORG = process.env.PRETIX_ORGANIZER;
const EVENT = process.env.PRETIX_EVENT;
const TOKEN = process.env.PRETIX_API_TOKEN;

async function getTicketPDF(orderCode, positionId) {
  const url = `${BASE}/organizers/${ORG}/events/${EVENT}/orders/${orderCode}/positions/${positionId}/pdf/`;
  const response = await axios.get(url, {
    headers: { Authorization: `Token ${TOKEN}` },
    responseType: 'arraybuffer'
  });
  return response.data; // PDF buffer
}

module.exports = { getTicketPDF };
