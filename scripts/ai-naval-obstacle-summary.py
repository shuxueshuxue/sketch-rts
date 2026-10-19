"""Summarize completed passive surveys; prices are replacement values, not losses.

Usage: python3 scripts/ai-naval-obstacle-summary.py results/obstacle-baseline-v9
Add --allow-partial only for inspecting an unfinished run.
"""
import json,pathlib,sys,collections,statistics
root=pathlib.Path(sys.argv[1]);games=[];owners=[]
for p in sorted(root.glob('*_vs-*.json')):
 r=json.loads(p.read_text());games.append(r)
 for owner,s in r['result']['trackers']['navalObstacles'].items():
  a=r['setup']['players'][owner];owners.append({'name':r['name'],'owner':owner,'subject':r['naval']['subject'],'rival':r['naval']['rival'],'role':'ours'if a['team']==r['naval']['subjectTeam']else'theirs','stats':s,'won':r['result']['winnerTeam']==a['team'],'timeout':r['result']['timeout']})
if '--allow-partial'not in sys.argv:assert len(games)==84,('incomplete',len(games))
def median(v):return statistics.median(v)if v else None
def summary(rows):
 def hulls(condition):
  ships={}
  for r in rows:
   for id,s in r['stats']['ships'].items():
    if condition(s):
     key=(r['name'],id);previous=ships.get(key)
     if previous is None:ships[key]=s
     else:ships[key]={**s,'gold':max(previous['gold'],s['gold']),'maxCargoGold':max(previous['maxCargoGold'],s['maxCargoGold']),'episodes':previous['episodes']+s['episodes']}
  return ships
 def price(ships):
  prices=[s['gold']for s in ships.values()];exposed=[max((e['maxExposedGold'] for e in s['episodes']),default=0)for s in ships.values()]
  return {'hulls':len(ships),'uniqueHullGold':sum(prices),'hullGoldRange':[min(prices,default=0),max(prices,default=0)],'perHullPeakAssetRange':[min(exposed,default=0),max(exposed,default=0)],'perHullPeakAssetMedian':median(exposed),'uniquePeakExposedGold':sum(exposed)}
 result={'observedPlayerSlots':len(rows)}
 for field in ('routeSamples','conflictSeconds','immediateBlockSeconds','stationaryBlockSeconds'):result[field]=sum(r['stats'][field]for r in rows)
 for tag,condition in [('conflict',lambda s:s['conflictSeconds']>0),('immediate',lambda s:s['immediateBlockSeconds']>0),('stationary',lambda s:s['stationaryBlockSeconds']>0),('stationaryAtLeast30',lambda s:s['stationaryBlockSeconds']>=30)]:
  ss=hulls(condition);names=sorted({n for n,id in ss});outcomes={}
  for r in rows:
   if r['name']in names:outcomes[r['name']]='timeout'if r['timeout']else'win'if r['won']else'loss'
  result[tag]={'games':len(names),'names':names,**price(ss),'outcomes':dict(collections.Counter(outcomes.values()))}
 confirmed=hulls(lambda s:any(e['first']['terrainClear']and e['first']['shipTrafficClear']for e in s['episodes']))
 confirmed_stalled=hulls(lambda s:s['stationaryBlockSeconds']>=30 and any(e['first']['terrainClear']and e['first']['shipTrafficClear']for e in s['episodes']))
 result['stationaryWithPlannerDisagreement']={'games':len({n for n,id in confirmed_stalled}),**price(confirmed_stalled)}
 result['explicitPlannerDisagreementWitnesses']={'games':len({n for n,id in confirmed}),**price(confirmed),'meaning':'At least one saved episode-first witness had both planner checks clear and an actual physical solid collision; episode-first samples are not every-tick call logs.'}
 kinds=collections.defaultdict(set)
 for r in rows:
  for id,s in r['stats']['ships'].items():
   for e in s['episodes']:kinds[e['first']['obstruction']['kind']].add((r['name'],id,e['first']['obstruction']['id']))
 result['obstructionUniquePairs']={k:len(v)for k,v in kinds.items()}
 return result
pergame=[]
for r in games:
 byside={side:summary([o for o in owners if o['name']==r['name']and o['role']==side])for side in ('ours','theirs')}
 ships=[]
 for o in owners:
  if o['name']!=r['name']:continue
  for id,s in o['stats']['ships'].items():
   ships.append({'owner':o['owner'],'role':o['role'],'id':id,'gold':s['gold'],'peakCargoGold':s['maxCargoGold'],'conflictSeconds':s['conflictSeconds'],'immediateBlockSeconds':s['immediateBlockSeconds'],'stationaryBlockSeconds':s['stationaryBlockSeconds'],'episodes':len(s['episodes']),'first':s['episodes'][0]['first']})
 pergame.append({'name':r['name'],'duration':r['result']['gameSecond'],'winnerTeam':r['result']['winnerTeam'],'timeout':r['result']['timeout'],'ours':byside['ours'],'theirs':byside['theirs'],'ships':ships})
out={'games':len(games),'complete':len(games)==84,'ours':summary([o for o in owners if o['role']=='ours']),'theirs':summary([o for o in owners if o['role']=='theirs']),'bySubject':{subject:{side:summary([o for o in owners if o['role']==side and o['subject']==subject])for side in ('ours','theirs')}for subject in sorted({o['subject']for o in owners})},'byMap':{m:{side:summary([o for o in owners if o['role']==side and o['name'].startswith(m+' ')])for side in ('ours','theirs')}for m in sorted({r['name'].split()[0]for r in games})},'perGame':pergame}
print(json.dumps(out,indent=2))
