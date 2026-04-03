const { downloadAndPrint } = require('./printer');
const { logPrint } = require('./db');
const { getPositionDetails, getDefaultBadgeLayout, downloadBackground, getRecentCheckins } = require('./pretixApi');
const { renderBadge } = require('./badgeRenderer');
const { getConfig } = require('./config');

let autoPrint = true;
let lastPollTime = new Date().toISOString();
let pollTimer = null;

function startPolling() {
  const intervalMs = (parseInt(getConfig().POLL_INTERVAL) || 5) * 1000;
  pollTimer = setInterval(async () => {
    const since = lastPollTime;
    const now = new Date().toISOString();
    try {
      const checkins = await getRecentCheckins(since);
      lastPollTime = now;
      for (const checkin of checkins) {
        if (!autoPrint) continue;
        const details = await getPositionDetails(checkin.position);
        const cfg = getConfig();
        const useBackground = cfg.BADGE_USE_BACKGROUND === 'true';
        const layout = await getDefaultBadgeLayout();
        let backgroundBytes = null;
        if (useBackground && layout && layout.background && typeof layout.background === 'string') {
          backgroundBytes = await downloadBackground(layout.background);
        }
        const values = {
          attendee_name: details.name,
          order_code:    details.order_code || checkin.order,
          secret:        details.secret || ''
        };
        const pdfBuffer = await renderBadge(layout ? layout.layout : [], backgroundBytes, values);
        await downloadAndPrint(pdfBuffer);
        logPrint({ order: checkin.order, positionid: checkin.position, name: details.name, timestamp: checkin.datetime });
      }
    } catch (err) {
      console.error('Polling error:', err.message);
    }
  }, intervalMs);
  console.log(`Polling check-in ogni ${intervalMs / 1000}s`);
}

startPolling();

module.exports = { setAutoPrint: (v) => { autoPrint = v; } };
