"""Inclusive diagnostic samples/counters are NOT additive or acceptance timings."""
import collections,gzip,json,sys
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path("/tmp")
out={}
for name in ['control','transpose','cow']:
    folder=root/('sanity-counts-'+name)
    if not folder.exists(): continue
    ticks=json.loads(gzip.decompress((folder/'ticks.json.gz').read_bytes()))
    totals={}
    for tick in ticks:
        for fn,cost in tick['costs'].items():
            row=totals.setdefault(fn,dict(calls=0,ms=0,work=0,maxWork=0))
            for key in ['calls','ms','work']: row[key]+=cost[key]
            row['maxWork']=max(row['maxWork'],cost['maxWork'])
    out[name]={'inclusiveCounters':totals}
folder=root/'sanity-diagnostic'
p=json.loads(gzip.decompress((folder/'cpu-profile.cpuprofile.gz').read_bytes()))
nodes={n['id']:n for n in p['nodes']};parents={c:n['id'] for n in p['nodes'] for c in n.get('children',[])}
inclusive=collections.Counter(); own=collections.Counter()
for node,duration in zip(p['samples'],p['timeDeltas']):
    own[nodes[node]['callFrame']['functionName']]+=duration/1000
    seen=set()
    while node:
        seen.add(nodes[node]['callFrame']['functionName']);node=parents.get(node)
    for name in seen: inclusive[name]+=duration/1000
out['profile']={'inclusiveMs':dict(inclusive.most_common(40)),'selfMs':dict(own.most_common(40))}
d=json.loads(gzip.decompress((folder/'focused-diagnostics.json.gz').read_bytes()))
out['gc']={'count':len(d['gcEntries']),'totalDurationMs':sum(e['duration'] for e in d['gcEntries']),
 'selectedOverlaps':{str(t['tick']):sum(max(0,min(t['endedMs'],e['startTime']+e['duration'])-max(t['startedMs'],e['startTime'])) for e in d['gcEntries']) for t in d['clocks'] if t['tick'] in [0,3345,5971,6990,9659]}}
print(json.dumps(out,indent=2))
