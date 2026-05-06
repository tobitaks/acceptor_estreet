let alerted = false;

function randomInterval() {
  return (5 + Math.floor(Math.random() * 6)) * 1000;
}

function playAlarm() {
  chrome.runtime.sendMessage({ type: 'PLAY_AUDIO_ALERT' });
}

async function extractNewOrders() {
  const link = document.getElementById('ctl00_cphBody_lnkShowNewOrders');
  if (!link) {
    console.warn('[eStreet] new orders link not found in DOM');
    return [];
  }
  link.click();
  await new Promise(r => setTimeout(r, 2500));
  const grid = document.getElementById('ctl00_cphBody_grdNewOrders');
  if (!grid) {
    console.warn('[eStreet] grdNewOrders not in DOM after click');
    return [];
  }
  const rows = grid.querySelectorAll('tr');
  const orders = [];
  const seen = new Set();
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) continue;
    const a = cells[0].querySelector('a[href*="ApprID="]');
    if (!a) continue;
    const m = a.href.match(/ApprID=(\d+)/);
    if (!m) continue;
    const apprId = m[1];
    if (seen.has(apprId)) continue;
    seen.add(apprId);
    const itemText = cells[3].textContent.replace(/\s+/g, ' ').trim();
    orders.push({ apprId, itemText });
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
    const res = await fetch('https://estreetamc.spurams.com/AppraiserDashboard.aspx', {
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
      const orders = await extractNewOrders();
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
    console.error('[eStreet] error:', e);
  }

  setTimeout(checkOrders, randomInterval());
}

setTimeout(checkOrders, 3000);
