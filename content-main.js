(() => {
  const SECRET_EVENT = '__LOCALSHIELD_EVENT__';
  let isEnabled = true;
  let lastTrustedClickTime = 0;
  let lastClickTargetHref = '';

  // Listen for state updates from the isolated content script
  window.addEventListener('__LOCALSHIELD_CONFIG__', (e) => {
    if (e.detail && typeof e.detail.enabled === 'boolean') {
      isEnabled = e.detail.enabled;
    }
  });

  // Check if current frame is inside the Secure Micro-Environment
  const isMicroEnv = window.name === '__LOCALSHIELD_MICRO_ENV__';

  if (isMicroEnv) {
    // SPECIAL CASE: Accelerate 10-second mandatory redirect wait timers into <1 second
    const origSetTimeout = window.setTimeout;
    const origSetInterval = window.setInterval;

    window.setTimeout = function (fn, delay, ...args) {
      const scaledDelay = typeof delay === 'number' && delay > 100 ? Math.min(delay / 10, 800) : delay;
      return origSetTimeout.call(this, fn, scaledDelay, ...args);
    };

    window.setInterval = function (fn, delay, ...args) {
      const scaledDelay = typeof delay === 'number' && delay > 100 ? Math.max(delay / 10, 50) : delay;
      return origSetInterval.call(this, fn, scaledDelay, ...args);
    };

    // Detect when the mandatory wait finishes and reveals/triggers the reward link
    const checkReward = () => {
      const rewardLink = document.querySelector(
        'a[href*="download"], a[id*="skip"], a[class*="skip"], a[class*="continue"], a[href^="http"]:not([href*="' + location.hostname + '"])'
      );
      if (rewardLink && rewardLink.href) {
        window.parent.postMessage(
          { type: '__MICRO_ENV_REWARD__', rewardUrl: rewardLink.href },
          '*'
        );
      }
    };
    origSetInterval(checkReward, 250);
    return;
  }

  // Track genuine user clicks to allow legitimate logins, selection tabs, PDFs, and intentional downloads
  window.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted) return;
      lastTrustedClickTime = Date.now();
      const anchor = e.target.closest ? e.target.closest('a') : null;
      lastClickTargetHref = anchor ? anchor.href : '';
    },
    true
  );

  function isAllowedException(urlStr) {
    try {
      const target = new URL(urlStr, location.href);
      const pathAndQuery = (target.pathname + target.search).toLowerCase();

      // Exceptions: OAuth/Login pages, PDF previews, intentional downloads, or same-origin navigation
      if (
        /login|signin|auth|oauth|sso|account|callback/.test(pathAndQuery) ||
        target.pathname.toLowerCase().endsWith('.pdf') ||
        target.origin === location.origin
      ) {
        return true;
      }

      // Check if user explicitly clicked a matching link within the last 1.5 seconds
      if (Date.now() - lastTrustedClickTime < 1500 && lastClickTargetHref === target.href) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function isMandatoryTimerRedirect(urlStr) {
    return /adf\.ly|linkvertise|ouo\.io|sh\.st|shorte\.st|wait|countdown|timer/i.test(urlStr);
  }

  // Intercept window.open (Pop-up & Redirect Ads)
  const originalWindowOpen = window.open;
  window.open = function (url, target, features) {
    if (!isEnabled || !url) {
      return originalWindowOpen.call(this, url, target, features);
    }

    const resolvedUrl = new URL(url, location.href).href;

    if (isAllowedException(resolvedUrl)) {
      return originalWindowOpen.call(this, url, target, features);
    }

    if (isMandatoryTimerRedirect(resolvedUrl)) {
      window.dispatchEvent(
        new CustomEvent(SECRET_EVENT, {
          detail: { action: 'START_MICRO_ENV', url: resolvedUrl }
        })
      );
      return null;
    }

    window.dispatchEvent(
      new CustomEvent(SECRET_EVENT, {
        detail: { action: 'REDIRECT_BLOCKED', url: resolvedUrl }
      })
    );
    return null;
  };
})();