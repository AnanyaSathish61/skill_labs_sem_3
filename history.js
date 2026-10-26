'use strict';
const search = document.getElementById('search');
const filter = document.getElementById('filter');
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
let records = [];

function el(tag, className, message) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (message !== undefined) node.textContent = String(message);
  return node;
}
function typeLabel(type) {
  return ({ad:'Network ad blocked', popup:'Popup blocked',download:'Download blocked','video-skip':'Video skip','ai-review':'AI review only'})[type] || type;
}
function draw() {
  const query = search.value.toLowerCase().trim();
  const kind = filter.value;
  const matching = records.filter(r => (kind==='all' || r.type === kind) &&
    [r.url,r.pageUrl,r.domain,r.reason,r.ruleId,...(r.ai?.contributions || []).map(c=>c.feature)].join(' ').toLowerCase().includes(query));
  rows.replaceChildren();
  for (const record of matching) {
    const tr = el('tr');
    tr.append(el('td','',new Date(record.timestamp).toLocaleString()));
    tr.append(el('td','',typeLabel(record.type)));
    const address = el('td');
    address.append(el('span','domain',record.domain || (record.pageUrl ? 'Page context' : 'URL not recorded')));
    address.append(el('span','url',record.url || record.pageUrl || 'Not available'));
    tr.append(address);
    const reason = el('td');
    reason.append(el('span','reason',record.reason || 'No explanation supplied'));
    if (record.ruleId != null) reason.append(el('span','rule',`Chrome rule #${record.ruleId} (rules.json)`));
    else if (record.type === 'popup') reason.append(el('span','rule','JavaScript popup / overlay interception'));
    else if (record.type === 'ai-review') reason.append(el('span','rule','AI review only; navigation not blocked'));
    tr.append(reason);
    const explanation = el('td');
    if (record.ai) {
      explanation.append(el('span','risk',`URL pattern score: ${(record.ai.score*100).toFixed(1)}% · ${record.ai.level}`));
      const contributions = el('ul','explain');
      for (const c of record.ai.contributions || []) {
        const sign = c.contribution >= 0 ? '+' : '';
        const li = el('li',c.contribution > 0 ? 'up':'down',`${c.feature}: ${sign}${c.contribution} log-odds`);
        contributions.append(li);
      }
      explanation.append(contributions);
    } else {
      explanation.append(el('span','url','No analyzable URL recorded'));
    }
    tr.append(explanation);
    rows.append(tr);
  }
  document.getElementById('count').textContent = `${matching.length} shown · ${records.length} stored (maximum 500)`;
  document.getElementById('networkCount').textContent = records.filter(r=>r.type==='ad').length;
  document.getElementById('popupCount').textContent = records.filter(r=>r.type==='popup').length;
  document.getElementById('reviewCount').textContent = records.filter(r=>r.type==='ai-review').length;
  empty.hidden = !!matching.length;
}
async function refresh() {
  const obj = await chrome.storage.local.get('blockedHistory');
  records = Array.isArray(obj.blockedHistory) ? obj.blockedHistory : [];
  records.sort((a,b) => b.timestamp - a.timestamp);
  draw();
}
search.addEventListener('input', draw);
filter.addEventListener('change', draw);
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear activity history? Lifetime counters remain unchanged.')) return;
  const res = await chrome.runtime.sendMessage({type:'CLEAR_HISTORY'});
  if (!res?.ok) alert(res?.error || 'Failed to clear history');
  await refresh();
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if (area==='local' && changes.blockedHistory) void refresh();
});
void refresh();
