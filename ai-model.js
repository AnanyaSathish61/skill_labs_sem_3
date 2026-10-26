/*
 * LocalShield XAI URL model (offline, no remote API).
 * Logistic regression trained on 999 benign and 1998 phishing URL strings from:
 * https://github.com/Lab-NextGenAI/Phishing-URL-Dataset
 * Hostname-disjoint test: n=580, accuracy=.876, precision=.936, recall=.872.
 * IMPORTANT: Dataset selection biased towards popular benign websites. Scores
 * are NOT calibrated malware probabilities and do NOT establish safety.
 */
(() => {
  'use strict';
  // MODEL_START
  const PARAMETERS = {
    "featureNames":  [
                         "URL length",
                         "Domain length",
                         "Digit ratio",
                         "Hyphen count",
                         "Domain dots",
                         "Path depth",
                         "Query length",
                         "Special-character ratio",
                         "Contains @",
                         "IP hostname",
                         "Uses HTTP",
                         "Punycode domain",
                         "Domain entropy",
                         "Risk-related terms"
                     ],
    "means":  [
                  0.3377658254033926,
                  0.34276257462024945,
                  0.05480694712026384,
                  0.05061370845400634,
                  0.32056268100951596,
                  0.17845814370431665,
                  0.0017014894497310714,
                  0.189260831847518,
                  0.0024824162184526274,
                  0.0028961522548613984,
                  0.05875051717004551,
                  0.0,
                  0.7166791068815025,
                  0.011377741001241209
              ],
    "stds":  [
                 0.16933628309281942,
                 0.246065678140977,
                 0.07874927332223532,
                 0.10443973877396454,
                 0.11439255980371832,
                 0.05782075211990124,
                 0.016988081132181202,
                 0.05691031874168716,
                 0.049761971707027355,
                 0.053737924755037386,
                 0.23515716851139729,
                 1,
                 0.1266112854178854,
                 0.05453042529427456
             ],
    "weights":  [
                    1.4909542345236138,
                    0.3385161989403229,
                    0.7107924011367036,
                    0.6005099970466726,
                    0.8159229796269114,
                    0.6228022810829088,
                    0.24898726036043675,
                    0.2643572162467408,
                    -0.018332944737063067,
                    -0.0398263860922538,
                    0.5842904305886294,
                    0.0,
                    0.30513241911849837,
                    0.32068173288445034
                ],
    "bias":  2.132651345230312,
    "training":  {
                     "benign":  999,
                     "phishing":  1998
                 },
    "holdout":  {
                    "n":  580,
                    "accuracy":  0.8758620689655172,
                    "precision":  0.9357541899441341,
                    "recall":  0.8723958333333334,
                    "tp":  335,
                    "fp":  23,
                    "tn":  173,
                    "fn":  49
                }
};
  // MODEL_END
  function features(value) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host.includes('...')) return null;
    const s = url.href;
    const n = s.length;
    const counts = {};
    for (const ch of host) counts[ch] = (counts[ch] || 0) + 1;
    let entropy = 0;
    for (const count of Object.values(counts)) {
      const p = count / host.length;
      entropy -= p * Math.log2(p);
    }
    const count = (re) => (s.match(re) || []).length;
    return [
      Math.min(n,250)/100,
      Math.min(host.length,140)/70,
      count(/\d/g)/n,
      Math.min((host.match(/-/g)||[]).length,12)/6,
      Math.min((host.match(/\./g)||[]).length,10)/5,
      Math.min(url.pathname.split('/').length-1,12)/6,
      Math.min(url.search.length,160)/80,
      count(/[^a-zA-Z0-9]/g)/n,
      +(s.includes('@')),
      +(/^\d{1,3}(\.\d{1,3}){3}$/.test(host)),
      +(url.protocol === 'http:'),
      +(host.includes('xn--')),
      entropy/5,
      Math.min(count(/login|verify|password|account|update|secure|wallet|bank|signin|auth|payment/gi),8)/4
    ];
  }
  function scan(value) {
    const x = features(value);
    if (!x) return null;
    const contributions = x.map((raw,i) => {
      const norm = Math.max(-6,Math.min(6,(raw-PARAMETERS.means[i])/PARAMETERS.stds[i]));
      return { feature: PARAMETERS.featureNames[i], contribution: +(PARAMETERS.weights[i]*norm).toFixed(3), value: +raw.toFixed(4) };
    });
    const logit = PARAMETERS.bias + contributions.reduce((sum,entry)=>sum+entry.contribution,0);
    const score = 1/(1+Math.exp(-Math.max(-30,Math.min(30,logit))));
    const positive = contributions.filter(x=>x.contribution>0).sort((a,b)=>b.contribution-a.contribution);
    const negative = contributions.filter(x=>x.contribution<0).sort((a,b)=>a.contribution-b.contribution);
    const top = [...positive.slice(0,3), ...negative.slice(0,2)];
    const level = score >= 0.97 ? 'review' : score >= 0.60 ? 'uncertain' : 'lower';
    return {
      score: +score.toFixed(4), level, contributions: top,
      intercept: PARAMETERS.bias,
      model: 'URL lexical logistic regression (research prototype)',
      disclaimer: 'Not a malware verdict. The model only analyzes URL text.'
    };
  }
  const api = Object.freeze({ scan, features });
  // Works in a MV3 background service worker and in Node test VM.
  globalThis.LocalShieldAI = api;
})();
