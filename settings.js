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
