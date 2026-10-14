#!/usr/bin/env python3
"""Compare explicit A1/B1/B2/A2 probes without running a simulation or benchmark.

Example:
  python analyze-six-player-spike-abba.py A1_DIRECTORY B1_DIRECTORY B2_DIRECTORY A2_DIRECTORY \
    --original-dir ORIGINAL_STEP3_DIRECTORY --output OUTPUT_JSON

All tick samples remain in their native distributions, including tick 0 and any
GC or scheduling outlier. No significance test or pooled distribution is made.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

ORIGINAL_SPIKE_TICKS = (0, 1859, 5280, 6990, 7560, 8850, 9000, 9375, 9900,
    10065, 10860, 10960, 11085, 11265, 12480, 12705, 12885, 12945,
    13500, 13905, 13920)
LABELS = ('A1', 'B1', 'B2', 'A2')
METRICS = ('mean', 'p95', 'p99', 'max', 'over50')
TIMING_KEYS = ('wholeMs', 'simMs', 'aiMs')
MEMORY_KEYS = ('rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers')
EXPECTED_TICKS = 14400
EXPECTED_CHECKSUM = '7d94a5e8'
EXPECTED_COMMAND_SHA = '771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(value):
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def load(path):
    if str(path).endswith('.gz'):
        with gzip.open(path, 'rt') as handle:
            return json.load(handle)
    return json.loads(path.read_text())


def distribution(values):
    ordered = sorted(values)
    if not ordered:
        return {'count': 0, 'mean': 0, 'median': 0, 'p95': 0, 'p99': 0,
            'max': 0, 'over16': 0, 'over50': 0}
    if any(not math.isfinite(value) or value < 0 for value in ordered):
        raise ValueError('Nonfinite or negative timing value')
    quantile = lambda fraction: ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]
    # Match the probe's sorted left-to-right sum and nearest-rank quantiles.
    return {'count': len(ordered), 'mean': sum(ordered) / len(ordered),
        'median': quantile(.5), 'p95': quantile(.95), 'p99': quantile(.99),
        'max': ordered[-1], 'over16': sum(value > 16 for value in ordered),
        'over50': sum(value > 50 for value in ordered)}


def same_distribution(actual, declared):
    for key, value in actual.items():
        if key not in declared:
            continue
        if isinstance(value, float):
            if not math.isclose(value, declared[key], rel_tol=1e-12, abs_tol=1e-9):
                return False
        elif value != declared[key]:
            return False
    return True


def production_inputs(environment):
    return {entry['path']: {'bytes': entry['bytes'], 'sha256': entry['sha256']}
        for entry in environment['sourceInputs'] if entry['path'].startswith('src/')}


def stable_environment(environment):
    cpus = environment['cpus']
    return {key: environment[key] for key in ('node', 'v8', 'esbuild', 'typescript',
        'platform', 'release', 'totalMemory', 'processExecArgv')} | {
        'logicalCpuCount': len(cpus), 'cpuModelsByIndex': [cpu['model'] for cpu in cpus]}


def read_run(label, directory):
    summary = load(directory / 'summary.json')
    ticks = load(directory / 'ticks.json.gz')
    environment = load(directory / 'environment.json')
    with gzip.open(directory / 'command-frames.jsonl.gz', 'rb') as handle:
        command_bytes = handle.read()
    command_lines = command_bytes.splitlines()
    command_sha = digest(command_bytes)
    checks = {
        'tickCount14400': len(ticks) == EXPECTED_TICKS,
        'summaryCount14400': all(summary[key] == EXPECTED_TICKS for key in ('ticks', 'frames', 'finalTick')),
        'tickSequenceComplete': [t['tick'] for t in ticks] == list(range(EXPECTED_TICKS)),
        'tickAfterSequenceComplete': all(t['tickAfter'] == t['tick'] + 1 for t in ticks),
        'commandCount14400': len(command_lines) == EXPECTED_TICKS,
        'commandTickSequenceComplete': [json.loads(line)['tick'] for line in command_lines] == list(range(EXPECTED_TICKS)),
        'commandShaMatchesSummary': command_sha == summary['commandLogSha256'],
        'commandBytesMatchesSummary': len(command_bytes) == summary['commandLogBytes'],
        'commandShaMatchesOriginalOracle': command_sha == EXPECTED_COMMAND_SHA,
        'finalChecksumMatchesOriginalOracle': summary['finalChecksum'] == EXPECTED_CHECKSUM,
    }
    options = environment.get('options', {})
    checks['diagnosticsOff'] = (not options.get('focusTicks') and not options.get('observeGc')
        and not options.get('cpuProfWindows') and options.get('cpuProfFrom') is None
        and 'diagnosticOutput' not in summary.get('method', {}))
    checks['normalTimedProbe'] = not options.get('plain') and not summary.get('method', {}).get('plainSource', False)
    planning = [tick for tick in ticks if tick['ownerPlans']]
    non_planning = [tick for tick in ticks if not tick['ownerPlans']]
    checks['planningCount960'] = len(planning) == 960
    checks['planningMod15Zero'] = all(tick['tick'] % 15 == 0 and tick['mod15'] == 0 for tick in planning)
    checks['planningHasFiveOwners'] = all(len(tick['ownerPlans']) == 5 for tick in planning)
    distributions = {stratum: {key: distribution([tick[key] for tick in subset]) for key in TIMING_KEYS}
        for stratum, subset in (('all', ticks), ('planning', planning), ('nonPlanning', non_planning))}
    checks['summaryTimingsRecomputedMatch'] = all(same_distribution(distributions['all'][key], summary['timing'][key]) for key in TIMING_KEYS)
    checks['summaryPlanningWholeRecomputedMatch'] = same_distribution(distributions['planning']['wholeMs'], summary['planningTicks']['whole'])
    projection = [{key: tick[key] for key in ('tick', 'tickAfter', 'mod15', 'units', 'buildings')}
        | {'ownerPlans': [{'owner': plan['owner'], 'version': plan['version']} for plan in tick['ownerPlans']]}
        for tick in ticks]
    memory_observations = summary['memory'].get('observations', [])
    public = {'label': label, 'directory': str(directory), 'recordedAt': environment['recordedAt'],
        'gitHead': environment['gitHead'], 'gitStatus': environment['gitStatus'],
        'productionSourceInputsSha256': canonical_sha(production_inputs(environment)),
        'probeSha256': environment['probeSha256'], 'sourceManifestSha256': environment['sourceManifestSha256'],
        'bundleSha256': environment['bundleSha256'], 'stableEnvironment': stable_environment(environment),
        'freeMemoryAtCaptureBytes': environment['freeMemory'], 'options': options,
        'argv': environment['argv'], 'identityChecks': checks,
        'commandSha256': command_sha, 'commandBytes': len(command_bytes), 'finalChecksum': summary['finalChecksum'],
        'tickPhaseAndEntityCountsSha256': canonical_sha(projection), 'distributions': distributions,
        'winner': summary['winner'], 'initial': summary['initial'], 'final': summary['final'],
        'processWallMs': summary['processWallMs'],
        'memory': {'before': summary['memory']['before'], 'after': summary['memory']['after'],
            'observations': memory_observations,
            'sampledMaximumBytes': {key: max((sample[key] for sample in memory_observations), default=0) for key in MEMORY_KEYS}},
        'inputFileHashes': {name: digest((directory / name).read_bytes()) for name in
            ('summary.json', 'ticks.json.gz', 'environment.json', 'command-frames.jsonl.gz')}}
    return {'public': public, 'summary': summary, 'environment': environment,
        'ticks': ticks, 'byTick': {tick['tick']: tick for tick in ticks}, 'commandBytes': command_bytes}


def compare_inputs(before, candidate):
    rows = []
    for path in sorted(before.keys() | candidate.keys()):
        if before.get(path) != candidate.get(path):
            rows.append({'path': path, 'before': before.get(path), 'candidate': candidate.get(path)})
    return rows


def reduction(before, candidate):
    return None if before == 0 else (before - candidate) / before * 100


def contrasts(before_run, candidate_run):
    rows = []
    for stratum in ('all', 'planning', 'nonPlanning'):
        for timing in TIMING_KEYS:
            for metric in METRICS:
                before = before_run['public']['distributions'][stratum][timing][metric]
                candidate = candidate_run['public']['distributions'][stratum][timing][metric]
                rows.append({'stratum': stratum, 'timing': timing, 'metric': metric,
                    'before': before, 'candidate': candidate,
                    'candidateMinusBefore': candidate - before,
                    'reductionPercent': reduction(before, candidate)})
    return {'beforeLabel': before_run['public']['label'], 'candidateLabel': candidate_run['public']['label'], 'metrics': rows}


def tick_view(run, tick):
    row = run['byTick'][tick]
    return {key: row[key] for key in ('tick', 'tickAfter', 'mod15', 'wholeMs', 'simMs', 'aiMs', 'frameMs', 'units', 'buildings', 'ownerPlans')} | {'over50': row['wholeMs'] > 50}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for label in LABELS:
        parser.add_argument(label.lower(), type=Path, help=f'{label} directory; explicit fixed ABBA order')
    parser.add_argument('--original-dir', type=Path, default=Path('/workspace/six-player-tick-runs/step3-border'))
    parser.add_argument('--output', type=Path, default=Path('/workspace/six-player-spike-abba-analysis.json'))
    args = parser.parse_args()
    runs = [read_run(label, getattr(args, label.lower())) for label in LABELS]
    original_summary = load(args.original_dir / 'summary.json')
    original_environment = load(args.original_dir / 'environment.json')
    original_ticks = {tick['tick']: tick for tick in load(args.original_dir / 'ticks.json.gz')}
    with gzip.open(args.original_dir / 'command-frames.jsonl.gz', 'rb') as handle:
        original_command_bytes = handle.read()
    production = [production_inputs(run['environment']) for run in runs]
    stable_environments = [stable_environment(run['environment']) for run in runs]
    metadata_keys = ('roomId', 'mapId', 'rulesVersion', 'checksumVersion', 'ticks', 'frames', 'finalTick')
    global_checks = {
        'allIndividualChecksPass': all(all(run['public']['identityChecks'].values()) for run in runs),
        'fourDistinctRunDirectories': len({str(Path(run['public']['directory']).resolve()) for run in runs}) == 4,
        'recordedAtChronologicalABBAOrder': all(runs[index]['public']['recordedAt'] < runs[index + 1]['public']['recordedAt'] for index in range(3)),
        'beforeProductionInputsMatchOriginal': production[0] == production_inputs(original_environment),
        'sameProbeShaAllFour': len({run['environment']['probeSha256'] for run in runs}) == 1,
        'sameStableEnvironmentAllFour': all(env == stable_environments[0] for env in stable_environments),
        'sameProductionInputsA1A2': production[0] == production[3],
        'sameProductionInputsB1B2': production[1] == production[2],
        'nativeCommandBytesAllFourMatchOriginal': all(run['commandBytes'] == original_command_bytes for run in runs),
        'sameTickPhaseAndEntityCountsAllFour': len({run['public']['tickPhaseAndEntityCountsSha256'] for run in runs}) == 1,
        'metadataAllFourMatchesOriginal': all(all(run['summary'][key] == original_summary[key] for key in metadata_keys) for run in runs),
        'allFinalChecksumsMatchOriginal': all(run['summary']['finalChecksum'] == original_summary['finalChecksum'] == EXPECTED_CHECKSUM for run in runs),
        'originalCommandShaMatchesExpected': digest(original_command_bytes) == EXPECTED_COMMAND_SHA,
    }
    pairs = [contrasts(runs[0], runs[1]), contrasts(runs[3], runs[2])]
    averages = []
    for first, second in zip(pairs[0]['metrics'], pairs[1]['metrics']):
        before_values = [first['before'], second['before']]
        candidate_values = [first['candidate'], second['candidate']]
        before_average = sum(before_values) / 2
        candidate_average = sum(candidate_values) / 2
        paired_percentages = [value for value in (first['reductionPercent'], second['reductionPercent']) if value is not None]
        averages.append({key:first[key] for key in ('stratum','timing','metric')} | {
            'beforeRunStatisticAverage': before_average,
            'candidateRunStatisticAverage': candidate_average,
            'beforeRunStatisticRange': {'min':min(before_values),'max':max(before_values)},
            'candidateRunStatisticRange': {'min':min(candidate_values),'max':max(candidate_values)},
            'candidateAverageMinusBeforeAverage': candidate_average - before_average,
            'reductionPercentFromRunStatisticAverages': reduction(before_average,candidate_average),
            'pairedReductionPercentAverage': sum(paired_percentages)/len(paired_percentages) if paired_percentages else None,
            'pairedReductionPercentRange': {'min':min(paired_percentages),'max':max(paired_percentages)} if paired_percentages else None})
    selected_rows = [{'tick':tick,'original':{key:original_ticks[tick][key] for key in ('wholeMs','simMs','aiMs','units','buildings')},
        'runs':{run['public']['label']:tick_view(run,tick) for run in runs}} for tick in ORIGINAL_SPIKE_TICKS]
    new_outlier_ticks = sorted({tick['tick'] for run in runs for tick in run['ticks'] if tick['wholeMs']>50} - set(ORIGINAL_SPIKE_TICKS))
    new_rows = [{'tick':tick,'original':{key:original_ticks[tick][key] for key in ('wholeMs','simMs','aiMs','units','buildings')},
        'runs':{run['public']['label']:tick_view(run,tick) for run in runs}} for tick in new_outlier_ticks]
    output = {'schema':1,'order':list(LABELS),'originalDirectory':str(args.original_dir),
        'method': {
            'distributions':'Recomputed from every native tick, without removing cold startup, GC-related, or scheduling outliers; nearest-rank quantiles exactly match the probe.',
            'strata':'all: 14400 ticks; planning: native ownerPlans nonempty; nonPlanning: native ownerPlans empty. Whole/sim/AI distributions remain separate.',
            'pairedContrasts':'A1 versus B1, A2 versus B2. Positive reductionPercent means a smaller candidate statistic. No significance test or confidence interval.',
            'runStatisticAverages':'Arithmetic mean of two independent run statistics per A/B group. Averaged p95/p99/max are averages of per-run values, never pooled-distribution quantiles or maxima.',
            'effectAttribution':'A combined candidate comparison establishes neither an isolated optimization effect nor a universal performance guarantee.',
            'sourceIdentity':'Source inputs compare relative src paths, bytes, and SHA256; git identity, status, probe identity, and emitted bundle identities are also retained. Bundles can differ because frozen source directories differ.',
            'memory':'RSS and heapUsed are sampled process memory, not allocation counts. sampledMaximumBytes is only the maximum of recorded samples. Post-run GC was not standardized; no conclusion of memory reduction is made.',
            'timingBoundary':'wholeMs excludes separately timed currentSnapshot, command serialization/hash observer and disk output. simMs and aiMs measure actual stepGame and native AI boundaries; frameMs overlaps them.',
            'gcAttribution':'Performance comparison keeps diagnostics off. These runs contain no per-tick GC attribution; no causal GC label is inferred from timing alone.'},
        'globalChecks':global_checks, 'validControlledComparison':all(global_checks.values()),
        'runs':[run['public'] for run in runs],
        'productionInputDifferencesBeforeCandidate':compare_inputs(production[0],production[1]),
        'pairedContrasts':pairs, 'runStatisticAverageContrasts':averages,
        'original21SpikeTicks':selected_rows, 'allNewOver50TickRows':new_rows,
        'over50TickListsByRun':{run['public']['label']:[tick['tick'] for tick in run['ticks'] if tick['wholeMs']>50] for run in runs},
        'originalInputHashes':{name:digest((args.original_dir/name).read_bytes()) for name in ('summary.json','ticks.json.gz','environment.json','command-frames.jsonl.gz')}}
    args.output.write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'output':str(args.output),'validControlledComparison':output['validControlledComparison'],
        'globalChecks':global_checks,'productionInputDifferences':[row['path'] for row in output['productionInputDifferencesBeforeCandidate']],
        'original21Ticks':len(selected_rows),'newOutlierTicks':len(new_rows),
        'wholePerRun':{run['public']['label']:run['public']['distributions']['all']['wholeMs'] for run in runs}},indent=2))
    if not output['validControlledComparison']:
        raise SystemExit('Controlled comparison validation failed; output retained with explicit failed checks.')


if __name__ == '__main__':
    main()
