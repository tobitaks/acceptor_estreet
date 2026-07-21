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

// Normal-mode poll interval in seconds (default 20, min 5). Fast mode is fixed ~0.5s.
const normalInput = document.getElementById('normal-interval');
chrome.storage.local.get('normalIntervalSec', ({ normalIntervalSec = 20 }) => {
  normalInput.value = normalIntervalSec;
});
normalInput.addEventListener('input', (e) => {
  const v = Math.max(5, parseInt(e.target.value, 10) || 20);
  chrome.storage.local.set({ normalIntervalSec: v }, () => flash('saved-normal'));
});

// Always-fast toggle — bypasses normal-mode interval. Disables the field when ON.
const alwaysFastToggle = document.getElementById('always-fast');
function syncNormalDisabled(on) {
  normalInput.disabled = on;
  normalInput.style.opacity = on ? '0.4' : '1';
}
chrome.storage.local.get('alwaysFast', ({ alwaysFast = false }) => {
  alwaysFastToggle.checked = alwaysFast === true;
  syncNormalDisabled(alwaysFast === true);
});
alwaysFastToggle.addEventListener('change', (e) => {
  const on = e.target.checked;
  syncNormalDisabled(on);
  chrome.storage.local.set({ alwaysFast: on }, () => flash('saved-normal'));
});
