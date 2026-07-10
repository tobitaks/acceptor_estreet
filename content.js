const DASHBOARD_URL = 'https://estreetamc.spurams.com/AppraiserDashboard.aspx';

let lastCount = 0;          // detect count CHANGE
let lastExtractAt = 0;      // safety re-extract timer (catches same-count swaps)
let lastSessionAlarm = 0;   // throttle logged-out alarm
let lastHeartbeat = 0;      // 30-min alive stamp
const processedIds = new Set(); // ApprIDs already detected this session — never re-log/re-act

// --- Adaptive polling (anti-detection) -------------------------------------
// Volume-based bans (ValueLink-style) count requests/day. Poll SLOW by default,
// burst FAST while a bulk is actively landing.
//   NORMAL: user-configurable (Settings), default 20s — human-plausible refresh
//   FAST:   ~0.5s — grabs the rest of a bulk while it's hot; drops back to
//                   NORMAL after 3 min with no new order.
// No request cap on FAST: the daily ACCEPT limit (Settings) is the real ceiling —
// once it's hit the monitored tab closes and polling stops entirely.
const NORMAL_DEFAULT_SEC = 20;            // fallback if the setting is unset
const NORMAL_JITTER      = 5000;          // max ± jitter on the normal interval
const FAST_MS            = 500;           // base fast interval
const FAST_JITTER        = 100;           // → 400–600 ms
const FAST_LINGER_MS     = 3 * 60 * 1000; // stay fast 3 min after the last new order

let fastUntil = 0;                          // FAST while Date.now() < fastUntil
let normalMs  = NORMAL_DEFAULT_SEC * 1000;  // cached normal interval (from Settings)

// Load + live-update the normal interval from Settings (no reload needed).
chrome.storage.local.get('normalIntervalSec', ({ normalIntervalSec }) => {
  const s = parseInt(normalIntervalSec, 10);
  if (s > 0) normalMs = s * 1000;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.normalIntervalSec) {
    const s = parseInt(changes.normalIntervalSec.newValue, 10);
    if (s > 0) normalMs = s * 1000;
  }
});

function inFastMode() {
  return Date.now() < fastUntil;
}
function jitter(base, spread) {
  return base - spread + Math.floor(Math.random() * (2 * spread + 1));
}
function pollInterval() {
  if (inFastMode()) return jitter(FAST_MS, FAST_JITTER); // 400–600 ms
  const spread = Math.min(NORMAL_JITTER, Math.floor(normalMs * 0.25));
  return jitter(normalMs, spread);
}

function playAlarm() {
  chrome.runtime.sendMessage({ type: 'PLAY_AUDIO_ALERT' });
}

function extractInput(html, name) {
  const re = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<input[^>]*value="([^"]*)"[^>]*name="${name}"`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

// Direct POST postback — replaces MAIN-world __doPostBack + UpdatePanel DOM render wait
// (was up to 3000ms). Reuses viewstate from the dashboard HTML already fetched this tick,
// parses the grid straight from the response. No injection, no live-DOM wait.
async function extractNewOrders(dashHtml) {
  const viewState    = extractInput(dashHtml, '__VIEWSTATE');
  const viewStateGen = extractInput(dashHtml, '__VIEWSTATEGENERATOR');
  const eventValid   = extractInput(dashHtml, '__EVENTVALIDATION');
  if (!viewState) {
    console.warn('[eStreet] no __VIEWSTATE on dashboard');
    return [];
  }

  const params = new URLSearchParams();
  params.set('__EVENTTARGET', 'ctl00$cphBody$lnkShowNewOrders');
  params.set('__EVENTARGUMENT', '');
  params.set('__VIEWSTATE', viewState);
  if (viewStateGen) params.set('__VIEWSTATEGENERATOR', viewStateGen);
  if (eventValid)   params.set('__EVENTVALIDATION', eventValid);

  const res = await fetch(DASHBOARD_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: params.toString()
  });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const grid = doc.getElementById('ctl00_cphBody_grdNewOrders');

  const orders = [];
  const seen = new Set();

  if (grid) {
    const rows = grid.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) continue;
      const a = cells[0].querySelector('a[href*="ApprID="]');
      if (!a) continue;
      // getAttribute (not .href): parsed doc has no base URL, .href won't resolve reliably
      const href = a.getAttribute('href') || '';
      const m = href.match(/ApprID=(\d+)/);
      if (!m) continue;
      const apprId = m[1];
      if (seen.has(apprId)) continue;
      seen.add(apprId);
      const itemText = cells[3].textContent.replace(/\s+/g, ' ').trim();
      // full row text = everything in the row (incl address/city/state if eStreet
      // puts it in the grid) — used for the keyword filter
      const rowText = row.textContent.replace(/\s+/g, ' ').trim();
      orders.push({ apprId, itemText, rowText });
    }
  }

  // FALLBACK: grid parse found nothing (MS-AJAX delta response / layout change).
  // Regex ONLY the grdNewOrders table region — never the whole page: the dashboard
  // also lists order history with ApprID= links, and a whole-page regex once grabbed
  // 30 stale/own orders. If the grid region isn't in the response, there are no new
  // orders (count span was stale, e.g. right after our own accept) — return empty.
  // No itemText => filterOrdersByType only keeps these when filter is 'both'
  // (exterior/interior can't be classified without the type cell, so they're skipped — safe).
  if (orders.length === 0) {
    const gridRegion = html.match(/grdNewOrders[\s\S]*?<\/table>/i);
    if (gridRegion) {
      const ids = [...new Set([...gridRegion[0].matchAll(/ApprID=(\d+)/g)].map(m => m[1]))];
      if (ids.length) {
        console.warn(`[eStreet] grid parse empty — regex fallback found ${ids.length} id(s) in grid region:`, ids);
        for (const apprId of ids) orders.push({ apprId, itemText: '', fromFallback: true });
      }
    } else {
      console.warn('[eStreet] grdNewOrders not in postback response — stale count, no new orders');
    }
  }

  return orders;
}

function filterOrdersByType(orders, acceptType) {
  return orders.filter(o => {
    const t = o.itemText.toLowerCase();
    const isExt = /exterior/.test(t);
    const isInt = /interior/.test(t);
    if (acceptType === 'exterior') return isExt;
    if (acceptType === 'interior') return isInt;
    return true; // 'both' = accept all order types (incl VS)
  });
}

// Keyword filter on full row text (city/state/address/anything in the grid row).
// Comma-separated, match-ANY, case-insensitive. Blank = accept all (no filter).
// WHOLE-WORD match (\b…\b): keyword "GA" matches the state token "GA" but NOT
// "CHATTANOOGA" — stops 2-letter state codes (CA/OR/PA/GA) colliding with city
// substrings. Multi-word keywords ("LONG BEACH") still match as a phrase.
// Orders with no rowText (regex fallback) are DROPPED when a keyword is set —
// can't verify match without the row, safer to skip than blind-accept.
function filterByKeyword(orders, keywordFilter) {
  const kws = (keywordFilter || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!kws.length) return orders;
  const matchers = kws.map(k => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex metachars
    return new RegExp(`\\b${esc}\\b`, 'i');
  });
  return orders.filter(o => {
    const hay = o.rowText || '';
    if (!hay) return false; // fallback order, no row text — skip when filtering
    return matchers.some(re => re.test(hay));
  });
}

// Reverse keyword filter (BLOCKLIST): DROP any order whose row matches ANY keyword.
// Same matching as filterByKeyword — whole-word, case-insensitive, comma-separated,
// match-ANY. Blank = no exclusions. Runs AFTER the include keyword filter.
// Orders with no rowText (regex fallback) can't be checked — KEPT (not excluded),
// the inverse of the include filter: we only drop on a proven match.
function filterByExcludeKeyword(orders, excludeFilter) {
  const kws = (excludeFilter || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!kws.length) return orders;
  const matchers = kws.map(k => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i');
  });
  return orders.filter(o => {
    const hay = o.rowText || '';
    if (!hay) return true; // can't verify match — don't exclude
    return !matchers.some(re => re.test(hay));
  });
}

function extensionAlive() {
  return !!chrome.runtime?.id;
}

async function checkOrders() {
  if (!extensionAlive()) {
    console.warn('[eStreet] extension reloaded — stopping. Refresh page to resume.');
    return;
  }
  try {
    const res = await fetch(DASHBOARD_URL, {
      credentials: 'include'
    });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const span = doc.getElementById('ctl00_cphBody_lblShowNewOrders');
    const sessionLost = !span;
    const count = span ? parseInt(span.textContent.trim(), 10) : 0;
    const lastChecked = new Date().toISOString();
    console.log(`Orders: ${count}`);

    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', count, lastChecked, sessionLost });

    // Heartbeat: stamp "alive" every 30 min so that after a hang/restart the last
    // entry shows roughly when polling stopped. Fires regardless of count/sessionLost.
    if (Date.now() - lastHeartbeat >= 30 * 60 * 1000) {
      lastHeartbeat = Date.now();
      const { heartbeatLog = [] } = await chrome.storage.local.get('heartbeatLog');
      heartbeatLog.unshift({ timestamp: lastChecked, count, sessionLost });
      if (heartbeatLog.length > 20) heartbeatLog.length = 20; // ~10 hrs
      await chrome.storage.local.set({ heartbeatLog });
      console.log(`[eStreet] heartbeat @ ${lastChecked}`);
    }

    if (sessionLost) {
      // Count span missing from dashboard response = almost certainly logged out
      // (fetch followed redirect to login page). Alarm so unattended monitoring
      // doesn't die silently. Throttled to once per 60s.
      if (Date.now() - lastSessionAlarm > 60000) {
        lastSessionAlarm = Date.now();
        console.warn('[eStreet] count span missing — logged out? Re-login in the tab.');
        playAlarm();
      }
    } else if (count > 0 && (count !== lastCount || Date.now() - lastExtractAt > 60000)) {
      // Extract only when the count CHANGES (or a 60s safety pass for same-count
      // swaps). Then act ONLY on ApprIDs not seen before — a filtered-out order
      // (wrong city/type) keeps count > 0 but is already in processedIds, so it's
      // not re-logged or re-processed. Stops the log spam + needless postbacks.
      lastExtractAt = Date.now();
      const orders = await extractNewOrders(html);
      const newOrders = orders.filter(o => !processedIds.has(o.apprId));

      if (newOrders.length) {
        newOrders.forEach(o => processedIds.add(o.apprId));
        // New ApprID(s) → burst to FAST to catch the rest of the bulk.
        // Timer resets on every new order, chaining a cluster together.
        fastUntil = Date.now() + FAST_LINGER_MS;
        if (count > lastCount) playAlarm(); // alarm only on genuine arrivals
        const { acceptType = 'exterior', keywordFilter = '', excludeFilter = '', acceptChance = 100 } =
          await chrome.storage.local.get(['acceptType', 'keywordFilter', 'excludeFilter', 'acceptChance']);
        const filtered = filterByExcludeKeyword(
          filterByKeyword(filterOrdersByType(newOrders, acceptType), keywordFilter),
          excludeFilter
        );

        // Per-order coin toss: accept ~acceptChance%, skip the rest (camouflage —
        // a real appraiser doesn't grab 100% of orders). Skipped orders are already
        // in processedIds (added above), so they're never re-rolled — gone for good.
        // acceptChance default 100 = accept everything (no skipping unless user lowers it).
        const toAccept = [];
        const coinSkipped = [];
        for (const o of filtered) {
          if (Math.random() * 100 < acceptChance) toAccept.push(o);
          else coinSkipped.push(o);
        }

        chrome.runtime.sendMessage({
          type: 'LOG_DETECTION',
          count,
          orders: newOrders,
          filtered,
          coinSkipped,
          acceptType
        });
        if (coinSkipped.length) {
          chrome.runtime.sendMessage({ type: 'LOG_SKIPPED', orders: coinSkipped });
        }
        if (toAccept.length) {
          chrome.runtime.sendMessage({ type: 'AUTO_ACCEPT_IDS', orders: toAccept });
        }
      }
    }

    // Cap processedIds so a long session doesn't grow it unbounded
    if (processedIds.size > 500) {
      const trimmed = [...processedIds].slice(-300);
      processedIds.clear();
      trimmed.forEach(id => processedIds.add(id));
    }

    lastCount = count;
  } catch (e) {
    if (e?.message?.includes('Extension context invalidated')) {
      console.warn('[eStreet] extension reloaded — stopping. Refresh page to resume.');
      return;
    }
    if (e?.message === 'Failed to fetch') {
      // Transient: tab suspended, network blip, or session expired. Skip & retry next tick.
      console.warn('[eStreet] fetch failed (transient), retrying next tick');
    } else {
      console.error('[eStreet] error:', e);
    }
  }

  setTimeout(checkOrders, pollInterval());
}

setTimeout(checkOrders, 1500);
