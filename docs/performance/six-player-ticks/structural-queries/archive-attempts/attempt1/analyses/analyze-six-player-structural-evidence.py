#!/usr/bin/env python3
"""Read immutable captures only; never execute game code or a benchmark.

All paths are explicit so a repository evidence archive can be inspected without
its original /workspace paths. The old captures and reports are never rewritten.
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
from pathlib import Path
import re

FULL_CHECKSUM = '7d94a5e8'
FULL_COMMAND_SHA = '771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


def file_facts(path):
    raw = path.read_bytes()
    payload = gzip.decompress(raw) if path.suffix == '.gz' else raw
    return {'path':str(path),'storedBytes':len(raw),'storedSha256':sha(raw),
        'payloadBytes':len(payload),'payloadSha256':sha(payload)}


def capture(directory, oracle):
    summary=load(directory/'summary.json')
    ticks=load(directory/'ticks.json.gz')
    environment=load(directory/'environment.json')
    commands=gzip.decompress((directory/'command-frames.jsonl.gz').read_bytes())
    count=summary['ticks']
    expected=b''.join(oracle.splitlines(keepends=True)[:count])
    lines=commands.splitlines()
    native_checks={'nativeBytesMatchCompleteOriginalPrefix':commands==expected,
        'nativeShaMatchesSummary':sha(commands)==summary['commandLogSha256'],
        'nativeByteLengthMatchesSummary':len(commands)==summary['commandLogBytes'],
        'nativeFrameCountMatchesSummary':len(lines)==summary['frames']==count,
        'nativeTicksInExactOrder':[json.loads(line)['tick'] for line in lines]==list(range(count)),
        'timedTicksInExactOrder':[t['tick'] for t in ticks]==list(range(count)),
        'summaryFinalTickMatchesCount':summary['finalTick']==count}
    if count==14400:
        native_checks['fullChecksumMatchesOriginal']=summary['finalChecksum']==FULL_CHECKSUM
        native_checks['fullCommandShaMatchesOriginal']=sha(commands)==FULL_COMMAND_SHA
    if not all(native_checks.values()):
        raise ValueError(f'Native command or identity check failed in {directory}: {native_checks}')
    return {'directory':directory,'summary':summary,'ticks':ticks,'environment':environment,
        'nativeProof':{'ticks':count,'finalTick':summary['finalTick'],'reportedFinalChecksum':summary['finalChecksum'],
            'nativeCommandSha256':sha(commands),'checks':native_checks,
            'checksumScope':'full 14400-tick checksum independently matches original' if count==14400
                else 'prefix terminal checksum reported at this capture end; equality across observations is checked separately, not substituted for the full-game checksum'}}


def overlap(a0,a1,b0,b1):
    return max(0,min(a1,b1)-max(a0,b0))


def gc_for(diagnostic,tick):
    c=next(row for row in diagnostic['clocks'] if row['tick']==tick)
    rows=[]
    for gc in diagnostic['gcEntries']:
        ms=overlap(c['startedMs'],c['endedMs'],gc['startTime'],gc['startTime']+gc['duration'])
        if ms:
            rows.append(dict(gc,tickIntersectionMs=ms))
    return rows


def source_inputs(environment):
    return {row['path']:row['sha256'] for row in environment['sourceInputs'] if row['path'].startswith('src/')}


def sea_components(terrain):
    """Static topology analysis, not navigation execution or a visit counter.

    With no corner cutting, every legal diagonal has a legal orthogonal
    two-step connection. Hence four-neighbor occupancy components have the
    same reachability components as the production eight-direction graph.
    """
    cols,rows=terrain['cols'],terrain['rows']
    cells=terrain['cells']
    assert len(cells)==cols*rows
    labels=[-1]*len(cells)
    sizes=[]
    for seed,char in enumerate(cells):
        if char not in '~,' or labels[seed]>=0:
            continue
        label=len(sizes)
        queue=[seed]
        labels[seed]=label
        head=0
        while head<len(queue):
            at=queue[head];head+=1
            col=at%cols
            neighbors=[]
            if col:neighbors.append(at-1)
            if col+1<cols:neighbors.append(at+1)
            if at>=cols:neighbors.append(at-cols)
            if at+cols<len(cells):neighbors.append(at+cols)
            for nxt in neighbors:
                if labels[nxt]<0 and cells[nxt] in '~,' :
                    labels[nxt]=label;queue.append(nxt)
        sizes.append(len(queue))
    return labels,sizes


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('cache-capture','b1-dir','b2-dir','shore-capture','shore-experiment','shore-boundaries','original-dir','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--observed-dir',type=Path,action='append',required=True,
        help='Supply the five observed-2088 capture directories in recording order')
    args=parser.parse_args()
    if len(args.observed_dir)!=5:
        parser.error('--observed-dir is required exactly five times')
    all_captures=[args.cache_capture,args.b1_dir,args.b2_dir,args.shore_capture,*args.observed_dir]
    for directory in all_captures:
        for name in ('summary.json','ticks.json.gz','environment.json','command-frames.jsonl.gz'):
            if not (directory/name).is_file():
                parser.error('Missing capture input: '+str(directory/name))
    if not (args.shore_experiment/'report.json').is_file():
        parser.error('Missing shore experiment report.json: '+str(args.shore_experiment))
    oracle=gzip.decompress((args.original_dir/'command-frames.jsonl.gz').read_bytes())
    if sha(oracle)!=FULL_COMMAND_SHA:
        raise ValueError('Original oracle command checksum changed')
    captures={str(path):capture(path,oracle) for path in all_captures}
    cache=captures[str(args.cache_capture)];shore=captures[str(args.shore_capture)]
    cache_diag=load(args.cache_capture/'focused-diagnostics.json.gz')
    shore_diag=load(args.shore_capture/'focused-diagnostics.json.gz')
    actual_records=[json.loads(line) for line in gzip.open(args.shore_capture/'shore-inputs.jsonl.gz','rt')]
    experiment=load(args.shore_experiment/'report.json')
    experiment_summary=load(args.shore_experiment/'summary.json')
    boundaries=load(args.shore_boundaries)
    if not boundaries['complete'] or not boundaries['countsOnly'] or boundaries['storedInputSha256']!=experiment_summary['storedInputSha256']:
        raise ValueError('Fresh shore boundary counters did not use the same closed actual inputs')
    stored_source=load(args.shore_capture/'source-inputs.json.gz')
    source_manifest={row['path']:row for row in shore['environment']['sourceInputs']}
    for path in ('src/shared/ship-navigation.ts','src/shared/terrain.ts','src/ai/policy/naval.ts'):
        raw=stored_source[path].encode()
        if sha(raw)!=source_manifest[path]['sha256'] or len(raw)!=source_manifest[path]['bytes']:
            raise ValueError('Captured source differs from pinned environment: '+path)
    if sha((args.shore_capture/'shore-inputs.jsonl.gz').read_bytes())!=experiment_summary['storedInputSha256']:
        raise ValueError('Shore replay report used different actual captured inputs')
    if sha((args.shore_experiment/'experiment-source.ts').read_bytes())!=experiment_summary['toolSha256']:
        raise ValueError('Shore experiment source identity differs from summary')
    terrain=actual_records[0]['snapshot']['map']['terrain']
    game_map=actual_records[0]['snapshot']['map']
    directions=int(re.search(r'const DIRECTIONS\s*=\s*(\d+)\s*;',stored_source['src/shared/ship-navigation.ts']).group(1))
    columns=math.ceil(game_map['width']/terrain['cell']);rows=math.ceil(game_map['height']/terrain['cell'])
    labels,component_sizes=sea_components(terrain)
    cache_terrain=load(args.cache_capture/'initial-snapshot.json.gz')['map']['terrain']
    if any(cache_terrain[key]!=terrain[key] for key in ('cell','cols','rows','cells')):
        raise ValueError('Topology used for cold target cardinality differs from cached diagnostic')
    padded_width=terrain['cols']+2
    shore_lookup_rows=[]
    for tick,owner,own_key in ((6990,'player-6',14985),(12705,'enemy',73991)):
        row=next(x for x in cache_diag['scopedTicks'] if x['tick']==tick)
        entries=[x for x in row['terrainCache'] if x.get('queryContext')=='shoreSpot' and x.get('owner')==owner]
        exact=[x for x in entries if x['event']=='exactField']
        hits=[x for x in entries if x['event']=='cachedHit']
        misses=[x for x in row['terrainEvents'] if x.get('queryContext')=='shoreSpot' and x.get('owner')==owner]
        exact_count=sum(x['calls'] for x in exact);hit_count=sum(x['calls'] for x in hits)
        own=next(x for x in exact if x['key']==own_key)
        enemies=[x for x in exact if x['key']!=own_key]
        if exact_count!=hit_count or misses:
            raise ValueError('Shore field lookups were not all hits')
        enemy_each={x['calls'] for x in enemies}
        if len(enemies)!=5 or len(enemy_each)!=1 or own['calls']!=7946:
            raise ValueError('Observed shore hall lookup distribution changed')
        applicable_sites=enemy_each.pop();saved=(len(enemies)-1)*applicable_sites
        actual=next(x for x in actual_records if x['tick']==tick and x['owner']==owner)
        old_warm=next(x for x in experiment['diagnostics'] if x['tick']==tick and x['variant']=='A' and x['state']=='old-fields-warm-multi-cold')
        boundary=next(x for x in boundaries['diagnostics'] if x['tick']==tick and x['variant']=='A' and x['state']=='old-fields-warm-multi-cold')
        if boundary['counts']['walking']!=old_warm['counts']['walking'] or boundary['counts']['exactField']!=exact_count or boundary['counts']['walkingBlocked']!=2484 or boundary['facts']['invalidLandCenters']!=2484 or boundary['facts']['landWalkableCenters']!=7946:
            raise ValueError('Fresh shore query-boundary counters differ from the observed field lookup totals')
        actual_scopes=next(x for x in shore_diag['scopedTicks'] if x['tick']==tick)['scopes']
        coarse_shore=next(x for x in actual_scopes if x['name']=='shoreSpot' and x.get('owner')==owner)
        coarse_script=next(x for x in actual_scopes if x['name']=='script.run' and x.get('owner')==owner and x.get('scriptId')=='v6Economy')
        own_hall=old_warm['facts']['ours'][0]
        hall_key=(math.floor(own_hall['y']/terrain['cell'])+1)*padded_width+math.floor(own_hall['x']/terrain['cell'])+1
        if hall_key!=own_key:
            raise ValueError('Observed own-hall padded index does not match actual replay facts')
        shore_lookup_rows.append({'tick':tick,'owner':owner,'ownHall':own_hall,'ownHallPaddedKey':own_key,
            'ownExactFieldLookups':own['calls'],'enemyExactFieldLookupsByKey':[{key:x[key] for key in ('key','calls','runtimeId','mover','owner','scriptId','queryContext')} for x in enemies],
            'totalExactFieldLookups':exact_count,'totalCachedHits':hit_count,'shoreMissGrowEvictEvents':misses,
            'theoreticalEnemyLookupReduction':saved,'theoreticalReductionPercentOfExactFieldLookups':saved/exact_count*100,
            'actualReplayShoreSpots':old_warm['facts']['shores'],'actualReplayWalkingDistanceCalls':old_warm['counts']['walking'],
            'actualReplayOldFieldGrowCalls':old_warm['counts']['grow'],
            'theoreticalReductionPercentOfTotalWalkingQueriesIfFiveBecomeOne':saved/old_warm['counts']['walking']*100,
            'walkingEntriesMinusObservedExactFieldLookups':old_warm['counts']['walking']-exact_count,
            'freshBoundaryCounts':boundary['counts'],
            'freshBoundaryFacts':{key:boundary['facts'][key] for key in ('shores','landWalkableCenters','invalidLandCenters')},
            'earlyReturnInterpretation':'Fresh separate boundary counters verify 2484 blocked walking calls and 2484 invalid land centres before exactField, with exactField totals matching the old observation. Walking entry counts, shore spots and exactField/cache lookups remain distinct; no terrain-identity explanation is inferred.',
            'actualCoarseShoreSpotScope':coarse_shore,'actualCoarseV6EconomyScope':coarse_script,
            'chooseNavalMineTimingScopes':[x for x in actual_scopes if x['name']=='chooseNavalMine'],
            'actualSnapshotTick':actual['snapshot']['tick'],'actualInputSequence':actual['sequence']})
    cold_row=next(x for x in cache_diag['scopedTicks'] if x['tick']==6990)
    query_rows=[x for x in cold_row['terrainCache'] if x.get('owner')=='player-6' and x.get('queryContext','').startswith('chooseNavalMine/')]
    cold_keys=sorted({x['key'] for x in query_rows if x['event']=='cachedMiss' and x['queryContext']=='chooseNavalMine/nearestByRoute'})
    cold_tuples=[]
    for key in cold_keys:
        selected=[x for x in query_rows if x['key']==key]
        col=key%padded_width-1;row=key//padded_width-1
        if not (0<=col<terrain['cols'] and 0<=row<terrain['rows']):
            raise ValueError('Cold target is not a valid padded terrain index')
        component=labels[row*terrain['cols']+col]
        if component<0:
            raise ValueError('Cold target does not stand on sea terrain')
        cold_tuples.append({'tick':6990,'owner':'player-6','scriptId':'v6Economy','mover':'sea',
            'runtimeIds':sorted({x['runtimeId'] for x in selected}),'paddedTargetKey':key,
            'targetCell':{'col':col,'row':row},'staticReachableSeaCells':component_sizes[component],
            'eventsByQueryContext':{context:{event:sum(x['calls'] for x in selected if x['queryContext']==context and x['event']==event)
                for event in ('exactField','cachedHit','cachedMiss','grow','cachedStored','cachedEvict')}
                for context in sorted({x['queryContext'] for x in selected})}})
    cold_source_scopes=[s for s in cold_row['scopes'] if s.get('owner')=='player-6' and s['name']=='script.run' and s.get('scriptId')=='v6Economy']
    observed_rows=[]
    all_negative=[]
    for number,directory in enumerate(args.observed_dir,1):
        observed=captures[str(directory)];diag=load(directory/'focused-diagnostics.json.gz')
        scoped={row['tick']:row for row in diag['scopedTicks']}
        neighborhood=[]
        for usage in diag['runtimeUsage']:
            tick=usage['tick'];b=usage['before'];a=usage['after']
            recomputed_wall=((a['before']['performanceMs']+a['after']['performanceMs'])-(b['before']['performanceMs']+b['after']['performanceMs']))/2
            recomputed_cpu=sum(a['threadCpuUs'].values())/1000-sum(b['threadCpuUs'].values())/1000
            if not math.isclose(recomputed_wall,usage['intervalWallMs'],abs_tol=1e-9) or not math.isclose(recomputed_cpu,usage['mainThreadCpuMs'],abs_tol=1e-9):
                raise ValueError('Archived runtime usage delta does not reproduce')
            nominal_negative=usage['wallMinusMainThreadCpuMs']<0
            if nominal_negative:all_negative.append({'observation':number,'tick':tick,'rawWallMinusMainThreadCpuMs':usage['wallMinusMainThreadCpuMs']})
            sample=observed['ticks'][tick]
            gc=gc_for(diag,tick)
            neighborhood.append({'tick':tick,'wholeMs':sample['wholeMs'],'simMs':sample['simMs'],'aiMs':sample['aiMs'],
                'usage':usage,'rawCpuExceedsBracketMidpointWall':nominal_negative,
                'gcEntriesIntersectingWhole':gc,'gcIntersectionMs':sum(x['tickIntersectionMs'] for x in gc),
                'scopes':scoped[tick]['scopes']})
        target=next(x for x in neighborhood if x['tick']==2088)
        routes=[s for s in target['scopes'] if s['name']=='planShipRouteImpl']
        observed_rows.append({'observation':number,'directory':str(directory),'gitHead':observed['environment']['gitHead'],
            'nativeProof':observed['nativeProof'],'runtimeUsageCapabilities':diag['runtimeUsageCapabilities'],
            'tick2088':target,'tick2088RouteScopes':routes,
            'tick2088RouteInclusiveMs':sum(s['inclusiveMs'] for s in routes),
            'tick2088RouteInclusiveFractionOfWhole':sum(s['inclusiveMs'] for s in routes)/target['wholeMs'],
            'neighbors2086Through2090':neighborhood})
    b_rows=[]
    for label,path in (('B1',args.b1_dir),('B2',args.b2_dir)):
        c=captures[str(path)];ticks=c['ticks'];count=len(ticks)
        means={key:sum(t[key] for t in ticks)/count for key in ('wholeMs','simMs','aiMs')}
        ai_fraction=means['aiMs']/means['wholeMs']
        maximum=max(ticks,key=lambda t:t['wholeMs'])
        b_rows.append({'label':label,'meansMs':means,'simFractionOfWholeMean':means['simMs']/means['wholeMs'],
            'aiFractionOfWholeMean':ai_fraction,'otherBoundaryFractionOfWholeMean':1-(means['simMs']+means['aiMs'])/means['wholeMs'],
            'hypotheticalAiZeroCostResidualWholeMeanMs':means['wholeMs']-means['aiMs'],
            'hypotheticalAiZeroCostMaximumReductionPercent':ai_fraction*100,
            'hypotheticalAiZeroCostSpeedupFactor':1/(1-ai_fraction),
            'maximumWholeTick':{key:maximum[key] for key in ('tick','wholeMs','simMs','aiMs','ownerPlans')},'nativeProof':c['nativeProof']})
    average={key:sum(row['meansMs'][key] for row in b_rows)/len(b_rows) for key in ('wholeMs','simMs','aiMs')}
    avg_fraction=average['aiMs']/average['wholeMs']
    identity_checks={'allFiveObserved2110Ticks':all(x['nativeProof']['ticks']==2110 for x in observed_rows),
        'observedPrefixTerminalChecksumsAgree':len({x['nativeProof']['reportedFinalChecksum'] for x in observed_rows})==1,
        'allFiveObservedProductionInputsMatchShoreSource':all(source_inputs(captures[str(path)]['environment'])==source_inputs(shore['environment']) for path in args.observed_dir),
        'oldCacheProductionInputsMatchShoreSource':source_inputs(cache['environment'])==source_inputs(shore['environment']),
        'shoreActualFullGolden':all(shore['nativeProof']['checks'].values()),
        'shoreActualInputRecordsAreTwo':len(actual_records)==shore_diag['shoreInputRecords']==2,
        'allRuntimeUsageObservationsAre2086To2090':all([n['tick'] for n in row['neighbors2086Through2090']]==list(range(2086,2091)) for row in observed_rows),
        'coldSeaTargetFieldsExactly12':len(cold_tuples)==12}
    used_files=[]
    for directory in all_captures:
        for name in ('summary.json','ticks.json.gz','environment.json','command-frames.jsonl.gz'):
            used_files.append(directory/name)
    used_files.extend([args.original_dir/'command-frames.jsonl.gz',args.cache_capture/'focused-diagnostics.json.gz',args.cache_capture/'initial-snapshot.json.gz',
        args.shore_capture/'focused-diagnostics.json.gz',args.shore_capture/'shore-inputs.jsonl.gz',args.shore_capture/'source-inputs.json.gz',
        args.shore_experiment/'report.json',args.shore_experiment/'summary.json',args.shore_experiment/'experiment-source.ts',args.shore_boundaries])
    used_files.extend(path/'focused-diagnostics.json.gz' for path in args.observed_dir)
    result={'schema':1,'script':file_facts(Path(__file__)),'inputFiles':[file_facts(path) for path in dict.fromkeys(used_files)],
        'identityChecks':identity_checks,'shoreWarmLookupEvidence':shore_lookup_rows,
        'remainingColdNavalMineTargets':{'tick':6990,'owner':'player-6','scope':'v6Economy','tuples':cold_tuples,
            'countsByContext':{context:{event:sum(x['calls'] for x in query_rows if x['queryContext']==context and x['event']==event)
                for event in ('exactField','cachedHit','cachedMiss','grow','cachedStored','cachedEvict')}
                for context in sorted({x['queryContext'] for x in query_rows})},
            'sumStaticReachableSeaCellsAcrossColdFields':sum(x['staticReachableSeaCells'] for x in cold_tuples),
            'staticReachabilityMeaning':'Static terrain topology cardinality per cold field, not measured pops, relaxations, or per-tick state visits. Four-neighbor occupancy components are equivalent to no-corner-cut eight-neighbor reachability.',
            'oldDiagnosticEnclosingScopes':cold_source_scopes,
            'actualCaptureHasStandaloneChooseNavalMineTime':any(s['name']=='chooseNavalMine' for row in shore_diag['scopedTicks'] for s in row['scopes']),
            'scopeColumns':['name','owner','scriptId','shipId','calls','inclusiveMs','exclusiveMs','maxMs']},
        'headlessAmdahlEvidence':{'perRun':b_rows,'arithmeticMeanOfTwoRunMeansMs':average,
            'simFractionFromRunMeans':average['simMs']/average['wholeMs'],'aiFractionFromRunMeans':avg_fraction,
            'hypotheticalAiZeroCostResidualWholeMeanMs':average['wholeMs']-average['aiMs'],
            'hypotheticalAiZeroCostMaximumReductionPercent':avg_fraction*100,'hypotheticalAiZeroCostSpeedupFactor':1/(1-avg_fraction),
            'assumptions':'Hypothetical zero cost of the entire measured native AI boundary, with identical commands/world and every non-AI cost fixed. Serial headless adapter whole-time mean only; browser rendering, currentSnapshot, observer/disk work, FPS and tail latency are outside this bound.'},
        'configuredShipLattice':{'width':game_map['width'],'height':game_map['height'],'terrainCell':terrain['cell'],
            'terrainCols':terrain['cols'],'terrainRows':terrain['rows'],'configuredLatticeCols':columns,'configuredLatticeRows':rows,'headings':directions,
            'potentialLatticeStateSlotsPerMatchingGrid':columns*rows*directions,
            'meaning':'Configured position-by-heading slot capacity. Source creates derived arrays on a cold/changed matching grid and lazily checks geometry/searches; this is not proof every tick traverses every state.'},
        'observed2088':{'runs':observed_rows,'allRawNegativeCpuWallDifferences':all_negative,
            'negativeDifferencePolicy':'Retain raw negative wall-minus-main-thread-CPU differences. They cannot be converted into waiting time or explain old outliers. Bracket-midpoint wall and nominal CPU observations are not perfectly interchangeable.',
            'resourceAndGcPolicy':'Process CPU can exceed wall through parallel workers; context switches and page faults are process-wide. GC interval intersections show association, not exclusive phase CPU or pause causality.',
            'oldB2Tick2088':{key:captures[str(args.b2_dir)]['ticks'][2088][key] for key in ('tick','wholeMs','simMs','aiMs','ownerPlans')},
            'oldB2CauseResolved':False},
        'supportedConclusions':[
            'The two selected shore contexts hit already-existing exact fields; combining only five enemy-hall fields removes a small fraction of the observed field lookups.',
            'Cold sea targets inside chooseNavalMine remain a specific next attribution/algorithm candidate, distinct from shore warm queries; the current report neither measures its own total time nor proves a replacement benefit.',
            'Five new observations show ordinary 2088 simulation work dominated by one enemy2 transport route-planning scope; the old 99.188 ms outlier was not reproduced.',
            'The full actual shore-input capture preserves complete native command bytes and the original final checksum.'],
        'unsupportedConclusions':[
            '7946 is not the shore-spot count or all walkingDistance entry calls; it is the own-hall exactField/cache lookup count.',
            'A large enemy multi-source field optimization benefit is not established by a small percentage of warm lookup removals.',
            'The old B2 99.188 ms tick is not proven to be caused by AI, GC, waiting, or any single ship route function.',
            'Negative CPU-versus-wall differences are not zero or positive waiting time and must not be discarded.',
            '819200 configured ship lattice slots do not imply full-world or full-lattice traversal every tick.',
            'Headless cost shares and an Amdahl thought experiment do not measure browser rendering, FPS, or standard-engine superiority.']}
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'output':str(args.output),'outputSha256':sha(args.output.read_bytes()),'scriptSha256':result['script']['storedSha256'],
        'identityChecks':identity_checks,'shoreLookupReductions':[{key:r[key] for key in ('tick','totalExactFieldLookups','theoreticalEnemyLookupReduction','theoreticalReductionPercentOfExactFieldLookups','actualReplayShoreSpots','actualReplayWalkingDistanceCalls')} for r in shore_lookup_rows],
        'coldTargets':len(cold_tuples),'coldFieldsStaticReachableCellProduct':result['remainingColdNavalMineTargets']['sumStaticReachableSeaCellsAcrossColdFields'],
        'observed2088WholeMs':[r['tick2088']['wholeMs'] for r in observed_rows],
        'negativeCpuWallDifferences':len(all_negative),'headlessAmdahlRunMeanReductionPercent':avg_fraction*100},indent=2))
    if not all(identity_checks.values()):
        raise SystemExit('Capture identity validation failed; output preserved with explicit failed checks.')


if __name__=='__main__':
    main()
