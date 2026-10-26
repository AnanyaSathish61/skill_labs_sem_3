(() => {
  let extensionEnabled = true;

  // Sync state with storage and inform MAIN world script
  chrome.storage.local.get(['enabled'], (data) => {
    extensionEnabled = data.enabled !== false;
    window.dispatchEvent(
      new CustomEvent('__LOCALSHIELD_CONFIG__', { detail: { enabled: extensionEnabled } })
    );
    if (extensionEnabled) initProtections();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      extensionEnabled = changes.enabled.newValue !== false;
      window.dispatchEvent(
        new CustomEvent('__LOCALSHIELD_CONFIG__', { detail: { enabled: extensionEnabled } })
      );
    }
  });

  // Notify background of genuine user clicks for Download Firewall validation
  window.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted) return;
      const anchor = e.target.closest ? e.target.closest('a, button') : null;
      const textAndHref = anchor
        ? `${anchor.textContent} ${anchor.getAttribute('href') || ''} ${anchor.getAttribute('download') || ''}`
        : '';
      const isDownloadIntent = /download|export|save|\.mp3|\.mp4|\.zip|\.pdf/i.test(textAndHref);
      chrome.runtime.sendMessage({ type: 'USER_INTERACTION', isDownloadIntent });
    },
    true
  );

  // Listen for messages from MAIN world or Background
  window.addEventListener('__LOCALSHIELD_EVENT__', (e) => {
    if (!extensionEnabled || !e.detail) return;

    if (e.detail.action === 'REDIRECT_BLOCKED') {
      chrome.runtime.sendMessage({ type: 'INCREMENT_COUNTER', counter: 'popups' });
      showBottomToast('Redirect ad blocked');
    } else if (e.detail.action === 'START_MICRO_ENV') {
      runSecureMicroEnvironment(e.detail.url);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_TOAST') {
      showBottomToast(msg.message);
    }
  });

  // Minimal bottom toast notification that fades away in 2-3 seconds
  function showBottomToast(message) {
    if (!document.body) return;
    let host = document.getElementById('__localshield_toast_host__');
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
        background: rgba(18, 19, 22, 0.92);
        color: #f1f3f5;
        border: 1px solid #2b8a3e;
        padding: 8px 16px;
        border-radius: 20px;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity 0.4s ease;
        opacity: 0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      `;
      shadow.appendChild(toast);
      document.body.appendChild(host);
      host._toast = toast;
    }

    const toastEl = host._toast;
    toastEl.textContent = `🛡️ ${message}`;
    toastEl.style.opacity = '1';

    clearTimeout(host._timer);
    host._timer = setTimeout(() => {
      toastEl.style.opacity = '0';
    }, 2400);
  }

  // SECURE MICRO-ENVIRONMENT LAYER for mandatory wait redirects
  function runSecureMicroEnvironment(redirectUrl) {
    showBottomToast('Accelerating mandatory redirect in safe micro-environment...');
    const microFrame = document.createElement('iframe');
    microFrame.name = '__LOCALSHIELD_MICRO_ENV__';
    // Strict sandbox: no popups, no top-navigation, no downloads, hidden from user
    microFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    microFrame.style.cssText = 'width:0;height:0;border:0;position:fixed;top:-9999px;left:-9999px;visibility:hidden;';
    microFrame.src = redirectUrl;

    const cleanup = () => {
      window.removeEventListener('message', onRewardMessage);
      if (microFrame.parentNode) microFrame.parentNode.removeChild(microFrame);
    };

    const onRewardMessage = (event) => {
      if (event.data && event.data.type === '__MICRO_ENV_REWARD__' && event.data.rewardUrl) {
        const rewardUrl = event.data.rewardUrl;
        cleanup(); // Completely dissolve micro-environment
        showBottomToast('Redirect timer bypassed! Opening destination...');
        window.location.assign(rewardUrl);
      }
    };

    window.addEventListener('message', onRewardMessage);
    document.documentElement.appendChild(microFrame);

    // Dissolve safely after 2.5 seconds even if no reward link was found
    setTimeout(cleanup, 2500);
  }

  function initProtections() {
    // 1. ON-PAGE AD COSMETIC FILTERING
    const style = document.createElement('style');
    style.textContent = `
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
    (document.head || document.documentElement).appendChild(style);

    // 2. IN-VIDEO AD HANDLER (YouTube & HTML5 Video Players)
    const handleVideoAds = () => {
      if (!extensionEnabled) return;

      const adPlayer = document.querySelector('.ad-showing, .ad-interrupting');
      if (adPlayer) {
        const video = adPlayer.querySelector('video');
        if (video && !isNaN(video.duration) && video.duration > 0) {
          video.muted = true;
          video.playbackRate = 16;
          video.currentTime = video.duration;
        }
      }

      const skipButtons = document.querySelectorAll(
        '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .videoAdUiSkipButton'
      );
      skipButtons.forEach((btn) => {
        btn.click();
        chrome.runtime.sendMessage({ type: 'INCREMENT_COUNTER', counter: 'ads' });
      });
    };

    // 3. POP-UP OVERLAY BLOCKER (with Login & Selection Tab exceptions)
    const isLegitimateModal = (el) => {
      const attrText = `${el.id} ${el.className} ${el.getAttribute('role') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      if (/login|signin|auth|modal|dialog|menu|select|dropdown|tab|cookie|settings|player/.test(attrText)) {
        return true;
      }
      if (el.querySelector('input[type="password"], input[type="email"], [role="tablist"]')) {
        return true;
      }
      return false;
    };

    const removePopupOverlays = () => {
      if (!extensionEnabled || !document.body) return;

      const candidates = document.querySelectorAll('body > div, body > aside, body > section');
      candidates.forEach((el) => {
        if (el.id === '__localshield_toast_host__' || isLegitimateModal(el)) return;

        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex, 10);
        const isFixedOrAbsolute = style.position === 'fixed' || style.position === 'absolute';

        if (isFixedOrAbsolute && zIndex > 999) {
          const rect = el.getBoundingClientRect();
          const coversViewport =
            rect.width >= window.innerWidth * 0.75 && rect.height >= window.innerHeight * 0.75;
          const hasAdSignals =
            el.querySelector('iframe[src*="ad"], a[target="_blank"]') &&
            !el.querySelector('form, main, article');

          if (coversViewport && hasAdSignals) {
            el.remove();
            chrome.runtime.sendMessage({ type: 'INCREMENT_COUNTER', counter: 'popups' });
            showBottomToast('Pop-up overlay blocked');
          }
        }
      });
    };

    const observer = new MutationObserver(() => {
      handleVideoAds();
      removePopupOverlays();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();