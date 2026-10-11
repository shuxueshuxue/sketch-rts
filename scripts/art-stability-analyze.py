#!/usr/bin/env python3
"""Offline descriptive analysis; never launches a browser or assigns a growth pass gate."""
import argparse
import csv
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

PHASES = [('warmup', 0, 120), ('same_cache', 120, 600),
          ('prepare_transitions', 600, 1200), ('dispose_recreate', 1200, 1800)]
ROOTS = ('cards', 'remains', 'combat', 'canvas', 'portraits', 'modelPortraits',
         'resources', 'models', 'renderer', 'modes')
COUNTERS = ('frames', 'simTicks', 'round', 'swaps', 'prepares', 'disposes',
            'deaths', 'hits', 'casts', 'evictedKeys', 'rasterBeforeReset',
            'retainedBeforeReset', 'peakBattleCards', 'lastDuration',
            'maxDuration', 'units', 'sceneObjects', 'domCanvases', 'glError')
KEY_METRICS = ('processes.rssSumBytes', 'processes.pssSumBytes',
               'processKind.gpu-process.rssBytes', 'processKind.gpu-process.pssBytes',
               'cdp.JSHeapUsedSize', 'cards.ownedCpuBytes', 'cards.ownedGpuBytes',
               'cards.peakOwnedCpuBytes', 'cards.peakOwnedGpuBytes',
               'renderer.memory.textures', 'renderer.memory.geometries',
               'renderer.programs', 'cdp.Nodes', 'cdp.JSEventListeners',
               'state.frames', 'state.evictedKeys', 'cards.rasterizations',
               'state.hits', 'state.casts', 'canvas.hits', 'canvas.misses')


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def flatten(value, prefix, output):
    if isinstance(value, dict):
        for key, item in value.items():
            flatten(item, f'{prefix}.{key}', output)
    elif numeric(value):
        output[prefix] = value


def complete_sum(items, key):
    values = [item.get(key) for item in items]
    return sum(values) * 1024 if values and all(numeric(v) for v in values) else None


def extract(row):
    state = row.get('state') or {}
    elapsed = state.get('elapsedMs')
    if not numeric(elapsed):
        raise ValueError(f"Sample {row.get('sample')} has no finite state.elapsedMs")
    values = {}
    for name in ROOTS:
        flatten(state.get(name), name, values)
    for name in COUNTERS:
        if numeric(state.get(name)):
            values[f'state.{name}'] = state[name]
    flatten(row.get('metrics'), 'cdp', values)
    for name in ('wallMs', 'samplingWallMs'):
        if numeric(row.get(name)):
            values[f'sampling.{name}'] = row[name]
    processes = row.get('processes') or []
    values['processes.count'] = len(processes)
    for key, label in [('rssKiB', 'rssSumBytes'), ('pssKiB', 'pssSumBytes'), ('privateKiB', 'privateSumBytes')]:
        total = complete_sum(processes, key)
        if total is not None:
            values[f'processes.{label}'] = total
    kinds = defaultdict(list)
    for process in processes:
        kinds[process.get('kind', 'unknown')].append(process)
        for field, label in [('rssKiB', 'rssBytes'), ('pssKiB', 'pssBytes'), ('privateKiB', 'privateBytes')]:
            if numeric(process.get(field)):
                values[f"processPid.{process['pid']}.{label}"] = process[field] * 1024
    for kind, group in kinds.items():
        values[f'processKind.{kind}.count'] = len(group)
        for field, label in [('rssKiB', 'rssBytes'), ('pssKiB', 'pssBytes'), ('privateKiB', 'privateBytes')]:
            total = complete_sum(group, field)
            if total is not None:
                values[f'processKind.{kind}.{label}'] = total
    return {'seconds': elapsed / 1000, 'sample': row.get('sample'), 'utc': row.get('utc'),
            'stage': state.get('stage'), 'values': values, 'source': row}


def distribution(values):
    if not values:
        return None
    return {'n': len(values), 'median': statistics.median(values), 'mean': statistics.fmean(values),
            'min': min(values), 'max': max(values), 'range': max(values) - min(values)}


def summarize(points):
    if not points:
        return None
    xs = [p[0] / 60 for p in points]
    ys = [p[1] for p in points]
    xmean, ymean = statistics.fmean(xs), statistics.fmean(ys)
    sxx = sum((x - xmean) ** 2 for x in xs)
    slope = sum((x - xmean) * (y - ymean) for x, y in zip(xs, ys)) / sxx if sxx else None
    syy = sum((y - ymean) ** 2 for y in ys)
    residual = sum((y - (ymean + slope * (x - xmean))) ** 2 for x, y in zip(xs, ys)) if slope is not None else None
    return {**distribution(ys), 'first': ys[0], 'last': ys[-1], 'endpointDelta': ys[-1] - ys[0],
            'observedStartSeconds': points[0][0], 'observedEndSeconds': points[-1][0],
            'olsSlopePerMinute': slope, 'olsRSquared': 1 - residual / syy if syy and residual is not None else None,
            'observedDecreases': sum(b < a for a, b in zip(ys, ys[1:])),
            'observedPositiveIncrements': sum(max(0, b - a) for a, b in zip(ys, ys[1:]))}


def aggregate(rows, start, end, window_seconds):
    selected = [r for r in rows if start <= r['seconds'] < end]
    names = sorted(set().union(*(r['values'].keys() for r in selected))) if selected else []
    observed_start = selected[0]['seconds'] if selected else None
    observed_end = selected[-1]['seconds'] if selected else None
    metrics = {}
    for name in names:
        points = [(r['seconds'], r['values'][name]) for r in selected if name in r['values']]
        first = [v for t, v in points if t < observed_start + window_seconds]
        last = [v for t, v in points if t >= observed_end - window_seconds]
        metrics[name] = {'whole': summarize(points), 'missingSamples': len(selected) - len(points),
                         'firstWindow': distribution(first), 'lastWindow': distribution(last),
                         'windowMedianChange': statistics.median(last) - statistics.median(first) if first and last else None}
    return {'plannedStartSeconds': start, 'plannedEndSeconds': end, 'samples': len(selected),
            'observedStartSeconds': observed_start, 'observedEndSeconds': observed_end,
            'stageCounts': dict(Counter(r['stage'] for r in selected)),
            'windows': {'seconds': window_seconds, 'anchor': 'first/last observed sample in this segment',
                        'firstStartSeconds': observed_start,
                        'firstEndExclusiveSeconds': min(end, observed_start + window_seconds) if selected else None,
                        'lastStartSeconds': max(start, observed_end - window_seconds) if selected else None,
                        'lastEndInclusiveSeconds': observed_end,
                        'overlap': observed_end - observed_start < 2 * window_seconds if selected else None},
            'metrics': metrics}


def transitions(rows):
    output = []
    previous = None
    for row in rows:
        state = row['source'].get('state') or {}
        if previous is not None:
            old = previous['source'].get('state') or {}
            changed = {key: {'before': old.get(key), 'after': state.get(key)}
                       for key in ('prepares', 'disposes', 'stage') if old.get(key) != state.get(key)}
            if changed:
                output.append({'sample': row['sample'], 'seconds': row['seconds'], 'changes': changed,
                               'releaseRecord': state.get('releaseRecord')})
        previous = row
    return output


def render_markdown(report):
    lines = ['# Sustained browser descriptive analysis', '',
             f"Samples: {report['sampling']['count']}; observed fixture duration: {report['sampling']['lastSeconds']:.1f} s.",
             '', 'No numerical growth threshold or analysis pass/fail is assigned. Slopes describe this sampled workload; they do not by themselves establish or disprove leaks.', '',
             'RSS sums count shared mappings repeatedly; PSS apportions shared resident pages. Both, GPU-process values and per-PID series are retained. Neither measures physical GPU VRAM. JS heap is the attached CDP target, not all browser heaps.', '',
             'Each phase reports its actual sampled stages and transitions. Protocol time windows do not imply prepare/dispose happened continuously. Missing fields remain absent/null, never zero-filled. Peak counters may reset on new renderer lifetimes and must not be summed.', '']
    for name, phase in report['phases'].items():
        lines += [f'## {name}', '', f"Planned {phase['plannedStartSeconds']/60:g}–{phase['plannedEndSeconds']/60:g} min; {phase['samples']} samples; stages {phase['stageCounts']}.", '',
                  'First/last windows span up to 60 seconds from the first/last observed sample; exact bounds and overlap are recorded in JSON. Byte metrics below are MiB; slopes are MiB/min. Counts retain native units.', '',
                  '| Metric | First window median [min, max] | Last window median [min, max] | OLS / min |', '| --- | ---: | ---: | ---: |']
        for metric in KEY_METRICS:
            value = phase['metrics'].get(metric)
            if not value:
                continue
            scale = 1024 ** 2 if metric.endswith('Bytes') or metric in ('cdp.JSHeapUsedSize', 'cdp.JSHeapTotalSize') else 1
            def window_text(part):
                return 'n/a' if not part else f"{part['median']/scale:.3f} [{part['min']/scale:.3f}, {part['max']/scale:.3f}]"
            slope = value['whole']['olsSlopePerMinute']
            lines.append(f"| {metric} | {window_text(value['firstWindow'])} | {window_text(value['lastWindow'])} | {'n/a' if slope is None else f'{slope/scale:.3f}'} |")
        lines.append('')
    lines += ['## Interpretation limits', '', *['- ' + note for note in report['limitations']], '',
              'Per-minute aggregates and all metric slopes/ranges are in the companion JSON/CSV. The runner completion outcome, errors and final release snapshot are preserved separately; completion is not a memory-stability verdict.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base = Path('docs/art/refactor/followup/browser-stability')
    parser.add_argument('--samples', type=Path, default=base / 'sustained.samples.jsonl')
    parser.add_argument('--run', type=Path, default=base / 'sustained.json')
    parser.add_argument('--out', type=Path, default=base / 'sustained.analysis.json')
    parser.add_argument('--allow-incomplete', action='store_true', help='Explicitly analyze a live/incomplete log; never treat it as the completed run.')
    args = parser.parse_args()
    raw = args.samples.read_bytes()
    parsed, ignored_tail = [], False
    lines = raw.splitlines()
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            if args.allow_incomplete and index == len(lines) - 1 and not raw.endswith(b'\n'):
                ignored_tail = True
            else:
                raise
    if not parsed:
        raise ValueError('No complete sample records')
    if not args.run.exists() and not args.allow_incomplete:
        parser.error('Run summary is absent. Wait for completion or explicitly use --allow-incomplete.')
    run = json.loads(args.run.read_text()) if args.run.exists() else None
    rows = [extract(row) for row in parsed]
    if any(b['seconds'] < a['seconds'] for a, b in zip(rows, rows[1:])):
        raise ValueError('Fixture elapsed time moved backwards; refusing to hide mixed runs')
    if len({r['sample'] for r in rows}) != len(rows):
        raise ValueError('Duplicate sample IDs; refusing to double count appended runs')
    if run and not args.allow_incomplete and run.get('samples') != len(rows):
        raise ValueError('Run summary sample count differs from log')
    if run and not args.allow_incomplete and run.get('last', {}).get('sample') != rows[-1]['sample']:
        raise ValueError('Run summary endpoint differs from log')
    last = rows[-1]['seconds']
    phases = {name: aggregate(rows, start, end, 60) for name, start, end in PHASES}
    for phase in phases.values():
        phase['plannedWindowElapsed'] = last >= phase['plannedEndSeconds']
    minutes = [dict(minute=index, **aggregate(rows, index * 60, (index + 1) * 60, 60))
               for index in range(int(last // 60) + 1)]
    intervals = [b['seconds'] - a['seconds'] for a, b in zip(rows, rows[1:])]
    report = {'input': {'samples': str(args.samples), 'samplesSha256': hashlib.sha256(raw).hexdigest(),
                        'run': str(args.run), 'runSha256': hashlib.sha256(args.run.read_bytes()).hexdigest() if args.run.exists() else None,
                        'explicitIncompleteMode': args.allow_incomplete, 'ignoredPartialLastLine': ignored_tail},
              'timebase': 'Fixture state.elapsedMs; runner wallMs and samplingWallMs retained as separate numeric metrics.',
              'sampling': {'count': len(rows), 'firstSeconds': rows[0]['seconds'], 'lastSeconds': last,
                           'intervalSeconds': distribution(intervals)},
              'runnerCompletion': run, 'phases': phases, 'minutes': minutes,
              'post30Minutes': aggregate(rows, 1800, max(1800.001, last + 0.001), 60),
              'transitions': transitions(rows),
              'processInventory': sorted({(p.get('pid'), p.get('ppid'), p.get('kind')) for row in parsed for p in row.get('processes', [])}),
              'sampleEvidence': [{'sample': r['sample'], 'seconds': r['seconds'], 'utc': r['utc'], 'stage': r['stage'],
                                 'running': r['source'].get('state', {}).get('running'),
                                 'failure': r['source'].get('state', {}).get('failure'), 'values': r['values']} for r in rows],
              'limitations': [
                  'OLS uses individual sampled points against actual elapsed minutes. It is descriptive; autocorrelation, workload variation and collection jitter preclude an automatic leak verdict or a confidence claim.',
                  'RSS is resident mapped memory with shared-page double counting in process sums. PSS distributes shared residency. Private bytes are also retained, but none is GPU VRAM or a complete application ownership ledger.',
                  'Per-process values and process kinds are retained; process creation/exit changes aggregate composition. Missing PSS for any process makes that aggregate missing, not zero.',
                  'Cache current/peak counters are scoped to their producer/lifetime. Renderer recreation can reset rasterizations, textures and peaks. observedDecreases flags sampled resets/evictions, while positive increments are not exact totals when resets occur between samples.',
                  'rasterBeforeReset and current rasterizations are reported separately, never blindly summed: dispose/recreation and prepare accounting may refer to different producer lifetimes.',
                  'frames/hits/casts/evictedKeys and action modes are workload counters, not all per-frame effects or a proof of whole-game/AI coverage. Scene transitions are reported from observed prepares/disposes and stage changes.',
                  'Sampling approximately every ten seconds can miss transient allocation/resource peaks and brief prepare/dispose states. Final-release observations after 30 minutes are separated from the four requested phases.',
                  'Byte metrics preserve native units in JSON/CSV; Markdown converts bytes to MiB. Counter slopes are not memory-growth slopes. First/last-window differences are descriptive and may overlap in short/incomplete segments.',
                  'Analysis does not introduce growth thresholds, a memory pass/fail, forced GC, browser restarts or adjustments to original evidence.'
              ]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    args.out.with_suffix('.md').write_text(render_markdown(report))
    with args.out.with_suffix('.minutes.csv').open('w', newline='') as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(['minute', 'metric', 'n', 'median', 'min', 'max', 'range', 'olsPerMinute', 'first', 'last', 'endpointDelta', 'observedDecreases', 'missingSamples'])
        for minute in minutes:
            for metric, entry in minute['metrics'].items():
                value = entry['whole']
                writer.writerow([minute['minute'], metric, value['n'], value['median'], value['min'], value['max'], value['range'], value['olsSlopePerMinute'], value['first'], value['last'], value['endpointDelta'], value['observedDecreases'], entry['missingSamples']])
    print(json.dumps({'analysis': str(args.out), 'samples': len(rows), 'observedSeconds': last,
                      'incompleteMode': args.allow_incomplete, 'runnerOutcome': run.get('passed') if run else None,
                      'note': 'Runner completion is not an analysis memory-stability verdict.'}))


if __name__ == '__main__':
    main()
