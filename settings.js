function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1200);
}

// Accept-type filter
chrome.storage.local.get('acceptType', ({ acceptType = 'exterior' }) => {
  const radio = document.querySelector(`input[name="acceptType"][value="${acceptType}"]`);
  if (radio) radio.checked = true;
});

document.querySelectorAll('input[name="acceptType"]').forEach((r) => {
  r.addEventListener('change', (e) => {
    if (e.target.checked) {
      chrome.storage.local.set({ acceptType: e.target.value }, () => flash('saved-type'));
    }
  });
});

// City / keyword filter
const keywordInput = document.getElementById('keyword-filter');
chrome.storage.local.get('keywordFilter', ({ keywordFilter = '' }) => {
  keywordInput.value = keywordFilter;
});
keywordInput.addEventListener('input', (e) => {
  chrome.storage.local.set({ keywordFilter: e.target.value.trim() }, () => flash('saved-keyword'));
});

// Exclude filter / blocklist
const excludeInput = document.getElementById('exclude-filter');
chrome.storage.local.get('excludeFilter', ({ excludeFilter = '' }) => {
  excludeInput.value = excludeFilter;
});
excludeInput.addEventListener('input', (e) => {
  chrome.storage.local.set({ excludeFilter: e.target.value.trim() }, () => flash('saved-exclude'));
});

// Accept-chance coin toss (camouflage). Default 100 = accept all.
const chanceInput = document.getElementById('accept-chance');
const chanceVal   = document.getElementById('accept-chance-val');
chrome.storage.local.get('acceptChance', ({ acceptChance = 100 }) => {
  chanceInput.value     = acceptChance;
  chanceVal.textContent = `${acceptChance}%`;
});
chanceInput.addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  chanceVal.textContent = `${v}%`;
  chrome.storage.local.set({ acceptChance: v }, () => flash('saved-chance'));
});

// Daily accept limit (0 / blank = unlimited). Only successful accepts count;
// enforcement + tab-close lives in background.js.
const limitInput = document.getElementById('daily-limit');
chrome.storage.local.get('dailyAcceptLimit', ({ dailyAcceptLimit = 0 }) => {
  limitInput.value = dailyAcceptLimit || '';
});
limitInput.addEventListener('input', (e) => {
  const v = Math.max(0, parseInt(e.target.value, 10) || 0);
  chrome.storage.local.set({ dailyAcceptLimit: v }, () => flash('saved-limit'));
});

// Randomized normal-mode polling: two bands + weighted split.
const bandEls = {
  lowMin:  document.getElementById('poll-low-min'),
  lowMax:  document.getElementById('poll-low-max'),
  highMin: document.getElementById('poll-high-min'),
  highMax: document.getElementById('poll-high-max'),
  weight:  document.getElementById('poll-low-weight')
};
const pollEst = document.getElementById('poll-est');
const BAND_DEFAULTS = { pollLowMin: 3, pollLowMax: 5, pollHighMin: 5, pollHighMax: 20, pollLowWeight: 50 };

// Live estimate: avg interval + requests over a 10-hr day
function updatePollEst() {
  const lo = (+bandEls.lowMin.value + +bandEls.lowMax.value) / 2;
  const hi = (+bandEls.highMin.value + +bandEls.highMax.value) / 2;
  const w  = Math.min(100, Math.max(0, +bandEls.weight.value)) / 100;
  const avg = w * lo + (1 - w) * hi;
  if (avg > 0) {
    const per10h = Math.round((10 * 3600) / avg);
    pollEst.textContent = `— avg ~${avg.toFixed(1)}s, ~${per10h.toLocaleString()} reqs/10hr`;
  } else {
    pollEst.textContent = '';
  }
}

chrome.storage.local.get(Object.keys(BAND_DEFAULTS), (s) => {
  bandEls.lowMin.value  = s.pollLowMin    ?? BAND_DEFAULTS.pollLowMin;
  bandEls.lowMax.value  = s.pollLowMax    ?? BAND_DEFAULTS.pollLowMax;
  bandEls.highMin.value = s.pollHighMin   ?? BAND_DEFAULTS.pollHighMin;
  bandEls.highMax.value = s.pollHighMax   ?? BAND_DEFAULTS.pollHighMax;
  bandEls.weight.value  = s.pollLowWeight ?? BAND_DEFAULTS.pollLowWeight;
  updatePollEst();
});

const bandSave = {
  lowMin:  ['pollLowMin', 1], lowMax: ['pollLowMax', 1],
  highMin: ['pollHighMin', 1], highMax: ['pollHighMax', 1],
  weight:  ['pollLowWeight', 0]
};
Object.entries(bandSave).forEach(([el, [key, min]]) => {
  bandEls[el].addEventListener('input', (e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    v = Math.max(min, v);
    if (key === 'pollLowWeight') v = Math.min(100, v);
    chrome.storage.local.set({ [key]: v }, () => flash('saved-normal'));
    updatePollEst();
  });
});

// Always-fast toggle — bypasses the bands. Disables the fields when ON.
const alwaysFastToggle = document.getElementById('always-fast');
function syncBandsDisabled(on) {
  Object.values(bandEls).forEach(el => {
    el.disabled = on;
    el.style.opacity = on ? '0.4' : '1';
  });
}
chrome.storage.local.get('alwaysFast', ({ alwaysFast = false }) => {
  alwaysFastToggle.checked = alwaysFast === true;
  syncBandsDisabled(alwaysFast === true);
});
alwaysFastToggle.addEventListener('change', (e) => {
  const on = e.target.checked;
  syncBandsDisabled(on);
  chrome.storage.local.set({ alwaysFast: on }, () => flash('saved-normal'));
});
