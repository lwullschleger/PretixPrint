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
    attendee_name:               details.name,
    'attendee_name:given_name':  details.first_name,
    'attendee_name:family_name': details.last_name,
    attendee_company:            details.attendee_company,
    attendee_email:              details.attendee_email,
    order_code:                  details.order_code || order,
    secret:                      details.secret
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
    // Snapshot config at the start of this tick to detect mid-cycle changes
    const { PRETIX_ORGANIZER: pollOrg, PRETIX_EVENT: pollEvent } = getConfig();
    try {
      const checkins = await getRecentCheckins(since);
      lastPollTime = now;
      for (const checkin of checkins) {
        // Verify config hasn't changed since the API call was made
        const { PRETIX_ORGANIZER: curOrg, PRETIX_EVENT: curEvent } = getConfig();
        if (curOrg !== pollOrg || curEvent !== pollEvent) {
          console.warn('Configurazione evento cambiata durante il polling — check-in ignorati.');
          break;
        }

        let details = null;
        try {
          details = await getPositionDetails(checkin.position);
        } catch (err) {
          console.error(`Errore dettagli check-in [${checkin.order}]:`, err.message);
        }

        // Always log immediately
        const logId = logPrint({ order: checkin.order, positionid: checkin.position, timestamp: checkin.datetime, details });

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
