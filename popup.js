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
const fExcludeEl  = document.getElementById('f-exclude');
const fChanceEl   = document.getElementById('f-chance');
const fIntervalEl = document.getElementById('f-interval');
const fLimitEl    = document.getElementById('f-limit');

const TYPE_LABEL = { both: 'Both (Ext + Int + VS)', exterior: 'Exterior only', interior: 'Interior only' };

function filterCount(s) {
  return (s || '').split(',').map(x => x.trim()).filter(Boolean).length;
}

function renderFilters(s = {}) {
  const { acceptType = 'exterior', keywordFilter = '', excludeFilter = '', acceptChance = 100,
          pollLowMin = 3, pollLowMax = 5, pollHighMin = 5, pollHighMax = 20, pollLowWeight = 50,
          alwaysFast = false, dailyAcceptLimit = 0 } = s;
  fTypeEl.textContent    = TYPE_LABEL[acceptType] || acceptType;
  const kc = filterCount(keywordFilter);
  const ec = filterCount(excludeFilter);
  fKeywordEl.textContent  = kc ? `${kc} filter${kc !== 1 ? 's' : ''}` : 'any (no filter)';
  fExcludeEl.textContent  = ec ? `${ec} filter${ec !== 1 ? 's' : ''}` : 'none';
  fChanceEl.textContent   = `${acceptChance}%`;
  const w = Math.min(100, Math.max(0, parseInt(pollLowWeight, 10) || 0));
  fIntervalEl.textContent = alwaysFast === true
    ? 'Always fast (~0.5s)'
    : `${w}% ${pollLowMin}-${pollLowMax}s · ${100 - w}% ${pollHighMin}-${pollHighMax}s`;
  const limit = parseInt(dailyAcceptLimit, 10) || 0;
  fLimitEl.textContent    = limit > 0 ? `${limit}/day` : 'unlimited';
}

const FILTER_KEYS = ['acceptType', 'keywordFilter', 'excludeFilter', 'acceptChance',
                     'pollLowMin', 'pollLowMax', 'pollHighMin', 'pollHighMax', 'pollLowWeight',
                     'alwaysFast', 'dailyAcceptLimit'];

chrome.storage.local.get('monitorState', ({ monitorState }) => render(monitorState));
chrome.storage.local.get(FILTER_KEYS, (s) => renderFilters(s));

chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitorState) render(changes.monitorState.newValue);
  if (FILTER_KEYS.some(k => changes[k])) {
    chrome.storage.local.get(FILTER_KEYS, (s) => renderFilters(s));
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
