"""Summarize complete native-run evidence without removing ticks or outliers."""
import gzip, hashlib, json, statistics, sys
from pathlib import Path
root=Path(sys.argv[1])
rows=[]
for folder in sorted(root.iterdir()):
    if not (folder/'summary.json').exists(): continue
    s=json.loads((folder/'summary.json').read_text())
    ticks=json.loads(gzip.decompress((folder/'ticks.json.gz').read_bytes()))
    commands=gzip.decompress((folder/'command-frames.jsonl.gz').read_bytes())
    whole=s['timing']['wholeMs']
    rows.append({'run':folder.name,**whole,'totalTickMs':sum(t['wholeMs'] for t in ticks),
      'selectedTicks':{str(i):ticks[i]['wholeMs'] for i in [0,1859,3345,5280,5971,6990,9659]},
      'maxSampledMemory':{k:max(t.get('memory',{}).get(k,0) for t in ticks) for k in ['rss','heapUsed','external','arrayBuffers']},
      'finalChecksum':s['finalChecksum'],'commandBytes':len(commands),'commandSha256':hashlib.sha256(commands).hexdigest()})
result={'runs':rows}
for arm in ['A','B']:
    group=[r for r in rows if r['run'].startswith('r') and '-'+arm in r['run']]
    if group: result[arm]={'n':len(group),'meanOfRuns':{k:statistics.mean(r[k] for r in group) for k in ['mean','p99','max','totalTickMs']},
      'range':{k:[min(r[k] for r in group),max(r[k] for r in group)] for k in ['mean','p99','max']},
      'selectedTickMean':{str(i):statistics.mean(r['selectedTicks'][str(i)] for r in group) for i in [0,1859,3345,5280,5971,6990,9659]}}
print(json.dumps(result,indent=2))
