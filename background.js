
importScripts('ai-model.js');

// LocalShield background service worker - Manifest V3

const DANGEROUS_EXTENSIONS = [
  '.exe', '.scr', '.bat', '.cmd', '.msi',
  '.vbs', '.ps1', '.apk', '.dmg'
];

const BLOCKED_RULES = {
  1: 'DoubleClick ad request',
  2: 'Google Syndication ad request',
  3: 'Google AdService request',
  4: 'PopAds request',
  5: 'Advertising exchange request',
  6: 'Display advertising network request',
  7: 'Sponsored content network request',
  8: 'Pop-under advertising network request',
  9: 'Additional advertising network request'
};

const MAX_HISTORY = 500;
const AI_THRESHOLD = 0.995;

const recentUserClickByTab = new Map();
const recentAiAlert = new Map();
const oneTimeAllowedNavigation = new Map();

let logQueue = Promise.resolve();

// Remove queries and fragments from stored URLs
function displayURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin + url.pathname;
  } catch (_) {
    return '';
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch (_) {
    return '';
  }
}

// Safely call the existing trained model
function scanURL(url) {
  try {
    const result = LocalShieldAI.scan(url);
    return result && Number.isFinite(result.score) ? result : null;
  } catch (error) {
    console.warn('LocalShield AI error:', error);
    return null;
  }
}

// Look for additional phishing evidence in the hostname
function phishingEvidence(url) {
  const host = url.hostname.toLowerCase();
  const parts = host.split(/[.-]/);

  const keywords = new Set([
    'verify', 'password', 'reset', 'confirm',
    'billing', 'signin', 'login', 'secure',
    'account', 'update'
  ]);

  const keywordCount = parts.filter(
    part => keywords.has(part)
  ).length;

  const hasCredentials = Boolean(url.username || url.password);

  const isIpAddress =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

  const usesPunycode = host.includes('xn--');

  const possibleImpersonation =
    /(?:^|[.-])(?:google|paypal|microsoft|amazon|apple|facebook)[-_](?:login|verify|password|secure|signin|support)(?:[.-]|$)/i.test(host);

  const strong =
    hasCredentials ||
    possibleImpersonation ||
    keywordCount >= 2 ||
    (usesPunycode && keywordCount >= 1) ||
    (isIpAddress && keywordCount >= 1);

  return {
    strong,
    hasCredentials,
    possibleImpersonation,
    keywordCount
  };
}

// Save an activity event
function recordActivity({
  type,
  url = '',
  pageUrl = '',
  reason = '',
  ruleId = null,
  ai = null
}) {
  const cleanUrl = displayURL(url);

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now(),
    type,
    url: cleanUrl,
    domain: hostOf(cleanUrl),
    pageUrl: displayURL(pageUrl),
    reason,
    ruleId,
    // XAI applies to phishing review, not ordinary ad blocking
    ai: type === 'ai-review' ? ai : null
  };

  logQueue = logQueue.catch(() => {}).then(async () => {
    const data = await chrome.storage.local.get([
      'enabled',
      'blockedHistory',
      'adsBlocked',
      'popupsBlocked',
      'videoAdsSkipped'
    ]);

    if (data.enabled === false) return;

    const history = Array.isArray(data.blockedHistory)
      ? data.blockedHistory
      : [];

    const update = {
      blockedHistory: [entry, ...history].slice(0, MAX_HISTORY)
    };

    if (type === 'ad') {
      update.adsBlocked = (data.adsBlocked || 0) + 1;
    }

    if (type === 'popup') {
      update.popupsBlocked = (data.popupsBlocked || 0) + 1;
    }

    if (type === 'video-skip') {
      update.videoAdsSkipped = (data.videoAdsSkipped || 0) + 1;
    }

    await chrome.storage.local.set(update);
  });

  return logQueue;
}

// First installation only
chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      enabled: true,
      adsBlocked: 0,
      popupsBlocked: 0,
      videoAdsSkipped: 0,
      blockedHistory: []
    });
  }
});

// Handle content-script and popup messages
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    (async () => {

      if (msg.type === 'TOGGLE_EXTENSION') {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: msg.enabled ? ['ruleset_1'] : [],
          disableRulesetIds: msg.enabled ? [] : ['ruleset_1']
        });
      }

      else if (msg.type === 'INCREMENT_COUNTER') {
        if (msg.counter === 'popups') {
          await recordActivity({
            type: 'popup',
            url: msg.blockedUrl || '',
            pageUrl: sender.tab?.url || '',
            reason: msg.blockedUrl
              ? 'Blocked JavaScript popup'
              : 'Removed popup overlay'
          });
        }

        else if (msg.counter === 'ads') {
          await recordActivity({
            type: 'video-skip',
            pageUrl: sender.tab?.url || '',
            reason: 'Video skip button clicked'
          });
        }
      }

      else if (msg.type === 'USER_INTERACTION' && sender.tab) {
        recentUserClickByTab.set(sender.tab.id, {
          time: Date.now(),
          isDownloadIntent: Boolean(msg.isDownloadIntent)
        });
      }

      else if (
        msg.type === 'PROCEED_TO_SUSPICIOUS_URL' &&
        sender.tab
      ) {
        const target = new URL(msg.targetUrl);

        if (!['http:', 'https:'].includes(target.protocol)) {
          throw Error('Unsafe URL scheme');
        }

        // Only allow confirmation from our warning page
        const warningPage = chrome.runtime.getURL('warning.html');
        const senderUrl = new URL(sender.url || '');

        if (
          senderUrl.origin + senderUrl.pathname !== warningPage
        ) {
          throw Error('Invalid warning page');
        }

        if (senderUrl.searchParams.get('target') !== target.href) {
          throw Error('Warning target mismatch');
        }

        oneTimeAllowedNavigation.set(sender.tab.id, {
          url: target.href,
          expires: Date.now() + 10000
        });

        await chrome.tabs.update(sender.tab.id, {
          url: target.href
        });
      }

      else if (msg.type === 'ANALYZE_URL') {
        return {
          analysis: scanURL(msg.url || '')
        };
      }

      else if (msg.type === 'CLEAR_HISTORY') {
        // Complete pending log writes before resetting
        await logQueue.catch(() => {});

        // Reset history AND all displayed counters
        await chrome.storage.local.set({
          blockedHistory: [],
          adsBlocked: 0,
          popupsBlocked: 0,
          videoAdsSkipped: 0,
          latestAiReview: null
        });

        recentAiAlert.clear();
      }

    })()
      .then(payload => {
        sendResponse({
          ok: true,
          ...(payload || {})
        });
      })
      .catch(error => {
        sendResponse({
          ok: false,
          error: String(error.message || error)
        });
      });

    return true;
  }
);

// Record network requests blocked by Chrome rules
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info => {
    const ruleId = info.rule?.ruleId;

    if (
      info.rule?.rulesetId !== 'ruleset_1' ||
      !BLOCKED_RULES[ruleId]
    ) return;

    void recordActivity({
      type: 'ad',
      url: info.request?.url || '',
      reason: BLOCKED_RULES[ruleId],
      ruleId
    });
  });
}

// Conservative XAI navigation review
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId !== 0) return;

  (async () => {
    const { enabled } =
      await chrome.storage.local.get('enabled');

    if (enabled === false) return;

    const url = new URL(details.url);

    if (!['http:', 'https:'].includes(url.protocol)) return;

    const exception = oneTimeAllowedNavigation.get(details.tabId);

    if (exception) {
      oneTimeAllowedNavigation.delete(details.tabId);

      if (
        exception.expires > Date.now() &&
        exception.url === url.href
      ) return;
    }

    const ai = scanURL(url.href);
    const evidence = phishingEvidence(url);

    // Both a high ML score and stronger hostname evidence required
    const shouldReview = Boolean(
      ai &&
      ai.score >= AI_THRESHOLD &&
      evidence.strong
    );

    await chrome.storage.local.set({
      latestAiReview: {
        url: displayURL(url.href),
        domain: url.hostname,
        timestamp: Date.now(),
        ai: shouldReview ? ai : null
      }
    });

    // Normal Google, GitHub etc. are not logged as AI alerts
    if (!shouldReview) return;

    const key = `${details.tabId}:${url.hostname}`;
    const previous = recentAiAlert.get(key) || 0;

    if (Date.now() - previous > 30000) {
      recentAiAlert.set(key, Date.now());

      await recordActivity({
        type: 'ai-review',
        url: url.href,
        ai,
        reason:
          'AI review: suspicious hostname and high model score (not blocked by ad rules)'
      });
    }

    // Strong-evidence navigations show an interstitial
    if (
      evidence.possibleImpersonation ||
      evidence.hasCredentials ||
      evidence.keywordCount >= 2
    ) {
      await chrome.tabs.update(details.tabId, {
        url: chrome.runtime.getURL(
          `warning.html?target=${encodeURIComponent(url.href)}`
        )
      });
    }
  })().catch(error => {
    console.warn('LocalShield navigation error:', error);
  });
});

// Heuristic download protection
chrome.downloads.onCreated.addListener(item => {
  (async () => {
    const { enabled } =
      await chrome.storage.local.get('enabled');

    if (enabled === false) return;

    const url = item.finalUrl || item.url || '';
    let pathname = '';

    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch (_) {}

    const filename = (item.filename || '').toLowerCase();

    // Preserve PDF downloads
    if (
      pathname.endsWith('.pdf') ||
      item.mime === 'application/pdf'
    ) return;

    const riskyExtension = DANGEROUS_EXTENSIONS.some(
      ext =>
        pathname.endsWith(ext) ||
        filename.endsWith(ext)
    );

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    const tab = tabs[0];
    const click = tab
      ? recentUserClickByTab.get(tab.id)
      : null;

    const userRequested = Boolean(
      click &&
      Date.now() - click.time < 2500 &&
      click.isDownloadIntent
    );

    if (!riskyExtension && userRequested) return;

    await chrome.downloads.cancel(item.id);

    await recordActivity({
      type: 'download',
      url,
      pageUrl: tab?.url || '',
      reason: riskyExtension
        ? 'Blocked potentially risky file type'
        : 'Blocked unconfirmed download'
    });

    if (tab) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'SHOW_TOAST',
          message: 'Firewall: Download blocked'
        });
      } catch (_) {}
    }
  })().catch(error => {
    console.warn('LocalShield download error:', error);
  });
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener(tabId => {
  recentUserClickByTab.delete(tabId);
  oneTimeAllowedNavigation.delete(tabId);

  for (const key of recentAiAlert.keys()) {
    if (key.startsWith(`${tabId}:`)) {
      recentAiAlert.delete(key);
    }
  }
});
