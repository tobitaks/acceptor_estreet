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
