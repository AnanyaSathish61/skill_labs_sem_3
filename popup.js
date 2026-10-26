const powerBtn = document.getElementById('powerBtn');
const statusText = document.getElementById('statusText');
const closeBtn = document.getElementById('closeBtn');
const adsBlockedCount = document.getElementById('adsBlockedCount');
const popupsBlockedCount = document.getElementById('popupsBlockedCount');

function updateUI(enabled, adsBlocked = 0, popupsBlocked = 0) {
  powerBtn.classList.toggle('active', enabled);
  powerBtn.classList.toggle('off', !enabled);
  statusText.textContent = enabled ? 'PROTECTED' : 'DISABLED';
  adsBlockedCount.textContent = adsBlocked.toLocaleString();
  popupsBlockedCount.textContent = popupsBlocked.toLocaleString();
}

chrome.storage.local.get(['enabled', 'adsBlocked', 'popupsBlocked'], (data) => {
  const enabled = data.enabled !== false;
  updateUI(enabled, data.adsBlocked || 0, data.popupsBlocked || 0);
});

powerBtn.addEventListener('click', () => {
  chrome.storage.local.get(['enabled', 'adsBlocked', 'popupsBlocked'], (data) => {
    const nextState = data.enabled === false;
    chrome.storage.local.set({ enabled: nextState }, () => {
      updateUI(nextState, data.adsBlocked || 0, data.popupsBlocked || 0);
      chrome.runtime.sendMessage({ type: 'TOGGLE_EXTENSION', enabled: nextState });
    });
  });
});

closeBtn.addEventListener('click', () => {
  window.close();
});

chrome.storage.onChanged.addListener((changes) => {
  chrome.storage.local.get(['enabled', 'adsBlocked', 'popupsBlocked'], (data) => {
    updateUI(data.enabled !== false, data.adsBlocked || 0, data.popupsBlocked || 0);
  });
});