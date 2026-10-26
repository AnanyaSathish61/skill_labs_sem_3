const params = new URLSearchParams(window.location.search);
const targetUrl = params.get('target') || '';

document.getElementById('targetUrlDisplay').textContent = targetUrl;

document.getElementById('goBackBtn').addEventListener('click', () => {
  if (history.length > 2) {
    history.go(-2);
  } else {
    window.close();
  }
});

document.getElementById('proceedBtn').addEventListener('click', () => {
  if (targetUrl) {
    chrome.runtime.sendMessage({
      type: 'PROCEED_TO_SUSPICIOUS_URL',
      targetUrl
    });
  }
});