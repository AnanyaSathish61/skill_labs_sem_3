'use strict';
const powerBtn = document.getElementById('powerBtn');
const statusText = document.getElementById('statusText');
const recentAds = document.getElementById('recentAds');
const aiReview = document.getElementById('aiReview');

function render(data) {
  const enabled = data.enabled !== false;
  powerBtn.classList.toggle('off', !enabled);
  powerBtn.classList.toggle('active', enabled);
  statusText.textContent = enabled ? 'Protected' : 'Disabled';
  document.getElementById('adsBlockedCount').textContent = (data.adsBlocked || 0).toLocaleString();
  document.getElementById('popupsBlockedCount').textContent = (data.popupsBlocked || 0).toLocaleString();
  recentAds.replaceChildren();

  const latest = (data.blockedHistory || []).filter(x => x.type === 'ad').slice(0, 3);
  if (!latest.length) {
    const p = document.createElement('p');
    p.className = 'empty-message';
    p.textContent = 'No blocked network ads recorded yet.';
    recentAds.appendChild(p);
  }
  for (const item of latest) {
    const row = document.createElement('div'); row.className = 'recent-item';
    const icon = document.createElement('span'); icon.className = 'stop'; icon.textContent = '⛨';
    const box = document.createElement('div'); box.className = 'recent-content';
    const top = document.createElement('div'); top.className = 'recent-top';
    const name = document.createElement('strong'); name.textContent = item.domain || 'Unknown domain';
    name.title = item.url || '';
    const blocked = document.createElement('span'); blocked.textContent = '⊘'; blocked.style.color = '#c3c8cc';
    top.append(name, blocked);
    const sub = document.createElement('div'); sub.className = 'recent-sub';
    const why = document.createElement('span'); why.textContent = item.reason || 'Blocked by ad rule';
    const time = document.createElement('span'); time.textContent = new Date(item.timestamp).toLocaleTimeString();
    sub.append(why,time); box.append(top,sub); row.append(icon,box); recentAds.appendChild(row);
  }

  aiReview.replaceChildren();
  const last = data.latestAiReview;
  if (!last?.ai) {
    aiReview.textContent = 'Visit a website to see its URL-pattern score.';
  } else {
    const head = document.createElement('div');
    const score = document.createElement('span'); score.className = 'ai-score';
    score.textContent = `Pattern score: ${(last.ai.score*100).toFixed(1)}% · ${last.ai.level}`;
    head.textContent = `${last.domain || 'Unknown host'} — `;
    head.append(score); aiReview.append(head);
    for (const contribution of (last.ai.contributions || []).filter(c => c.contribution > 0).slice(0, 2)) {
      const line = document.createElement('span'); line.className = 'feature';
      line.textContent = `↑ ${contribution.feature}: +${contribution.contribution} log-odds`;
      aiReview.append(line);
    }
  }
}

async function refresh() {
  const data = await chrome.storage.local.get(['enabled','adsBlocked','popupsBlocked','blockedHistory','latestAiReview']);
  render(data);
}
powerBtn.addEventListener('click', async () => {
  const {enabled} = await chrome.storage.local.get('enabled');
  const next = enabled === false;
  const answer = await chrome.runtime.sendMessage({type:'TOGGLE_EXTENSION',enabled:next});
  if (answer?.ok) await chrome.storage.local.set({enabled:next});
  else console.error('Toggle failed', answer?.error);
});
document.getElementById('openHistoryBtn').addEventListener('click', () => {
  chrome.windows.create({url:chrome.runtime.getURL('history.html'),type:'popup',width:1100,height:720});
});
chrome.storage.onChanged.addListener((changes,area) => {
  if (area === 'local' && Object.keys(changes).some(k=>['enabled','adsBlocked','popupsBlocked','blockedHistory','latestAiReview'].includes(k))) void refresh();
});
void refresh();
