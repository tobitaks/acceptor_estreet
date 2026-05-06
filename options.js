const logContainer       = document.getElementById('log-container');
const detectContainer    = document.getElementById('detections-container');
const clearBtn           = document.getElementById('clear-btn');
const clearDetectionsBtn = document.getElementById('clear-detections-btn');
const statTotal    = document.getElementById('stat-total');
const statSuccess  = document.getElementById('stat-success');
const statUnavail  = document.getElementById('stat-unavail');
const statFail     = document.getElementById('stat-fail');

function render(entries) {
  const log = entries || [];

  statTotal.textContent   = log.length;
  statSuccess.textContent = log.filter(e => e.outcome === 'accepted' || (e.success && !e.outcome)).length;
  statUnavail.textContent = log.filter(e => e.outcome === 'unavailable').length;
  statFail.textContent    = log.filter(e => {
    if (e.outcome) return e.outcome === 'failed';
    return !e.success;
  }).length;

  if (!log.length) {
    logContainer.innerHTML = '<div class="log-empty">No orders accepted yet.</div>';
    return;
  }

  const rows = log.map(e => {
    const time = new Date(e.timestamp).toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const outcome = e.outcome || (e.success ? 'accepted' : 'failed');
    const statusMap = {
      accepted:    '<span class="status-badge success">Accepted</span>',
      unavailable: '<span class="status-badge unavailable">Already Taken</span>',
      failed:      '<span class="status-badge fail">Failed</span>'
    };
    const status = statusMap[outcome] || statusMap.failed;
    const finalUrl = e.finalUrl || '';
    const urlCell = finalUrl
      ? `<a href="${finalUrl}" target="_blank" rel="noopener">${finalUrl}</a>`
      : '—';
    const itemText = e.itemText || '—';
    return `
      <tr>
        <td><span class="appr-id">${e.apprId}</span></td>
        <td>${itemText}</td>
        <td>${status}</td>
        <td class="url-cell">${urlCell}</td>
        <td class="time-cell">${time}</td>
      </tr>
    `;
  }).join('');

  logContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>ApprID</th>
          <th>Type</th>
          <th>Status</th>
          <th>Redirect URL</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderDetections(entries) {
  const log = entries || [];
  if (!log.length) {
    detectContainer.innerHTML = '<div class="log-empty">No detections yet.</div>';
    return;
  }
  const rows = log.map(e => {
    const time = new Date(e.timestamp).toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const ids = (e.orders || []).map(o => o.apprId).join(', ') || '—';
    const filteredIds = (e.filtered || []).map(o => o.apprId).join(', ') || 'none';
    return `
      <tr>
        <td><strong>${e.count}</strong></td>
        <td class="url-cell">${ids}</td>
        <td>${e.acceptType || '—'}</td>
        <td class="url-cell">${filteredIds}</td>
        <td class="time-cell">${time}</td>
      </tr>
    `;
  }).join('');
  detectContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Count</th>
          <th>ApprIDs Found</th>
          <th>Filter</th>
          <th>Auto-accept Sent</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

chrome.storage.local.get(['acceptedLog', 'detectionLog'], ({ acceptedLog, detectionLog }) => {
  render(acceptedLog);
  renderDetections(detectionLog);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.acceptedLog)  render(changes.acceptedLog.newValue);
  if (changes.detectionLog) renderDetections(changes.detectionLog.newValue);
});

clearBtn.addEventListener('click', () => {
  if (confirm('Clear all accepted order logs?')) {
    chrome.storage.local.set({ acceptedLog: [] });
  }
});

clearDetectionsBtn.addEventListener('click', () => {
  if (confirm('Clear all detection logs?')) {
    chrome.storage.local.set({ detectionLog: [] });
  }
});

// Accept-type filter
chrome.storage.local.get('acceptType', ({ acceptType = 'both' }) => {
  const radio = document.querySelector(`input[name="acceptType"][value="${acceptType}"]`);
  if (radio) radio.checked = true;
});

document.querySelectorAll('input[name="acceptType"]').forEach((r) => {
  r.addEventListener('change', (e) => {
    if (e.target.checked) {
      chrome.storage.local.set({ acceptType: e.target.value });
    }
  });
});
