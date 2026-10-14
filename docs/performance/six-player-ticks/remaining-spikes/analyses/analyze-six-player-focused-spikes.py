#!/usr/bin/env python3
"""Read-only focused diagnostic interpretation; no simulation/test execution."""
import argparse
import collections
import gzip
import hashlib
import json
import pathlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('run', type=pathlib.Path, help='Directory containing the pinned focused capture')
parser.add_argument('output', type=pathlib.Path, help='New analysis output; retain the original captured analysis')
parser.add_argument('--original-dir', type=pathlib.Path,
    default=pathlib.Path('docs/performance/six-player-ticks/runs/step3-border'),
    help='Original step3 oracle directory; default is relative to the repository root')
args = parser.parse_args()
run = args.run
out = args.output
load = lambda p: json.loads(gzip.open(p, 'rt').read()) if str(p).endswith('.gz') else json.loads(p.read_text())
diag = load(run / 'focused-diagnostics.json.gz')
ticks = load(run / 'ticks.json.gz')
summary = load(run / 'summary.json')
original = load(args.original_dir / 'ticks.json.gz')
original_by = {row['tick']: row for row in original}
by_tick = {row['tick']: row for row in ticks}
clocks = {row['tick']: row for row in diag['clocks']}
scopes = {row['tick']: row for row in diag['scopedTicks']}
facts = {row['tick']: row for row in diag['focusedFacts']}

def overlap(a0, a1, b0, b1):
    return max(0, min(a1, b1) - max(a0, b0))

def gc_for(tick):
    clock = clocks[tick]
    associated = []
    for gc in diag['gcEntries']:
        ms = overlap(clock['startedMs'], clock['endedMs'], gc['startTime'], gc['startTime'] + gc['duration'])
        if ms:
            associated.append({**gc, 'overlapWithWholeTickMs': ms})
    return associated

rows = []
for tick in diag['focusTicks']:
    own = scopes[tick]['scopes']
    gc = gc_for(tick)
    timing_keys = ('wholeMs', 'simMs', 'aiMs', 'frameMs', 'otherSnapshotMs', 'renderSnapshotMs', 'observerMs')
    rows.append({
        'tick': tick,
        'originalStep3Timing': {key: original_by[tick][key] for key in timing_keys},
        'focusedRunTiming': {key: by_tick[tick][key] for key in timing_keys},
        'ownerPlans': by_tick[tick]['ownerPlans'],
        'topExclusiveScopes': sorted(own, key=lambda s: s['exclusiveMs'], reverse=True)[:12],
        'simulationScopes': [s for s in own if not s.get('owner')],
        'topScripts': sorted([s for s in own if s['name'] in ('script.run', 'script.claimsUnits')], key=lambda s: s['inclusiveMs'], reverse=True)[:10],
        'gcEntriesIntersectingTick': gc,
        'gcIntersectionMs': sum(g['overlapWithWholeTickMs'] for g in gc),
        'structuralEvents': {key: facts[tick][key] for key in ('tickAfter', 'spawnedUnits', 'newBuildings')},
        'neighborTimings': [{key: by_tick[neighbor][key] for key in ('tick', 'wholeMs', 'simMs', 'aiMs', 'units', 'buildings')} for neighbor in (tick - 1, tick, tick + 1) if neighbor in by_tick],
    })

cpu_windows = []
for window in diag['profileWindows']:
    profile = load(run / window['file'])
    # Revalidate rather than relying solely on the archived Boolean.
    verified = (window['beforeStart']['hrtimeUs'] <= profile['startTime'] <= window['afterStart']['hrtimeUs']
        and window['beforeStop']['hrtimeUs'] <= profile['endTime'] <= window['afterStop']['hrtimeUs'])
    if verified != window['clockVerified']:
        raise ValueError('Archived profiler clock verdict differs from recomputation')
    nodes = {node['id']: node for node in profile['nodes']}
    parents = {child: node['id'] for node in profile['nodes'] for child in node.get('children', [])}
    cpu_rows = []
    if verified:
        samples = []
        timestamp = profile['startTime']
        for node_id, delta in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
            previous = timestamp
            timestamp += delta
            samples.append((node_id, previous, timestamp))
        for tick in range(window['from'], window['to'] + 1):
            clock = clocks[tick]
            counts = collections.Counter()
            weighted = collections.Counter()
            ancestor_counts = collections.Counter()
            ancestors_weighted = collections.Counter()
            for node_id, previous, timestamp in samples:
                if clock['startedHrUs'] <= timestamp <= clock['endedHrUs']:
                    counts[node_id] += 1
                    duration = overlap(clock['startedHrUs'], clock['endedHrUs'], previous, timestamp) / 1000
                    weighted[node_id] += duration
                    current = node_id
                    visited = set()
                    while current in nodes:
                        # Function-name totals count an ancestor once per sample, including recursive stacks.
                        frame = nodes[current]['callFrame']
                        key = (frame['functionName'], frame['url'], frame['lineNumber'])
                        if key not in visited:
                            ancestor_counts[key] += 1
                            ancestors_weighted[key] += duration
                            visited.add(key)
                        current = parents.get(current)
            top_self = []
            for node_id, count in counts.most_common(20):
                stack = []
                current = node_id
                while current in nodes:
                    stack.append(nodes[current]['callFrame'])
                    current = parents.get(current)
                top_self.append({'nodeId': node_id, 'sampleCount': count, 'sampleIntervalEstimateMs': weighted[node_id], 'stackLeafToRoot': stack})
            cpu_rows.append({'tick': tick, 'wholeMs': by_tick[tick]['wholeMs'], 'sampleCount': sum(counts.values()),
                'sampleIntervalEstimateMs': sum(weighted.values()), 'topSelfSamples': top_self,
                'topInclusiveFunctions': [{'functionName': key[0], 'url': key[1], 'lineNumber': key[2], 'sampleCount': count,
                    'sampleIntervalEstimateMs': ancestors_weighted[key]} for key, count in ancestor_counts.most_common(60)]})
    cpu_windows.append({**window, 'revalidatedClockVerified': verified,
        'profilerStartOutsideTickDelayMs': window['afterStart']['performanceMs'] - window['beforeStart']['performanceMs'], 'ticks': cpu_rows})

command_bytes = gzip.open(run / 'command-frames.jsonl.gz', 'rb').read()
command_sha = hashlib.sha256(command_bytes).hexdigest()
old_bytes = gzip.open(args.original_dir / 'command-frames.jsonl.gz', 'rb').read()
result = {
    'schema': 1, 'inputDirectory': str(run),
    'identity': {'finalChecksum': summary['finalChecksum'], 'commandLogSha256': command_sha,
        'commandLogMatchesSummary': command_sha == summary['commandLogSha256'],
        'completeCommandBytesMatchOriginalStep3': command_bytes == old_bytes,
        'frames': len(ticks), 'finalTick': summary['finalTick']},
    'method': {
        'scopeTimes': 'Inclusive wall time; exclusive subtracts only instrumented children. GC, scheduling pause, uninstrumented work and observer overhead remain included.',
        'gcTimes': 'Intersection of asynchronous Node GC entry interval with measured whole tick interval. Association only; no subtraction from script or simulation wall time.',
        'cpuAlignment': 'Revalidated start/end profiler timestamp brackets against process.hrtime, then accumulated raw timeDeltas and selected only samples whose timestamps lie in raw tick hrtime anchors.',
        'cpuSampleWeights': 'Approximate conventional allocation of preceding sample interval to current sampled stack, clipped to tick interval. Sample counts and raw stack locations are primary evidence; estimates are not exclusive CPU measurements.',
        'profilerPerturbation': ('Profiler start delays occur before measured ticks and are recorded. Diagnostic timings are attribution evidence; performance claims require separate diagnostics-off interleaved runs.' if diag['profileWindows'] else 'This run did not enable CPU profiling. Scoped hooks and GC observation still make this an attribution run, not the diagnostics-off performance comparison.'),
        'tickConvention': diag['method']['tickConvention'],
        'nonFocusedSpikes': 'The diagnostic run can move GC/scheduler outliers. Original selected ticks are all retained, including ones that no longer exceed 50 ms.'
    },
    'focusedTicks': rows, 'cpuWindows': cpu_windows,
    'diagnosticRunOver50Ticks': [{key: t[key] for key in ('tick', 'wholeMs', 'simMs', 'aiMs', 'units', 'buildings')} for t in ticks if t['wholeMs'] > 50],
    'allProfileClocksVerified': all(w['revalidatedClockVerified'] for w in cpu_windows),
    'inputHashes': {name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in ('focused-diagnostics.json.gz', 'ticks.json.gz', 'summary.json', 'command-frames.jsonl.gz')}
}
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': str(out), 'identity': result['identity'], 'allProfileClocksVerified': result['allProfileClocksVerified'], 'selectedTicks': len(rows), 'diagnosticOver50': len(result['diagnosticRunOver50Ticks'])}, indent=2))
