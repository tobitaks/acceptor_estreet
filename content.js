const DASHBOARD_URL = 'https://estreetamc.spurams.com/AppraiserDashboard.aspx';

let alerted = false;

function pollInterval() {
  // 200-300ms jitter: faster detection than fixed 500ms, jitter avoids fixed-pattern fingerprint
  return 200 + Math.floor(Math.random() * 100);
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
      orders.push({ apprId, itemText });
    }
  }

  // FALLBACK: grid parse found nothing (MS-AJAX delta response / layout change).
  // Regex raw response for ApprID so we don't silently miss the order.
  // No itemText => filterOrdersByType only keeps these when filter is 'both'
  // (exterior/interior can't be classified without the type cell, so they're skipped — safe).
  if (orders.length === 0) {
    const ids = [...new Set([...html.matchAll(/ApprID=(\d+)/g)].map(m => m[1]))];
    if (ids.length) {
      console.warn(`[eStreet] grid parse empty — regex fallback found ${ids.length} id(s):`, ids);
      for (const apprId of ids) orders.push({ apprId, itemText: '', fromFallback: true });
    } else {
      console.warn('[eStreet] no ApprIDs in postback response (grid + regex both empty)');
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
    const count = span ? parseInt(span.textContent.trim(), 10) : 0;
    const lastChecked = new Date().toISOString();
    console.log(`Orders: ${count}`);

    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', count, lastChecked });

    if (count > 0 && !alerted) {
      alerted = true;
      playAlarm();
      const orders = await extractNewOrders(html);
      const { acceptType = 'both' } = await chrome.storage.local.get('acceptType');
      const filtered = filterOrdersByType(orders, acceptType);
      chrome.runtime.sendMessage({
        type: 'LOG_DETECTION',
        count,
        orders,
        filtered,
        acceptType
      });
      if (filtered.length) {
        chrome.runtime.sendMessage({ type: 'AUTO_ACCEPT_IDS', orders: filtered });
      }
    }

    if (count === 0) {
      alerted = false;
    }
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
