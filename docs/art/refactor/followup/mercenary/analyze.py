from pathlib import Path
import json,math
p=Path(__file__).parent
names=['981','9de','9de-oldstats','981-newstats','9de-old-cost','9de-old-time','9de-old-cost-time','981-extended','9de-extended']
def read(n,m):return json.loads((p/f'{n}-trace-{str(m).lower()}.json').read_text())
def normalize(d):
 s=json.dumps(d)
 for a,b in [('emberAcolyte','priest'),('pyreCaller','summoner'),('emberMend','heal'),('cinderSoul','summon')]:s=s.replace(a,b)
 return json.loads(s)
summary={'cases':[],'comparisons':[]}
for n in names:
 for m in [False,True]:
  d=read(n,m);home=3596 if m else 500;arrival={}
  for t in d['trace']:
   if 'tick' not in t:continue
   for u in t['mercenaries']:
    if math.hypot(u['x']-home,u['y']-500)<=180:arrival.setdefault(u['id'],t['tick'])
  summary['cases'].append({'variant':n,'mirror':m,'hireTicks':[t['tick'] for t in d['trace'] if 'tick'in t for e in t['entries'] if e['command']['type']=='hire'],'endDistances':[math.hypot(u['x']-home,u['y']-500) for u in d['final']['mercenaries']],'firstWithin180At15TickSamples':arrival,'final':d['final']})
for a,b in [('981','9de-oldstats'),('9de','981-newstats')]:
 for m in [False,True]:
  x,y=normalize(read(a,m)),normalize(read(b,m));tx=[t for t in x['trace'] if 'tick'in t];ty=[t for t in y['trace'] if 'tick'in t]
  comparison={'a':a,'b':b,'mirror':m,'allDecisionCommandsEqual':all(t['entries']==u['entries'] for t,u in zip(tx,ty)) and len(tx)==len(ty),'allDecisionGoldEqual':all(t['gold']==u['gold'] for t,u in zip(tx,ty)),'allMercenarySamplesEqual':all(t['mercenaries']==u['mercenaries'] for t,u in zip(tx,ty)),'finalEqual':x['final']==y['final']}
  assert all(comparison[k] for k in ['allDecisionCommandsEqual','allDecisionGoldEqual','allMercenarySamplesEqual','finalEqual']),comparison
  summary['comparisons'].append(comparison)
(p/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary['comparisons'],indent=2))
