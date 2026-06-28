const startBtn   = document.getElementById('start-btn');
const stopBtn    = document.getElementById('stop-btn');
const optionsBtn = document.getElementById('options-link');
const dot        = document.getElementById('dot');
const countEl    = document.getElementById('count');
const labelEl    = document.getElementById('label');
const lastEl     = document.getElementById('last-checked');

function render(state) {
  const on = !!state?.monitoring;

  dot.className     = 'dot' + (on ? ' active' : '');
  startBtn.disabled = on;
  stopBtn.disabled  = !on;

  if (on && state.sessionLost) {
    countEl.textContent = '!';
    countEl.className   = 'count alert';
    labelEl.textContent = 'LOGGED OUT — re-login in the tab';
    lastEl.textContent  = state.lastChecked
      ? `Last checked: ${new Date(state.lastChecked).toLocaleTimeString()}`
      : '';
  } else if (on && state.lastChecked) {
    const c = state.count ?? 0;
    countEl.textContent = c;
    countEl.className   = 'count' + (c > 0 ? ' alert' : '');
    labelEl.textContent = `new order${c !== 1 ? 's' : ''}`;
    lastEl.textContent  = `Last checked: ${new Date(state.lastChecked).toLocaleTimeString()}`;
  } else if (!on) {
    countEl.textContent = '–';
    countEl.className   = 'count';
    labelEl.textContent = '';
    lastEl.textContent  = '';
  }
}

const fTypeEl    = document.getElementById('f-type');
const fKeywordEl = document.getElementById('f-keyword');
const fExcludeEl = document.getElementById('f-exclude');
const fChanceEl  = document.getElementById('f-chance');

const TYPE_LABEL = { both: 'Both (Ext + Int + VS)', exterior: 'Exterior only', interior: 'Interior only' };

function renderFilters(acceptType = 'exterior', keywordFilter = '', excludeFilter = '', acceptChance = 100) {
  fTypeEl.textContent    = TYPE_LABEL[acceptType] || acceptType;
  fKeywordEl.textContent = keywordFilter.trim() || 'any (no filter)';
  fExcludeEl.textContent = excludeFilter.trim() || 'none';
  fChanceEl.textContent  = `${acceptChance}%`;
}

const FILTER_KEYS = ['acceptType', 'keywordFilter', 'excludeFilter', 'acceptChance'];

chrome.storage.local.get('monitorState', ({ monitorState }) => render(monitorState));
chrome.storage.local.get(FILTER_KEYS, ({ acceptType, keywordFilter, excludeFilter, acceptChance }) =>
  renderFilters(acceptType, keywordFilter, excludeFilter, acceptChance));

chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitorState) render(changes.monitorState.newValue);
  if (FILTER_KEYS.some(k => changes[k])) {
    chrome.storage.local.get(FILTER_KEYS, ({ acceptType, keywordFilter, excludeFilter, acceptChance }) =>
      renderFilters(acceptType, keywordFilter, excludeFilter, acceptChance));
  }
});

startBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START' });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP' });
});

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
