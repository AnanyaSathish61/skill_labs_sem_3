"""Reproduce LocalShield's research-model using Python standard library only.
Source: https://github.com/Lab-NextGenAI/Phishing-URL-Dataset
This URL lexical classifier is an educational proof of concept, NOT a malware verdict.

Usage: python training/train_model.py dataset/urlsgood1000.csv dataset/urlsfish.csv
Writes model-params.json in the current directory. To install retrained parameters,
replace the object between MODEL_START and MODEL_END in ai-model.js after review.
"""
import csv, json, math, re, sys
from pathlib import Path
from urllib.parse import urlsplit

FEATURES = ['URL length','Domain length','Digit ratio','Hyphen count','Domain dots','Path depth','Query length','Special-character ratio','Contains @','IP hostname','Uses HTTP','Punycode domain','Domain entropy','Risk-related terms']
WORDS = re.compile(r'login|verify|password|account|update|secure|wallet|bank|signin|auth|payment',re.I)

def url_features(s):
    if not s or len(s)>8192 or '...' in s: return None
    try:
        u=urlsplit(s); host=(u.hostname or '').lower()
        if u.scheme not in ('http','https') or not host: return None
    except ValueError: return None
    # Normalized paths for regular absolute HTTP(S) URLs.
    href = s
    hostcounts={}
    for c in host:hostcounts[c]=hostcounts.get(c,0)+1
    entropy=sum(-(count/len(host))*math.log2(count/len(host)) for count in hostcounts.values())
    n=len(href)
    return [min(n,250)/100,min(len(host),140)/70,len(re.findall(r'\d',href))/n,
            min(host.count('-'),12)/6,min(host.count('.'),10)/5,
            min((u.path or '/').count('/'),12)/6,
            min(len(('?'+u.query) if u.query else ''),160)/80,
            len(re.findall(r'[^a-zA-Z0-9]',href))/n,
            float('@' in href),float(bool(re.fullmatch(r'\d{1,3}(\.\d{1,3}){3}',host))),
            float(u.scheme=='http'),float('xn--' in host),entropy/5,
            min(len(WORDS.findall(href)),8)/4]

def fnv32(text):
    result=2166136261
    for c in text:
        result=((result^ord(c))*16777619)&0xffffffff
    return result

def load_urls(path):
    with open(path,encoding='utf-8-sig',newline='') as f:
        reader=csv.reader(f)
        head=next(reader,None)
        for row in reader:
            if row and url_features(row[0].strip()) is not None: yield row[0].strip()

def sigmoid(x): return 1/(1+math.exp(-max(-30,min(30,x))))

def evaluate(ds,w,b):
    tp=fp=tn=fn=0
    for x,y in ds:
        pred=sigmoid(b+sum(a*c for a,c in zip(x,w)))>=0.5
        if pred and y:tp+=1
        elif pred:fp+=1
        elif y:fn+=1
        else:tn+=1
    return dict(n=len(ds),accuracy=(tp+tn)/len(ds),precision=tp/(tp+fp) if tp+fp else 0,recall=tp/(tp+fn) if tp+fn else 0,tp=tp,fp=fp,tn=tn,fn=fn)

def train(goodpath,badpath):
    good=list(load_urls(goodpath))
    bad=sorted(load_urls(badpath),key=fnv32)[:2*len(good)]
    rows=[]
    for urls,label in ((good,0),(bad,1)):
        for s in urls:
            host=urlsplit(s).hostname.lower()
            rows.append((url_features(s),label,fnv32(host)%5==0))
    train=[(x,y) for x,y,test in rows if not test]
    test=[(x,y) for x,y,is_test in rows if is_test]
    n=len(train)
    mean=[sum(x[j] for x,y in train)/n for j in range(len(FEATURES))]
    std=[math.sqrt(sum((x[j]-mean[j])**2 for x,y in train)/n) or 1 for j in range(len(FEATURES))]
    def normalize(ds):
        return [([max(-6,min(6,(v-mean[j])/std[j])) for j,v in enumerate(x)],y) for x,y in ds]
    train,test=normalize(train),normalize(test)
    w=[0.0]*len(FEATURES);b=0.0
    for epoch in range(700):
        grad=[0.0]*len(FEATURES);gb=0.0
        for x,y in train:
            error=sigmoid(b+sum(a*c for a,c in zip(w,x)))-y
            for j in range(len(w)):grad[j]+=error*x[j]
            gb+=error
        lr=.22/math.sqrt(1+epoch/140)
        w=[weight-lr*(grad[j]/n+.012*weight) for j,weight in enumerate(w)]
        b-=lr*gb/n
    output={'featureNames':FEATURES,'means':mean,'stds':std,'weights':w,'bias':b,
            'training':{'benign':len(good),'phishing':len(bad)},'holdout':evaluate(test,w,b)}
    Path('model-params.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps(output['holdout'],indent=2))
    print('Saved model-params.json. Copy the parameters into ai-model.js to deploy a retrained model.')

if __name__=='__main__':
    if len(sys.argv)!=3:sys.exit('Usage: python training/train_model.py <legitimate.csv> <phishing.csv>')
    train(sys.argv[1],sys.argv[2])
