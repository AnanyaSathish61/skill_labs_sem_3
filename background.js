const DANGEROUS_EXTENSIONS = ['.exe', '.scr', '.bat', '.cmd', '.msi', '.vbs', '.ps1', '.apk', '.dmg'];
const SUSPICIOUS_HOST_PATTERNS = [
  /free-.*-convert/i,
  /yt-?mp4-?download/i,
  /click-?here-?win/i,
  /verify-?account-?update/i
];

// Tracks recent explicit user gestures per tab to distinguish intentional downloads from drive-by trojans
const recentUserClickByTab = new Map();
const allowlistedTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    adsBlocked: 0,
    popupsBlocked: 0
  });
});

// Toggle DeclarativeNetRequest ruleset when user clicks power button
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOGGLE_EXTENSION') {
    chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: msg.enabled ? ['ruleset_1'] : [],
      disableRulesetIds: msg.enabled ? [] : ['ruleset_1']
    });
  } else if (msg.type === 'INCREMENT_COUNTER') {
    chrome.storage.local.get(['adsBlocked', 'popupsBlocked'], (data) => {
      const updates = {};
      if (msg.counter === 'ads') updates.adsBlocked = (data.adsBlocked || 0) + 1;
      if (msg.counter === 'popups') updates.popupsBlocked = (data.popupsBlocked || 0) + 1;
      chrome.storage.local.set(updates);
    });
  } else if (msg.type === 'USER_INTERACTION' && sender.tab) {
    recentUserClickByTab.set(sender.tab.id, {
      time: Date.now(),
      isDownloadIntent: msg.isDownloadIntent
    });
  } else if (msg.type === 'PROCEED_TO_SUSPICIOUS_URL' && sender.tab) {
    allowlistedTabs.add(sender.tab.id);
    chrome.tabs.update(sender.tab.id, { url: msg.targetUrl });
  }
  sendResponse({ ok: true });
});

// Count declarativeNetRequest blocked ads if feedback permission is active
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(() => {
    chrome.storage.local.get(['adsBlocked'], (data) => {
      chrome.storage.local.set({ adsBlocked: (data.adsBlocked || 0) + 1 });
    });
  });
}

// FIREWALL PART 1: Inspect suspicious pages before fully loading
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  chrome.storage.local.get(['enabled'], (data) => {
    if (data.enabled === false) return;
    if (allowlistedTabs.has(details.tabId)) return;

    try {
      const url = new URL(details.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      const isSuspicious =
        SUSPICIOUS_HOST_PATTERNS.some((re) => re.test(url.hostname)) ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname); // Raw IP address host

      if (isSuspicious) {
        const warningUrl = chrome.runtime.getURL(
          `warning.html?target=${encodeURIComponent(details.url)}`
        );
        chrome.tabs.update(details.tabId, { url: warningUrl });
      }
    } catch (_) {}
  });
});

// FIREWALL PART 2: Block unsolicited trojan auto-downloads
chrome.downloads.onCreated.addListener((downloadItem) => {
  chrome.storage.local.get(['enabled'], (data) => {
    if (data.enabled === false) return;

    const urlLower = (downloadItem.finalUrl || downloadItem.url || '').toLowerCase();
    const filenameLower = (downloadItem.filename || '').toLowerCase();

    // Allow PDF previews explicitly
    if (urlLower.endsWith('.pdf') || downloadItem.mime === 'application/pdf') return;

    const isDangerousFile = DANGEROUS_EXTENSIONS.some(
      (ext) => urlLower.endsWith(ext) || filenameLower.endsWith(ext)
    );

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      const interaction = activeTab ? recentUserClickByTab.get(activeTab.id) : null;
      const hasRecentDownloadClick =
        interaction &&
        Date.now() - interaction.time < 2500 &&
        interaction.isDownloadIntent;

      // Cancel if it's an executable/trojan OR an automatic download without user click
      if (isDangerousFile || !hasRecentDownloadClick) {
        chrome.downloads.cancel(downloadItem.id, () => {
          if (activeTab) {
            chrome.tabs.sendMessage(activeTab.id, {
              type: 'SHOW_TOAST',
              message: 'Firewall: Unwanted automatic download blocked'
            });
          }
        });
      }
    });
  });
});