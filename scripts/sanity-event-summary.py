"""Report ALL predeclared event ticks alongside resource use; no outlier removal."""
import gzip,json,statistics,sys
from pathlib import Path
root=Path(sys.argv[1]); selection=json.loads((root/'event-selection.json').read_text())
events=[e['tick'] for e in selection['events']]; runs={arm:[] for arm in 'AB'}
for name,_,plain in json.loads((root/'plan.json').read_text())['order']:
    if plain: continue
    arm=name.split('-')[1][0]
    ticks=json.loads(gzip.decompress((root/name/'ticks.json.gz').read_bytes()))
    runs[arm].append((name,ticks))
rows=[]
for tick in events:
    row={'tick':tick}
    for arm in 'AB':
        values=[ticks[tick]['wholeMs'] for _,ticks in runs[arm]]
        row[arm]={'valuesMs':values,'meanMs':statistics.mean(values)}
    row['speedup']=row['A']['meanMs']/row['B']['meanMs'];rows.append(row)
journal=json.loads((root/'journal.json').read_text()); resource={}
for arm in 'AB':
    items=[r for r in journal if r['name'].startswith('r') and '-'+arm in r['name']]
    resource[arm]={'wallSeconds':[r['wallSeconds'] for r in items],
      'cpuSeconds':[r['resource']['userSeconds']+r['resource']['systemSeconds'] for r in items],
      'maxRssKiB':[r['resource']['maxRssKiB'] for r in items],
      'eventTotalMs':[sum(ticks[t]['wholeMs'] for t in events) for _,ticks in runs[arm]]}
result={'selection':selection,'eventCount':len(events),'rows':rows,'resources':resource,
 'eventsAtLeast10x':sum(r['speedup']>=10 for r in rows),
 'eventTotalSpeedup':statistics.mean(resource['A']['eventTotalMs'])/statistics.mean(resource['B']['eventTotalMs'])}
print(json.dumps(result,indent=2))
