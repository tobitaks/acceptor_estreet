const container = document.getElementById('heartbeat-container');

function render(entries) {
  const log = entries || [];
  if (!log.length) {
    container.innerHTML = '<div class="log-empty">No heartbeats yet.</div>';
    return;
  }
  const rows = log.map(e => {
    const time = new Date(e.timestamp).toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const state = e.sessionLost
      ? '<span class="status-badge fail">Logged out</span>'
      : '<span class="status-badge success">Alive</span>';
    return `<tr><td class="time-cell">${time}</td><td>${state}</td><td>count: ${e.count ?? '—'}</td></tr>`;
  }).join('');
  container.innerHTML = `
    <table>
      <thead><tr><th>Time</th><th>State</th><th>Orders</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

chrome.storage.local.get('heartbeatLog', ({ heartbeatLog }) => render(heartbeatLog));

chrome.storage.onChanged.addListener((changes) => {
  if (changes.heartbeatLog) render(changes.heartbeatLog.newValue);
});

document.getElementById('clear-heartbeat-btn').addEventListener('click', () => {
  if (confirm('Clear heartbeat log?')) chrome.storage.local.set({ heartbeatLog: [] });
});
