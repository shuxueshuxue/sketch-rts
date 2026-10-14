#!/usr/bin/env python3
"""Join focused-run attribution with complete original spike and new outlier sets."""
import argparse
import collections
import gzip
import hashlib
import json
import pathlib
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=pathlib.Path, help='New comparison output; retain the original captured comparison')
parser.add_argument('analyses', type=pathlib.Path, nargs=2, help='Original run1 and run2 analysis JSON, in order')
parser.add_argument('--original-dir', type=pathlib.Path,
    default=pathlib.Path('docs/performance/six-player-ticks/runs/step3-border'),
    help='Original step3 oracle directory; default is relative to the repository root')
parser.add_argument('--run-dir', type=pathlib.Path, action='append',
    help='Override a recorded capture directory; supply twice in analysis order for an archived checkout')
args = parser.parse_args()
if args.run_dir is not None and len(args.run_dir) != len(args.analyses):
    parser.error('--run-dir must be supplied exactly twice, matching analysis order')
inputs = args.analyses
load = lambda p: json.loads(gzip.open(p, 'rt').read()) if str(p).endswith('.gz') else json.loads(p.read_text())
analyses = [load(path) for path in inputs]
runs = []
for index, analysis in enumerate(analyses):
    directory = args.run_dir[index] if args.run_dir is not None else pathlib.Path(analysis['inputDirectory'])
    for name, expected in analysis['inputHashes'].items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Archived analysis input hash differs: {directory / name}')
    runs.append({'analysis': analysis, 'ticks': {t['tick']: t for t in load(directory/'ticks.json.gz')},
        'diag': load(directory/'focused-diagnostics.json.gz')})
selected = [row['tick'] for row in analyses[0]['focusedTicks']]
original = {row['tick']: row for row in load(args.original_dir / 'ticks.json.gz')}
result = {'schema': 1, 'sourceHead': '086dffc5ae9e895f38e56f5ddedfa2ab0d7ac86d',
    'runs': [{'directory': str(args.run_dir[index]) if args.run_dir is not None else a['inputDirectory'], 'identity': a['identity'], 'cpuWindowCount':len(a['cpuWindows']),
        'over50Count':len(a['diagnosticRunOver50Ticks']), 'selectedOver50Count':sum(r['focusedRunTiming']['wholeMs']>50 for r in a['focusedTicks'])} for index, a in enumerate(analyses)],
    'method': 'Two attribution runs of the same frozen source and command scenario. Run 1 includes verified focused CPU windows; run 2 omits CPU profiling but retains scopes and GC. These runs do not establish optimization gains.',
    'selectedTicks':[], 'neighbors':[], 'newOutliers':[],
    'analysisInputHashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}}
for tick in selected:
    rr = [next(r for r in a['focusedTicks'] if r['tick']==tick) for a in analyses]
    result['selectedTicks'].append({'tick':tick, 'originalTiming':rr[0]['originalStep3Timing'],
        'structuralFactsEqualAcrossRuns':all(row['structuralEvents']==rr[0]['structuralEvents'] for row in rr),
        'structuralEvents':rr[0]['structuralEvents'],
        'runAttributions':[{key:r[key] for key in ('focusedRunTiming','ownerPlans','topExclusiveScopes','simulationScopes','topScripts','gcEntriesIntersectingTick','gcIntersectionMs')} for r in rr]})
for tick in sorted({n for t in selected for n in (t-1,t,t+1) if n in original}):
    result['neighbors'].append({'tick':tick,'original':{key:original[tick][key] for key in ('wholeMs','simMs','aiMs','units','buildings')},
        'runs':[{key:run['ticks'][tick][key] for key in ('wholeMs','simMs','aiMs','units','buildings')} for run in runs]})
for index,run in enumerate(runs):
    clocks = {row['tick']:row for row in run['diag']['clocks']}
    scoped={row['tick']:row for row in run['diag']['scopedTicks']}
    for tick,t in run['ticks'].items():
        if t['wholeMs']<=50 or tick in selected:continue
        c=clocks[tick];gc=[]
        for g in run['diag']['gcEntries']:
            overlap=max(0,min(c['endedMs'],g['startTime']+g['duration'])-max(c['startedMs'],g['startTime']))
            if overlap:gc.append({**g,'tickOverlapMs':overlap})
        previous=run['ticks'].get(tick-1,t)
        result['newOutliers'].append({'runIndex':index,'tick':tick,'timing':{key:t[key] for key in ('wholeMs','simMs','aiMs','units','buildings')},
            'originalTiming':{key:original[tick][key] for key in ('wholeMs','simMs','aiMs','units','buildings')},
            'ownerPlans':t['ownerPlans'],'gcEntriesIntersectingTick':gc,'gcIntersectionMs':sum(g['tickOverlapMs'] for g in gc),
            'unitCountDelta':t['units']-previous['units'],'buildingCountDelta':t['buildings']-previous['buildings'],
            'scopes':scoped.get(tick), 'scopeCaveat':None if tick in scoped else 'Outside chosen focus windows: only coarse timings and GC association; no precise phase/root-cause claim.'})
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'output':str(args.output),'runs':result['runs'],'selected':len(result['selectedTicks']),'neighbors':len(result['neighbors']),'newOutliers':len(result['newOutliers'])},indent=2))
