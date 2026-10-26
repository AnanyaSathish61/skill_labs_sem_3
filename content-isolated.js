
(() => {
  let extensionEnabled = true;
  let protectionsInstalled = false;
  let adStyle = null;
  let lastSkipClick = 0;
  let lastSweep = 0;

  // Prevent extension messaging errors after reload
  function safeSendMessage(message) {
    try {
      if (!chrome.runtime?.id) return;

      const result = chrome.runtime.sendMessage(message);

      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (_) {
      // Old content-script context was disconnected
    }
  }

  // Enable/disable visual filtering
  function setEnabled(enabled) {
    extensionEnabled = enabled;

    try {
      window.dispatchEvent(
        new CustomEvent('__LOCALSHIELD_CONFIG__', {
          detail: { enabled }
        })
      );
    } catch (_) {}

    if (enabled) {
      initProtections();

      if (adStyle && !adStyle.isConnected) {
        (document.head || document.documentElement)
          .appendChild(adStyle);
      }
    } else if (adStyle) {
      adStyle.remove();
    }
  }

  // Read initial extension state
  try {
    chrome.storage.local.get(['enabled'], data => {
      setEnabled(data.enabled !== false);
    });

    chrome.storage.onChanged.addListener(changes => {
      if (!changes.enabled) return;

      try {
        if (!chrome.runtime?.id) return;
        setEnabled(changes.enabled.newValue !== false);
      } catch (_) {}
    });
  } catch (_) {}

  // Track genuine user clicks for download validation
  window.addEventListener('click', e => {
    if (!extensionEnabled || !e.isTrusted) return;

    const anchor = e.target?.closest?.('a, button');

    const content = anchor
      ? `${anchor.textContent || ''} ${anchor.getAttribute('href') || ''} ${anchor.getAttribute('download') || ''}`
      : '';

    const isDownloadIntent =
      /download|export|save|\.mp3|\.mp4|\.zip|\.pdf/i.test(content);

    safeSendMessage({
      type: 'USER_INTERACTION',
      isDownloadIntent
    });
  }, true);

  // Listen to events from the MAIN world script
  window.addEventListener('__LOCALSHIELD_EVENT__', e => {
    if (!extensionEnabled || !e.detail) return;

    if (e.detail.action === 'REDIRECT_BLOCKED') {
      safeSendMessage({
        type: 'INCREMENT_COUNTER',
        counter: 'popups',
        blockedUrl: e.detail.url
      });

      showBottomToast('Redirect ad blocked');
    }

    else if (e.detail.action === 'START_MICRO_ENV') {
      runSecureMicroEnvironment(e.detail.url);
    }
  });

  // Messages from background
  try {
    chrome.runtime.onMessage.addListener(msg => {
      if (msg.type === 'SHOW_TOAST' && extensionEnabled) {
        showBottomToast(msg.message);
      }
    });
  } catch (_) {}

  // Bottom toast
  function showBottomToast(message) {
    if (!document.body) return;

    let host = document.getElementById(
      '__localshield_toast_host__'
    );

    if (!host) {
      host = document.createElement('div');
      host.id = '__localshield_toast_host__';

      const shadow = host.attachShadow({ mode: 'closed' });
      const toast = document.createElement('div');

      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(18,19,22,0.94);
        color: white;
        border: 1px solid #2b8a3e;
        padding: 9px 18px;
        border-radius: 20px;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity .3s ease;
        opacity: 0;
      `;

      shadow.appendChild(toast);
      document.body.appendChild(host);

      host._toast = toast;
    }

    host._toast.textContent = `LocalShield: ${message}`;
    host._toast.style.opacity = '1';

    clearTimeout(host._timer);

    host._timer = setTimeout(() => {
      host._toast.style.opacity = '0';
    }, 2400);
  }

  // Sandboxed short-link redirect experiment
  function runSecureMicroEnvironment(redirectUrl) {
    let parsed;

    try {
      parsed = new URL(redirectUrl, location.href);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return;
      }
    } catch (_) {
      return;
    }

    showBottomToast('Checking short-link redirect...');

    const frame = document.createElement('iframe');
    frame.name = '__LOCALSHIELD_MICRO_ENV__';

    // Do not grant downloads, popups or top-level navigation
    frame.setAttribute('sandbox', 'allow-scripts');

    frame.style.cssText =
      'width:0;height:0;border:0;position:fixed;top:-9999px;visibility:hidden;';

    frame.src = parsed.href;

    let timeoutId;

    const cleanup = () => {
      window.removeEventListener('message', onRewardMessage);
      clearTimeout(timeoutId);
      frame.remove();
    };

    const onRewardMessage = event => {
      if (!extensionEnabled) return;
      if (event.source !== frame.contentWindow) return;

      const data = event.data;

      if (
        !data ||
        data.type !== '__MICRO_ENV_REWARD__' ||
        typeof data.rewardUrl !== 'string'
      ) return;

      try {
        const target = new URL(data.rewardUrl, parsed.href);

        if (!['http:', 'https:'].includes(target.protocol)) {
          return;
        }

        if (target.username || target.password) return;

        cleanup();

        showBottomToast('Opening discovered destination...');
        window.location.assign(target.href);
      } catch (_) {}
    };

    window.addEventListener('message', onRewardMessage);
    document.documentElement.appendChild(frame);

    // Automatically remove the sandboxed frame
    timeoutId = setTimeout(cleanup, 3000);
  }

  function initProtections() {
    if (protectionsInstalled) return;

    protectionsInstalled = true;

    // Hide common advertising containers
    adStyle = document.createElement('style');

    adStyle.textContent = `
      ins.adsbygoogle,
      [id^="google_ads_"],
      [id^="div-gpt-ad"],
      .ad-banner,
      .ad-slot,
      .advertisement-container,
      iframe[src*="doubleclick.net"],
      iframe[src*="googlesyndication.com"] {
        display: none !important;
      }
    `;

    (document.head || document.documentElement)
      .appendChild(adStyle);

    // YouTube skip-button handling
    const handleVideoAds = () => {
      if (!extensionEnabled) return;

      const isYouTube =
        /(^|\.)youtube\.com$/i.test(location.hostname);

      if (!isYouTube) return;

      // Never interfere with normal video playback
      const adPlayer = document.querySelector(
        '.html5-video-player.ad-showing, .ad-showing, .ad-interrupting'
      );

      if (!adPlayer) return;

      const skipSelectors = [
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-slot button',
        '.ytp-ad-skip-button-container button',
        '.videoAdUiSkipButton',
        'button[aria-label*="Skip Ad" i]',
        'button[aria-label*="Skip Ads" i]'
      ].join(', ');

      const buttons = document.querySelectorAll(
        skipSelectors
      );

      const skipButton = Array.from(buttons).find(btn => {
        if (btn.disabled) return false;
        if (btn.getClientRects().length === 0) return false;

        const style = window.getComputedStyle(btn);

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      });

      if (!skipButton) return;

      // Prevent repeated rapid clicks and inflated counters
      if (Date.now() - lastSkipClick < 3000) return;

      lastSkipClick = Date.now();

      skipButton.click();

      safeSendMessage({
        type: 'INCREMENT_COUNTER',
        counter: 'ads'
      });
    };

    // Avoid deleting legitimate login or application modals
    const isLegitimateModal = el => {
      const attributes = `
        ${el.id}
        ${el.className}
        ${el.getAttribute('role') || ''}
        ${el.getAttribute('aria-label') || ''}
      `.toLowerCase();

      if (
        /login|signin|auth|modal|dialog|menu|select|dropdown|tab|cookie|settings|player/.test(
          attributes
        )
      ) {
        return true;
      }

      return Boolean(
        el.querySelector(
          'input[type="password"], input[type="email"], [role="tablist"]'
        )
      );
    };

    // Remove obviously advertising-related overlays
    const removePopupOverlays = () => {
      if (!extensionEnabled || !document.body) return;

      const candidates = document.querySelectorAll(
        'body > div, body > aside, body > section'
      );

      candidates.forEach(el => {
        if (
          el.id === '__localshield_toast_host__' ||
          isLegitimateModal(el)
        ) return;

        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex, 10);

        const positioned =
          style.position === 'fixed' ||
          style.position === 'absolute';

        if (!positioned || !(zIndex > 999)) return;

        const rect = el.getBoundingClientRect();

        const coversViewport =
          rect.width >= innerWidth * 0.75 &&
          rect.height >= innerHeight * 0.75;

        const hasAdSignals =
          el.querySelector(
            'iframe[src*="ad"], a[target="_blank"]'
          ) &&
          !el.querySelector('form, main, article');

        if (coversViewport && hasAdSignals) {
          el.remove();

          safeSendMessage({
            type: 'INCREMENT_COUNTER',
            counter: 'popups'
          });

          showBottomToast('Pop-up overlay blocked');
        }
      });
    };

    // Watch dynamically inserted elements
    const observer = new MutationObserver(() => {
      if (!extensionEnabled) return;

      // Limit repeated DOM scanning
      if (Date.now() - lastSweep < 500) return;

      lastSweep = Date.now();

      handleVideoAds();
      removePopupOverlays();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // YouTube changes its player dynamically
    if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
      handleVideoAds();
      setInterval(handleVideoAds, 1000);
    }
  }
})();