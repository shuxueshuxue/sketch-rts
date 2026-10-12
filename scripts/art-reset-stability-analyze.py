"""Offline fixed-scene lifecycle attribution; no automatic memory pass gate."""
import json, statistics
from pathlib import Path
root = Path(__file__).resolve().parents[1]
folder = root / 'docs/art/refactor/followup/browser-stability'
rows = [json.loads(line) for line in (folder/'reset-control.samples.jsonl').read_text().splitlines()]
run = json.loads((folder/'reset-control.json').read_text())
assert run['samples'] == len(rows) and run['last']['sample'] == rows[-1]['sample']
def summarize(samples, get):
    points = [(r['state']['elapsedMs']/60000, get(r)) for r in samples]
    points = [(x,y) for x,y in points if y is not None]
    if not points: return None
    x,y = zip(*points); mx,my = statistics.mean(x),statistics.mean(y)
    den = sum((v-mx)**2 for v in x)
    return dict(n=len(y),first=y[0],last=y[-1],minimum=min(y),maximum=max(y),median=statistics.median(y),olsPerMinute=sum((a-mx)*(b-my) for a,b in points)/den if den else None)
def group(samples):
    return {'samples':len(samples),'rssMiB':summarize(samples,lambda r:r['rssKiB']/1024),
            'pssMiB':summarize(samples,lambda r:r['pssKiB']/1024 if r['pssKiB'] is not None else None),
            'gpuProcessPssMiB':summarize(samples,lambda r:sum(p['pssKiB'] for p in r['processes'] if p['kind']=='gpu-process')/1024),
            'jsHeapMiB':summarize(samples,lambda r:r['metrics']['JSHeapUsedSize']/1048576)}
draw = [r for r in rows if r['state']['stage']=='draw']
metrics={stage:group([r for r in rows if r['state']['stage']==stage]) for stage in ['draw','retained-idle','disposed-idle','complete']}
metrics['drawAfter60s']=group([r for r in draw if r['state']['elapsedMs']>=60000])
liveRanges={kind:{'min':min(r['state']['glCounts'][kind]['live'] for r in draw),'max':max(r['state']['glCounts'][kind]['live'] for r in draw),'first':draw[0]['state']['glCounts'][kind],'last':draw[-1]['state']['glCounts'][kind]} for kind in draw[0]['state']['glCounts']}
main=[json.loads(line) for line in (folder/'sustained.samples.jsonl').read_text().splitlines()]
active=[r for r in main if 120000<=r['state']['elapsedMs']<1800000 and r['state']['stage']=='battle']
result={'runnerCompleted':run['passed'],'actualWallMs':run['actualWallMs'],'phases':metrics,'drawPublicGLBalance':liveRanges,'releaseRecord':run['last']['state']['releaseRecord'],'finalPublicGLBalance':run['last']['state']['glCounts'],'activeNonzeroGLSamples':[r['sample'] for r in rows if r['state']['renderer'] and r['state']['glError']],'mainActive2To30Minutes':group(active),'mainActiveFirstLastSixPssMedianMiB':[statistics.median(r['pssKiB']/1024 for r in active[:6]),statistics.median(r['pssKiB']/1024 for r in active[-6:])],'limits':['Public GL balance is explicit create-delete, not driver-live; context destruction can reclaim without public delete.','RSS sums duplicate shared mappings; PSS is apportioned, not GPU VRAM.','A static control does not prove dynamic workloads or multi-hour memory stability.','Whole-main aggregate does not erase positive trends in individual phases.']}
(folder/'reset-control.analysis.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'runnerCompleted':run['passed'],'samples':len(rows),'phases':metrics,'glLiveRanges':{k:[v['min'],v['max']] for k,v in liveRanges.items()}}))
