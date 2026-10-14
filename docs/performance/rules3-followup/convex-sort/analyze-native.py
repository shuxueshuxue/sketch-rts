#!/usr/bin/env python3
"""Recompute the complete native measurements from the archived raw tick bytes."""
import base64
import gzip
import hashlib
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
ORIGIN = '/workspace/whole-performance-abba-e51-eef'


def distribution(values):
    ordered = sorted(values)
    n = len(values)
    q = lambda p: ordered[max(0, math.ceil(n * p) - 1)]
    return {'n': n, 'mean': sum(values) / n, 'median': q(.5), 'p95': q(.95),
            'p99': q(.99), 'max': ordered[-1],
            'over16': sum(v > 16 for v in values), 'over50': sum(v > 50 for v in values)}


def main():
    manifest = json.loads((OUT / 'manifest.json').read_text())
    lookup = {base64.b64decode(row['originalPathBase64']).decode(): row for row in manifest['files']}

    def load(path):
        row = lookup[path]
        raw = gzip.decompress((OUT / row['storedPath']).read_bytes())
        if path.endswith('.gz'):
            raw = gzip.decompress(raw)
        return json.loads(raw)

    ticks = {arm: load(f'{ORIGIN}/{arm}/ticks.json.gz') for arm in ['A1', 'B1', 'B2', 'A2', 'Bplain']}
    summaries = {arm: load(f'{ORIGIN}/{arm}/summary.json') for arm in ticks}
    per_run = {}
    for arm, rows in ticks.items():
        if len(rows) != 14400 or any((row['tick'], row['tickAfter'], row['mod15']) !=
                                   (index, index + 1, index % 15) for index, row in enumerate(rows)):
            raise ValueError('Incomplete or reordered native ticks')
        fields = ['wholeMs'] if arm == 'Bplain' else ['wholeMs', 'simMs', 'aiMs']
        metrics = {field: distribution([row[field] for row in rows]) for field in fields}
        for field in fields:
            for key in ['mean', 'p95', 'p99', 'max', 'over16', 'over50']:
                if abs(metrics[field][key] - summaries[arm]['timing'][field][key]) > 1e-8:
                    raise ValueError('Summary and complete raw ticks differ')
        metrics['maxTick'] = max(rows, key=lambda row: row['wholeMs'])['tick']
        metrics['top25'] = sorted(rows, key=lambda row: row['wholeMs'], reverse=True)[:25]
        metrics['allOver50'] = [row for row in rows if row['wholeMs'] > 50]
        metrics['timingHooksEnabled'] = arm != 'Bplain'
        metrics['targetPassed'] = metrics['wholeMs']['p99'] <= 16 and metrics['wholeMs']['max'] <= 50
        per_run[arm] = metrics
    pooled = {}
    for arm, names in [('A', ['A1', 'A2']), ('B', ['B1', 'B2'])]:
        rows = [row for name in names for row in ticks[name]]
        pooled[arm] = {field: distribution([row[field] for row in rows])
                       for field in ['wholeMs', 'simMs', 'aiMs']}
        for name, planning in [('planningWhole', True), ('nonPlanningWhole', False)]:
            selected = [row for row in rows if (row['mod15'] == 0) == planning]
            pooled[arm][name] = distribution([row['wholeMs'] for row in selected])
    deltas = {field: [] for field in ['wholeMs', 'simMs', 'aiMs']}
    minute_blocks = []
    for index in range(14400):
        for field in deltas:
            a = (ticks['A1'][index][field] + ticks['A2'][index][field]) / 2
            b = (ticks['B1'][index][field] + ticks['B2'][index][field]) / 2
            deltas[field].append(b - a)
    for minute in range(12):
        block = {'minute': minute + 1, 'firstTick': minute * 1200, 'lastTick': (minute + 1) * 1200 - 1}
        for field in deltas:
            values = deltas[field][minute * 1200:(minute + 1) * 1200]
            block[field + 'MeanDeltaBMinusA'] = sum(values) / len(values)
        minute_blocks.append(block)
    paired = []
    for a, b in [('A1', 'B1'), ('A2', 'B2')]:
        old, new = per_run[a]['wholeMs']['mean'], per_run[b]['wholeMs']['mean']
        paired.append({'reference': a, 'candidate': b, 'meanGainPercent': (old - new) / old * 100})
    result = {'schema': 1, 'status': 'not-adopted-experiment', 'complete': True,
              'wholeGainEstablished': False, 'performanceTargetPassed': False,
              'metric': 'native complete tick, excluding separately recorded rendering snapshot, observer and disk',
              'pooled': pooled, 'perRun': per_run, 'pairedMeanGainPercent': paired,
              'tickMatchedMeanDeltaBMinusA': {field: sum(values) / len(values) for field, values in deltas.items()},
              'minuteBlocks': minute_blocks,
              'minuteBlocksWithImprovement': {field: sum(row[field + 'MeanDeltaBMinusA'] < 0 for row in minute_blocks)
                                             for field in deltas},
              'allRawTicksRetained': True, 'removedOutliers': 0, 'allTickZeroSamplesRetained': True,
              'bplainLimit': 'AI/sim zero and empty ownerPlans mean disabled timing hooks, not zero cost or absent planning',
              'method': 'nearest-rank ceil(n*p)-1; complete ABBA samples only; Bplain excluded from pooling',
              'toolSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    target = OUT / 'statistics.json'
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if target.exists() and target.read_text() != encoded:
        raise ValueError('Refuse to overwrite different native statistics')
    target.write_text(encoded)
    print(json.dumps({'complete': True, 'targetPassed': False,
                      'pooledWholeMeanA': pooled['A']['wholeMs']['mean'],
                      'pooledWholeMeanB': pooled['B']['wholeMs']['mean'],
                      'maxTicks': {arm: per_run[arm]['maxTick'] for arm in per_run}}))


if __name__ == '__main__':
    main()
