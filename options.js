const logContainer       = document.getElementById('log-container');
const detectContainer    = document.getElementById('detections-container');
const clearBtn           = document.getElementById('clear-btn');
const clearDetectionsBtn = document.getElementById('clear-detections-btn');
const statTotal    = document.getElementById('stat-total');
const statSuccess  = document.getElementById('stat-success');
const statUnavail  = document.getElementById('stat-unavail');
const statFail     = document.getElementById('stat-fail');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDiag(d) {
  if (!d) return '<span style="color:#bbb">—</span>';
  const line = (k, v) => `<span class="k">${k}:</span> ${escapeHtml(v)}`;
  const text = [
    ...(d.note ? [line('NOTE', d.note), ''] : []),
    line('GET status', d.getStatus),
    line('GET url', d.getUrl),
    line('GET redirected', d.getRedirected),
    line('GET title', d.getTitle),
    line('viewstate found', d.hadViewState),
    line('fields', (d.getFields || []).join(', ')),
    '',
    line('POST status', d.postStatus),
    line('POST url', d.postUrl),
    line('POST redirected', d.postRedirected),
    line('POST title', d.postTitle),
    '',
    `<span class="k">GET snippet:</span>\n${escapeHtml(d.getSnippet)}`,
    '',
    `<span class="k">POST snippet:</span>\n${escapeHtml(d.postSnippet)}`
  ].join('\n');
  return `<details class="diag"><summary>view</summary><pre class="diag-pre">${text}</pre></details>`;
}

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
    const itemText = e.itemText || '—';
    const apprUrl = `https://estreetamc.spurams.com/ViewOrder.aspx?ApprID=${e.apprId}`;
    return `
      <tr>
        <td><a class="appr-id" href="${apprUrl}" target="_blank" rel="noopener">${e.apprId}</a></td>
        <td>${itemText}</td>
        <td>${status}</td>
        <td class="time-cell">${time}</td>
        <td>${renderDiag(e.diag)}</td>
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
          <th>Time</th>
          <th>Diag</th>
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
    const usedFallback = (e.orders || []).some(o => o.fromFallback);
    const ids = ((e.orders || []).map(o => o.apprId).join(', ') || '—')
      + (usedFallback ? ' <span style="color:#E65100;font-size:11px">(regex fallback)</span>' : '');
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

function renderHeartbeat(entries) {
  const log = entries || [];
  const c = document.getElementById('last-heartbeat');
  if (!log.length) {
    c.innerHTML = 'No heartbeats yet.';
    return;
  }
  const e = log[0];
  const time = new Date(e.timestamp).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const state = e.sessionLost
    ? '<span class="status-badge fail">Logged out</span>'
    : '<span class="status-badge success">Alive</span>';
  c.innerHTML = `<strong>Last heartbeat:</strong> ${time} &nbsp; ${state}`;
}

chrome.storage.local.get(['acceptedLog', 'detectionLog', 'heartbeatLog'], ({ acceptedLog, detectionLog, heartbeatLog }) => {
  render(acceptedLog);
  renderDetections(detectionLog);
  renderHeartbeat(heartbeatLog);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.acceptedLog)  render(changes.acceptedLog.newValue);
  if (changes.detectionLog) renderDetections(changes.detectionLog.newValue);
  if (changes.heartbeatLog) renderHeartbeat(changes.heartbeatLog.newValue);
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
