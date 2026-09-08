const { downloadAndPrint } = require('./printer');
const { logPrint, markPrinted } = require('./db');
const { getPositionDetails, getDefaultBadgeLayout, getCachedBackground, getRecentCheckins } = require('./pretixApi');
const { renderBadge } = require('./badgeRenderer');
const { getConfig } = require('./config');

let autoPrint = getConfig().AUTO_PRINT !== 'false';
let lastPollTime = new Date().toISOString();
let pollTimer = null;

// Polling state: suspended on auth/config errors (401/403/404) until the
// config is saved again; transient network errors are logged only on the
// OK→error transition to avoid one popup per tick.
let pollSuspended = false;
let waitingForConfigLogged = false;
let networkErrorActive = false;

function resumePolling() {
  pollSuspended = false;
  waitingForConfigLogged = false;
  networkErrorActive = false;
}

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

// Test print: render the real badge layout with sample data, so the printout
// matches the actual badge format/size. `override` carries the current (not yet
// saved) print settings from the Config dropdowns (printer, paper size, scale…).
async function testPrintBadge(override) {
  const sample = {
    name:             'Mario Rossi',
    first_name:       'Mario',
    last_name:        'Rossi',
    attendee_company: 'ACME S.r.l.',
    attendee_email:   'mario.rossi@example.com',
    order_code:       'TEST01',
    secret:           'TEST-BADGE-0000'
  };
  const pdfBuffer = await generateBadgePdf('TEST01', sample);
  await downloadAndPrint(pdfBuffer, override);
}

function startPolling() {
  const intervalMs = (parseInt(getConfig().POLL_INTERVAL) || 5) * 1000;
  pollTimer = setInterval(async () => {
    // Snapshot config at the start of this tick to detect mid-cycle changes
    const { PRETIX_API_TOKEN: pollToken, PRETIX_ORGANIZER: pollOrg, PRETIX_EVENT: pollEvent } = getConfig();

    // Incomplete config: skip silently (resumes on its own once configured)
    if (!pollToken || !pollOrg || !pollEvent) {
      if (!waitingForConfigLogged) {
        console.log('Polling in attesa di configurazione (token/organizer/evento mancanti).');
        waitingForConfigLogged = true;
      }
      return;
    }
    waitingForConfigLogged = false;

    // Suspended after an auth/config error: wait for the config to be saved again
    if (pollSuspended) return;

    const since = lastPollTime;
    const now = new Date().toISOString();
    try {
      const checkins = await getRecentCheckins(since);
      if (networkErrorActive) {
        console.log('Polling ripristinato: connessione a Pretix di nuovo attiva.');
        networkErrorActive = false;
      }
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
        const { id: logId, printed } = logPrint({ order: checkin.order, positionid: checkin.position, timestamp: checkin.datetime, details });

        // Print badge in background only if auto-print is active AND this
        // badge hasn't been printed yet (avoids duplicates on rescans).
        // A previously failed print keeps printed=false, so it retries.
        if (autoPrint && details && !printed) {
          printBadge(checkin, details, logId);
        }
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403 || status === 404) {
        // Auth/config error: report once and suspend until the config is saved again
        pollSuspended = true;
        console.error(`Polling sospeso: errore di accesso a Pretix (HTTP ${status}). Verifica token, organizer ed evento nella configurazione.`);
      } else if (!networkErrorActive) {
        // Transient error (network, timeout, 5xx): log only on state change, keep retrying
        networkErrorActive = true;
        console.error('Polling error:', err.message);
      }
    }
  }, intervalMs);
  console.log(`Polling check-in ogni ${intervalMs / 1000}s`);
}

startPolling();

module.exports = { setAutoPrint: (v) => { autoPrint = v; }, reprintPosition, previewPosition, testPrintBadge, resumePolling };
