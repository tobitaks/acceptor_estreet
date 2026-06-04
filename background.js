const DASHBOARD_URL = 'https://estreetamc.spurams.com/AppraiserDashboard.aspx';
const ACCEPT_URL_BASE = 'https://estreetamc.spurams.com/AcceptBroadcastAppraisal.aspx';

const attemptedApprIds = new Set();

function extractInput(html, name) {
  const re = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  // try value-before-name ordering
  const re2 = new RegExp(`<input[^>]*value="([^"]*)"[^>]*name="${name}"`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractApprIds(html) {
  const ids = [...html.matchAll(/ApprID=(\d+)/g)].map(m => m[1]);
  return [...new Set(ids)];
}

// DIAGNOSTIC: strip an HTML response to readable text + pull <title>.
// Used to capture WHY an accept lands on 'failed' (validation errors, required
// fields, session expiry, or the real success marker). Remove once flow verified.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

async function fetchNewOrdersHtml() {
  // GET dashboard for fresh viewstate
  const dashRes = await fetch(DASHBOARD_URL, { credentials: 'include' });
  const dashHtml = await dashRes.text();
  const viewState     = extractInput(dashHtml, '__VIEWSTATE');
  const viewStateGen  = extractInput(dashHtml, '__VIEWSTATEGENERATOR');
  const eventValid    = extractInput(dashHtml, '__EVENTVALIDATION');
  if (!viewState) throw new Error('no __VIEWSTATE on dashboard');

  // POST async UpdatePanel postback to load New Orders table
  const params = new URLSearchParams();
  params.set('ctl00$ScriptManager1', 'ctl00$cphBody$uPanel1|ctl00$cphBody$lnkShowNewOrders');
  params.set('__EVENTTARGET', 'ctl00$cphBody$lnkShowNewOrders');
  params.set('__EVENTARGUMENT', '');
  params.set('__VIEWSTATE', viewState);
  if (viewStateGen) params.set('__VIEWSTATEGENERATOR', viewStateGen);
  if (eventValid)   params.set('__EVENTVALIDATION', eventValid);

  const res = await fetch(DASHBOARD_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With': 'XMLHttpRequest',
      'Cache-Control': 'no-cache'
    },
    body: params.toString()
  });
  return res.text();
}

async function acceptOrder(apprId, itemText = '') {
  if (attemptedApprIds.has(apprId)) {
    console.log(`[eStreet bg] skip already-attempted ${apprId}`);
    return { apprId, skipped: true };
  }
  attemptedApprIds.add(apprId);

  const acceptUrl = `${ACCEPT_URL_BASE}?ApprID=${apprId}&Accept=asis`;

  const formRes = await fetch(acceptUrl, { credentials: 'include' });
  const formHtml = await formRes.text();
  const viewState    = extractInput(formHtml, '__VIEWSTATE');
  const viewStateGen = extractInput(formHtml, '__VIEWSTATEGENERATOR');
  const eventValid   = extractInput(formHtml, '__EVENTVALIDATION');

  // DIAGNOSTIC: capture the GET accept-page state before we POST
  const getDiag = {
    getStatus: formRes.status,
    getUrl: formRes.url,
    getRedirected: formRes.redirected,
    hadViewState: !!viewState,
    getTitle: extractTitle(formHtml),
    // list every form field name on the page — reveals required inputs we may be omitting
    getFields: [...formHtml.matchAll(/name="([^"]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i),
    getSnippet: htmlToText(formHtml).slice(0, 800)
  };

  if (/no longer available/i.test(formHtml)) {
    // Order taken before our GET — accept form not rendered (no btnSubmit).
    // POSTing the shell viewstate anyway lands on Error.aspx ("unexpected error")
    // and got mislabeled 'failed'. Classify correctly + skip the wasted POST.
    console.log(`[eStreet bg] unavailable ${apprId} (taken before GET)`);
    await logAccepted({
      apprId,
      itemText,
      status: formRes.status,
      finalUrl: formRes.url,
      success: false,
      outcome: 'unavailable',
      diag: { ...getDiag, note: 'order already taken at GET — POST skipped' },
      timestamp: new Date().toISOString()
    });
    return { apprId, status: formRes.status, finalUrl: formRes.url, success: false, outcome: 'unavailable' };
  }

  if (!viewState) {
    // No viewstate = accept page didn't render (session expired / redirect to login).
    // Log to UI instead of throwing silently so it shows in options Diag.
    console.warn(`[eStreet bg] no __VIEWSTATE on accept page for ${apprId}`, getDiag);
    await logAccepted({
      apprId,
      itemText,
      status: formRes.status,
      finalUrl: formRes.url,
      success: false,
      outcome: 'failed',
      diag: { ...getDiag, note: 'no __VIEWSTATE on accept page — POST never sent' },
      timestamp: new Date().toISOString()
    });
    return { apprId, status: formRes.status, finalUrl: formRes.url, success: false, outcome: 'failed' };
  }

  const params = new URLSearchParams();
  params.set('__EVENTTARGET', '');
  params.set('__EVENTARGUMENT', '');
  params.set('__VIEWSTATE', viewState);
  if (viewStateGen) params.set('__VIEWSTATEGENERATOR', viewStateGen);
  if (eventValid)   params.set('__EVENTVALIDATION', eventValid);
  params.set('ctl00$cphBody$btnSubmit', 'Accept Appraisal');

  const res = await fetch(acceptUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    redirect: 'follow'
  });
  const body = await res.text();
  const success = res.status === 200 && /ViewOrder\.aspx/i.test(res.url);
  const unavailable = /no longer available/i.test(body);
  const outcome = success ? 'accepted' : (unavailable ? 'unavailable' : 'failed');

  // DIAGNOSTIC: capture the POST result so we can see why 'failed' happens
  const diag = {
    ...getDiag,
    postStatus: res.status,
    postUrl: res.url,
    postRedirected: res.redirected,
    postTitle: extractTitle(body),
    postSnippet: htmlToText(body).slice(0, 1500)
  };

  console.log(`[eStreet bg] ${outcome} ${apprId} -> status ${res.status}, final url:`, res.url);
  if (outcome !== 'accepted') {
    console.warn(`[eStreet bg] NON-ACCEPT DIAG ${apprId}:`, diag);
  }

  await logAccepted({
    apprId,
    itemText,
    status: res.status,
    finalUrl: res.url,
    success,
    outcome,
    diag: outcome !== 'accepted' ? diag : undefined,
    timestamp: new Date().toISOString()
  });
  return { apprId, status: res.status, finalUrl: res.url, success, outcome };
}

async function logAccepted(entry) {
  const { acceptedLog = [] } = await chrome.storage.local.get('acceptedLog');
  acceptedLog.unshift(entry);
  // cap at 100 entries
  if (acceptedLog.length > 100) acceptedLog.length = 100;
  await chrome.storage.local.set({ acceptedLog });
}

async function logDetection(entry) {
  const { detectionLog = [] } = await chrome.storage.local.get('detectionLog');
  detectionLog.unshift(entry);
  if (detectionLog.length > 100) detectionLog.length = 100;
  await chrome.storage.local.set({ detectionLog });
}

async function autoAcceptAll() {
  try {
    console.log('[eStreet bg] fetching new orders table...');
    const tableHtml = await fetchNewOrdersHtml();
    console.log('[eStreet bg] response length:', tableHtml.length);
    console.log('[eStreet bg] response first 1500 chars:', tableHtml.slice(0, 1500));
    console.log('[eStreet bg] response last 500 chars:', tableHtml.slice(-500));
    const ids = extractApprIds(tableHtml);
    console.log('[eStreet bg] ApprIDs found:', ids);
    for (const id of ids) {
      try { await acceptOrder(id); }
      catch (e) { console.error(`[eStreet bg] accept ${id} failed:`, e); }
    }
    console.log('[eStreet bg] auto-accept run complete');
  } catch (e) {
    console.error('[eStreet bg] autoAcceptAll failed:', e);
  }
}

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play alarm sound when new orders are detected'
    });
  }
}

async function playAlarm() {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: 'PLAY_ALARM' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TRIGGER_NEW_ORDERS_POSTBACK' && sender.tab?.id) {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        // chrome.scripting wraps injected funcs in strict mode. ASP.NET MS AJAX
        // walks call stack via arguments.caller — any strict frame above
        // __doPostBack throws TypeError on .arguments access.
        // Fix: setTimeout schedules Function-created (non-strict) callback to
        // run on a fresh stack with NO strict ancestor frames.
        setTimeout(Function("__doPostBack('ctl00$cphBody$lnkShowNewOrders', '')"), 0);
      }
    }).then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }

  if (msg.type === 'START') {
    chrome.tabs.create({ url: DASHBOARD_URL, active: true }, (tab) => {
      chrome.storage.local.set({
        monitorState: { monitoring: true, tabId: tab.id, count: 0, lastChecked: null }
      });
    });
  }

  if (msg.type === 'STOP') {
    chrome.storage.local.get('monitorState', ({ monitorState }) => {
      if (monitorState?.tabId) {
        chrome.tabs.remove(monitorState.tabId, () => void chrome.runtime.lastError);
      }
      chrome.storage.local.set({
        monitorState: { monitoring: false, tabId: null, count: 0, lastChecked: null }
      });
    });
  }

  if (msg.type === 'STATUS_UPDATE') {
    chrome.storage.local.get('monitorState', ({ monitorState }) => {
      chrome.storage.local.set({
        monitorState: {
          ...monitorState,
          count: msg.count,
          lastChecked: msg.lastChecked
        }
      });
    });
  }

  if (msg.type === 'PLAY_AUDIO_ALERT') {
    console.log('[eStreet bg] play audio alarm');
    playAlarm();
  }

  if (msg.type === 'LOG_DETECTION') {
    logDetection({
      count: msg.count,
      orders: msg.orders || [],
      filtered: msg.filtered || [],
      acceptType: msg.acceptType,
      timestamp: new Date().toISOString()
    });
  }

  if (msg.type === 'AUTO_ACCEPT') {
    autoAcceptAll();
  }

  if (msg.type === 'AUTO_ACCEPT_IDS') {
    const list = Array.isArray(msg.orders) ? msg.orders
               : Array.isArray(msg.ids)    ? msg.ids.map(id => ({ apprId: id, itemText: '' }))
               : [];
    runBatchedAccepts(list, 10);
  }
});

async function runBatchedAccepts(list, batchSize) {
  console.log(`[eStreet bg] accepting ${list.length} order(s) in batches of ${batchSize}`);
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`[eStreet bg] batch ${batchNum} firing ${batch.length} parallel`);
    await Promise.allSettled(
      batch.map(o =>
        acceptOrder(o.apprId, o.itemText).catch(e => {
          console.error(`[eStreet bg] accept ${o.apprId} failed:`, e);
          throw e;
        })
      )
    );
  }
  console.log('[eStreet bg] all batches complete');
}

// If user manually closes the monitored tab, reset state
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get('monitorState', ({ monitorState }) => {
    if (monitorState?.tabId === tabId) {
      chrome.storage.local.set({
        monitorState: { monitoring: false, tabId: null, count: 0, lastChecked: null }
      });
    }
  });
});
