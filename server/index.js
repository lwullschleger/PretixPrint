const { downloadAndPrint } = require('./printer');
const { logPrint, markPrinted } = require('./db');
const { getPositionDetails, getDefaultBadgeLayout, getCachedBackground, getRecentCheckins } = require('./pretixApi');
const { renderBadge } = require('./badgeRenderer');
const { getConfig } = require('./config');

let autoPrint = getConfig().AUTO_PRINT !== 'false';
let lastPollTime = new Date().toISOString();
let pollTimer = null;

async function generateBadgePdf(order, details) {
  const cfg = getConfig();
  const showBackground = cfg.BADGE_USE_BACKGROUND === 'true';
  const layout = await getDefaultBadgeLayout();
  // Always download background (even if not shown) to get correct page dimensions
  let backgroundBytes = null;
  if (layout && layout.background && typeof layout.background === 'string') {
    backgroundBytes = await getCachedBackground(layout.background);
  }
  const values = {
    attendee_name: details.name,
    order_code:    details.order_code || order,
    secret:        details.secret || ''
  };
  return renderBadge(layout ? layout.layout : [], backgroundBytes, values, showBackground);
}

async function printBadge(checkin, details, logId) {
  try {
    const pdfBuffer = await generateBadgePdf(checkin.order, details);
    await downloadAndPrint(pdfBuffer);
    markPrinted(logId);
  } catch (err) {
    console.error(`Errore stampa badge [${checkin.order}]:`, err.message);
  }
}

async function reprintPosition(logId, positionId) {
  const details = await getPositionDetails(positionId);
  const pdfBuffer = await generateBadgePdf('', details);
  await downloadAndPrint(pdfBuffer);
  markPrinted(logId);
}

async function previewPosition(positionId) {
  const details = await getPositionDetails(positionId);
  return generateBadgePdf('', details);
}

function startPolling() {
  const intervalMs = (parseInt(getConfig().POLL_INTERVAL) || 5) * 1000;
  pollTimer = setInterval(async () => {
    const since = lastPollTime;
    const now = new Date().toISOString();
    try {
      const checkins = await getRecentCheckins(since);
      lastPollTime = now;
      for (const checkin of checkins) {
        let attendeeName = '—';
        let details = null;
        try {
          details = await getPositionDetails(checkin.position);
          attendeeName = details.name;
        } catch (err) {
          console.error(`Errore dettagli check-in [${checkin.order}]:`, err.message);
        }

        // Always log immediately
        const logId = logPrint({ order: checkin.order, positionid: checkin.position, name: attendeeName, timestamp: checkin.datetime });

        // Print badge in background if auto-print is active
        if (autoPrint && details) {
          printBadge(checkin, details, logId);
        }
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }
  }, intervalMs);
  console.log(`Polling check-in ogni ${intervalMs / 1000}s`);
}

startPolling();

module.exports = { setAutoPrint: (v) => { autoPrint = v; }, reprintPosition, previewPosition };
