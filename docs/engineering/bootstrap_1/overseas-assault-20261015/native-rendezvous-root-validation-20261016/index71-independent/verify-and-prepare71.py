"""Stream only e47 sealed evidence; external index71 + ade source metadata.

No repository writes, archive copying/extraction, native/planner or test runs.
Old70 package raw text/values and both ordinary0 records remain exact.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import gzip
import hashlib
import json
import re
import subprocess
import tarfile

OUT = Path(__file__).resolve().parent
REPO = Path('/workspace/sketch-rts-bootstrap-resume')
ROOT_INDEX = 'docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
OLD_SHA = '9f6ea837f41ae2cbcddc25d63f686942d9752c15b47fd1443eda27f577db7c16'
HISTORICAL = 'e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
CURRENT = 'ade412414d9232206f39e20f0182f0086605433c'
E47 = 'e47fd04573c8af5363571ea8409843c060ae60fb'
MACRO = '07802649972cee4ccde66ec735d733917d931967'
ARCHIVE = Path('/workspace/.playtest/general-coastal-fleet-078026-20261016-evidence.tar.gz')
EXPECTED_BYTES = 12557763
EXPECTED_SHA = '3619606b2c6493d51aaa66e554fe33d4dd3e445a6d643498d9de6f79247cd046'
EXPECTED_INDEX_SHA = 'db6db01889e4b05c7bd652da91662997e75f3f01141e5982bfcf230ea5719b78'
MANIFEST = 'INDEX.json'
SEGMENTS = ['native-223200-224400', 'native-224400-aftercontact']
KEEP = {MANIFEST, 'README.native-rendezvous.zh.md', 'native-task-outcome.json',
        'receiver-whole-body-support.json', 'aftercontact-observer-stop-errata.json',
        'actual-hull-health-223200-224400.json', 'fixed-validation.json',
        'source-capsule-verification.json', 'closure-contact-224370-224400/proof.json',
        'closure-crossing-224430-224460/proof.json'}
for prefix in SEGMENTS:
    KEEP.update(prefix + '/' + name for name in ['report.json', 'commands.jsonl', 'hits.jsonl', 'events.jsonl'])
ROOT_EVIDENCE = Path('/workspace/.playtest/root-native-rendezvous-integration-20261016')
ROOT_RECORDS = ['root-actual-window-result.json', 'root-validation.json',
                'root-vs-e47-recorded-comparison.json', 'closure-224370-224460/proof.json']
NATIVE_FILES = ['src/shared/crew-rendezvous.ts', 'src/shared/sailing.ts', 'src/shared/ship-navigation.ts']
RUNTIME_DELTA = NATIVE_FILES + ['src/shared/crew-rendezvous-reachable.test.ts',
                             'src/shared/fixtures/crew-rendezvous-original-223200.json.gz']

def sha(data):
    return hashlib.sha256(data).hexdigest()

def dump(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def read_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs)

def canonical(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe archive name: ' + name)
    return str(path)

def value_span(text, key):
    match = re.search(r'^  "' + re.escape(key) + r'":\s*', text, flags=re.M)
    if not match:
        raise ValueError('Missing metadata key: ' + key)
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    return match.end(), match.end() + length

def replace_value(text, key, value):
    a, b = value_span(text, key)
    rendered = json.dumps(value, ensure_ascii=False, indent=2).replace('\n', '\n  ')
    return text[:a] + rendered + text[b:]

def array_span(text):
    start = re.search(r'"packages"\s*:\s*\[', text).end() - 1
    _, length = json.JSONDecoder().raw_decode(text[start:])
    return start, start + length - 1

def closure_exact(record, start, end, commands, events, thinks):
    assert record['start'] == start and record['end'] == end
    assert record['counts'] == {'commands': commands, 'hits': 0, 'events': events}
    proof = record['proof']
    assert all(proof['restore'].values()) and all(proof['final'].values())
    assert proof['commands'] and proof['hits'] and proof['eventsWithOriginalCommandIndices']
    assert len(proof['thinks']) == thinks
    assert all(row[key] for row in proof['thinks'] for key in ['snapshot', 'nextId', 'all3mem'])

observed_head_before = git('rev-parse', 'HEAD').decode().strip()
assert observed_head_before == CURRENT
root_index_before_sha = sha((REPO / ROOT_INDEX).read_bytes())
original = OUT / 'canonical-index-70.original.json'
if original.exists():
    old_bytes = original.read_bytes()
else:
    old_bytes = (REPO / ROOT_INDEX).read_bytes()
    assert sha(old_bytes) == OLD_SHA
    original.write_bytes(old_bytes)
assert sha(old_bytes) == OLD_SHA
old = read_json(old_bytes)
assert len(old['packages']) == 70 and old['productionHead'] == HISTORICAL
assert old['productionOrdinary0']['source'].startswith('0f5bf01a')
assert old['currentCombinedOrdinary0']['source'] == HISTORICAL
assert old['currentCombinedOrdinary0']['winTick'] == 43714 and old['currentCombinedOrdinary0']['ownPermanentLosses'] == 56
changed_runtime = git('diff', '--name-only', HISTORICAL, CURRENT, '--', 'src', 'scripts',
                      'docs/engineering/bootstrap_1/frozen-policy.json').decode().splitlines()
assert set(changed_runtime) == set(RUNTIME_DELTA)
native_byte_equivalence = {name: git('show', CURRENT + ':' + name) == git('show', E47 + ':' + name)
                           for name in NATIVE_FILES}
assert all(native_byte_equivalence.values())
assert git('show', CURRENT + ':docs/engineering/bootstrap_1/frozen-policy.json') == git('show', HISTORICAL + ':docs/engineering/bootstrap_1/frozen-policy.json')

compressed_hash, compressed_bytes = hashlib.sha256(), 0
with ARCHIVE.open('rb') as inp:
    while chunk := inp.read(1024 * 1024):
        compressed_hash.update(chunk)
        compressed_bytes += len(chunk)
assert compressed_bytes == EXPECTED_BYTES and compressed_hash.hexdigest() == EXPECTED_SHA
regular, kept, seen = {}, {}, set()
with ARCHIVE.open('rb') as raw, gzip.GzipFile(fileobj=raw) as gz:
    with tarfile.open(fileobj=gz, mode='r|') as tar:
        for member in tar:
            name = canonical(member.name)
            if name in seen:
                raise ValueError('Duplicate normalized archive member: ' + name)
            seen.add(name)
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError('Unexpected nonregular member: ' + name)
            digest, size = hashlib.sha256(), 0
            capture = bytearray() if name in KEEP else None
            inp = tar.extractfile(member)
            while chunk := inp.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                if capture is not None:
                    capture.extend(chunk)
            assert size == member.size
            regular[name] = {'bytes': size, 'sha256': digest.hexdigest()}
            if capture is not None:
                kept[name] = bytes(capture)
    while gz.read(1024 * 1024):
        pass
assert set(kept) == KEEP
manifest = read_json(kept[MANIFEST])
assert manifest['head'] == E47 and sha(kept[MANIFEST]) == EXPECTED_INDEX_SHA
paths = set()
for row in manifest['payloads']:
    name = canonical(row['path'])
    assert name not in paths
    paths.add(name)
    assert regular.get(name) == {'bytes': row['bytes'], 'sha256': row['sha256']}
assert len(paths) == 277 and len(regular) == 278 and set(regular) == paths | {MANIFEST}

def record(name):
    return read_json(kept[name])

def jsonl(name):
    assert not kept[name] or kept[name].endswith(b'\n')
    return [read_json(line) for line in kept[name].splitlines()]

outcome = record('native-task-outcome.json')
body = record('receiver-whole-body-support.json')
stop_errata = record('aftercontact-observer-stop-errata.json')
health = record('actual-hull-health-223200-224400.json')
author_validation = record('fixed-validation.json')
assert outcome['head'] == author_validation['head'] == E47 and author_validation['base'] == MACRO
assert set(author_validation['productionFiles']) == set(NATIVE_FILES)
assert author_validation['tests']['testsPassed'] == 33 and author_validation['tests']['exitCode'] == author_validation['tsc']['exitCode'] == 0
assert outcome['hitsAcrossTwoSegments'] == outcome['permanentDeathsAcrossTwoSegments'] == 0
assert outcome['economy']['goldBefore'] == 383.33 and outcome['economy']['goldAfter'] == 377.33
assert outcome['economy']['goldDelta'] == -6 and outcome['economy']['incomeClaim'] is False
assert outcome['economy']['goldSpentAfter']['p0'] - outcome['economy']['goldSpentBefore']['p0'] == 6
segment_records, raw_row_counts = {}, {}
for prefix, expected_counts in zip(SEGMENTS, [(1108, 0, 115, 80), (1322, 0, 116, 80)]):
    report = record(prefix + '/report.json')
    assert report['head'] == E47 and report['winner'] is None and report['naturalComplete'] is False
    assert all(report['restored'].values())
    for key in ['sourcePre', 'sourcePost']:
        assert report[key] == {'files': 1470, 'changed': [], 'head': E47, 'status': ''}
    assert report['frozenPre'] == report['frozenPost']
    assert report['frozenPre']['files'] == 184 and report['frozenPre']['rulesVersion'] == 2
    assert tuple(report['counts'][key] for key in ['commands', 'hits', 'events', 'thinks']) == expected_counts
    for name, expected in zip(['commands', 'hits', 'events'], expected_counts[:3]):
        rows = jsonl(prefix + '/' + name + '.jsonl')
        assert len(rows) == expected
        raw_row_counts[prefix + '/' + name + '.jsonl'] = len(rows)
    segment_records[prefix] = report
commands = jsonl(SEGMENTS[1] + '/commands.jsonl')
events = jsonl(SEGMENTS[1] + '/events.jsonl')
public_cancel = commands[47]
assert public_cancel['tick'] == 224445 and public_cancel['scriptId'] == 'naval'
assert public_cancel['command']['type'] == 'move' and public_cancel['command']['unitIds'] == ['unit-p0-bombardShip-50739']
parent_events = [event for event in events if event['tick'] == 224435 and event['type'] == 'observed-parent-change']
assert len(parent_events) == 1
assert parent_events[0]['before']['deck']['shipId'] == 'unit-p0-bombardShip-50739'
assert parent_events[0]['after']['deck']['shipId'] == 'unit-p0-warship-31227'
assert parent_events[0]['after']['order']['type'] == 'board'
assert stop_errata['actualEnd'] == 225600 and stop_errata['noSourceHotEdit']
assert stop_errata['firstObservedConditionInClosedTrace'] == {'tick': 224445, 'stage': 'after-command', 'rawContinuationCommandIndex': 47}
body_summaries = []
for row in body['rows']:
    assert row['unchangedFullInput'] and row['bodyOrderOriginalArray']
    assert row['currentDeckPointFitsOccupied'] and row['currentDiskInDeck'] and row['currentDiskInHull']
    assert row['wholeBodySupportingHulls'] == ['unit-p0-warship-31227'] and row['gangway'] is None and row['cabin'] is None
    body_summaries.append({key: row[key] for key in ['tick', 'currentDeckPointFitsOccupied',
        'currentDiskInDeck', 'currentDiskInHull', 'wholeBodySupportingHulls', 'distanceToSavedDeckPoint']})
assert [row['tick'] for row in body_summaries] == [224445, 224460, 225600]
assert body_summaries[0]['distanceToSavedDeckPoint'] == 0.16726988942207582
closure_exact(record('closure-contact-224370-224400/proof.json'), 224370, 224400, 27, 0, 2)
closure_exact(record('closure-crossing-224430-224460/proof.json'), 224430, 224460, 33, 4, 2)

root_records = {name: read_json((ROOT_EVIDENCE / name).read_bytes()) for name in ROOT_RECORDS}
root_hashes = {name: {'path': str(ROOT_EVIDENCE / name), 'bytes': (ROOT_EVIDENCE / name).stat().st_size,
    'sha256': sha((ROOT_EVIDENCE / name).read_bytes())} for name in ROOT_RECORDS}
actual = root_records['root-actual-window-result.json']
root_validation = root_records['root-validation.json']
comparison = root_records['root-vs-e47-recorded-comparison.json']
root_closure = root_records['closure-224370-224460/proof.json']
assert actual['head'] == CURRENT and actual['start'] == 223200 and actual['end'] == 225600
assert actual['winner'] is None and actual['naturalComplete'] is False
assert actual['counts'] == {'commands': 2430, 'hits': 0, 'events': 231, 'thinks': 160}
assert all(actual['restored'].values()) and all(actual['firstPlanSameOldE566'].values())
for key in ['sourcePre', 'sourcePost']:
    assert actual[key] == {'files': 1464, 'changed': [], 'head': CURRENT, 'status': ''}
assert actual['frozenPre'] == actual['frozenPost'] and actual['frozenPre']['files'] == 184 and actual['frozenPre']['rulesVersion'] == 2
assert root_validation['tests']['passed'] == 52 and root_validation['tests']['files'] == 8
assert root_validation['tests']['exitCode'] == root_validation['tsc']['exitCode'] == 0
assert root_validation['candidateRuntimeThreeFilesEqualE47'] and root_validation['AIAndFrozenE566GitBytesUnchanged']
assert comparison['rootSource'] == CURRENT and comparison['referenceSource'] == E47
assert comparison['savedCheckpointCount'] == comparison['referenceAvailable'] == 160
assert len(comparison['checkpoints']) == 160 and comparison['allWorldId3memAtAvailableCheckpoints']
assert all(row[key] for row in comparison['checkpoints'] for key in ['available', 'world', 'nextId', 'all3mem'])
assert comparison['finalWorld'] and comparison['finalNextId'] and comparison['finalAll3Memories']
assert comparison['publicCommands'] == {'root': 2430, 'reference': 2430, 'allExact': True}
assert comparison['rootHits'] == comparison['referenceHits'] == 0
closure_exact(root_closure, 224370, 224460, 91, 7, 6)
root_raw_counts = {}
for name, expected in [('commands', 2430), ('hits', 0), ('events', 231)]:
    data = (ROOT_EVIDENCE / 'native-223200-225600' / (name + '.jsonl')).read_bytes()
    rows = [read_json(line) for line in data.splitlines()]
    assert len(rows) == expected
    root_raw_counts[name] = len(rows)

entry = {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
    'indexedPayloadFiles': 277, 'archiveRegularFiles': 278, 'payloadManifest': MANIFEST,
    'payloadHashesVerified': True,
    'source': E47 + ' independent native3file rendezvous fix over unmerged078026 macro context; its native files separately integrated into ade over exacte566 AI',
    'classification': 'Two focused full3AI changed-code windows223200..224400..225600, not ordinary0/natural win. Paid160cutter actually born223546; touch224379/canTransfer224380;39390 receiver parent224435 stillboard, normal naval publicmove50739 at224445 cancels remainder,0.16727px short of reviseddeckPoint, not exact native goal completion. Independent radius+1 whole-body proof at224445/460/225600 supports onlyreceiver31227.2430commands/0hits/0permanent deaths, no income/attack/win; gold383.33→377.33 is6paid dock repairs, receiver1.916→19.916HP remains injured. Observer stop request failed through copied runInput; original fixed driver actually ended authorized225600, not224445.1470source/frozen184 fixed; author33tests+tsc0,2inherited coast failures/red logs retained. Native3files integrated separately asade; original078026 macro, a90c/ab0 medical and incomplete passenger34800 recovery not integrated/solved by this package.'}
assert all(row['file'] != entry['file'] for row in old['packages'])
current_validation = {
    'source': CURRENT, 'AIBaseSource': HISTORICAL, 'strategyBaseline': old['strategyBaseline'],
    'nativeRendezvousProductionFiles': NATIVE_FILES, 'runtimeFilesEqualFixedE47': native_byte_equivalence,
    'unmergedCandidatesExcluded': {'macro078026': True, 'medicalA90c': True, 'medicalAb0': True},
    'rootRegression': {'testsPassed': 52, 'testFiles': 8, 'typecheckExitCode': 0,
        'reference': 'root-native-rendezvous-integration-20261016/root-validation.json',
        'timingNote': 'Original validation written before ade native replay, so its then-pending scope text remains unchanged; root-actual-window-result.json supplies subsequent actual result. Author33/root52 are distinct runs, not summed.'},
    'native2400': {'from': 223200, 'to': 225600, 'nativeTicks': 2400, 'full3AI': True,
        'restored': actual['restored'], 'sourceFilesPrePostExact': 1464, 'frozenManifestFilesPrePostExact': 184,
        'rulesVersion': 2, 'counts': actual['counts'], 'winner': None, 'naturalComplete': False,
        'firstP0EntriesAndMemoryEqualE566': actual['firstPlanSameOldE566'],
        'reference': 'root-native-rendezvous-integration-20261016/root-actual-window-result.json',
        'comparisonToE47': {'savedCheckpoints': 160, 'savedWorldId3MemoryAllExact': True,
            'finalWorldId3MemoryAllExact': True, 'allPublicCommandsExact': 2430,
            'scope': 'Saved160prethink checkpoints, complete recorded commands and final state only; not everytick/allcases proof or full ordinary0.'},
        'actualTransfer': {'receiverParentTick': 224435, 'boardEndedByExistingPublicNavalMoveTick': 224445,
            'sourceHull': 'unit-p0-bombardShip-50739', 'receiverHull': 'unit-p0-warship-31227',
            'crew': 'unit-p0-summoner-39390', 'crewHPAfter': 95,
            'exactNativeGoalCompletionClaim': False, 'independentWholeBodyReceiverProof': True},
        'goldBefore': 383.33, 'goldAfter': actual['gold'], 'paidNativeDockRepairsGold': 6,
        'incomeOrEnemyDamageOrVictoryClaim': False},
    'coldClosure90': {'from': 224370, 'to': 224460, 'nativeTicks': 90, 'full3AI': True,
        'restored': root_closure['proof']['restore'], 'savedPrethinkFramesExact': 6,
        'finalWorldId3MemoryExact': True, 'commandsExact': 91, 'hitsExact': 0, 'eventsExact': 7,
        'reference': 'root-native-rendezvous-integration-20261016/closure-224370-224460/proof.json'},
    'ordinary0Complete': False,
    'ordinary0Status': 'No complete ordinary0 at ade source. Top-level currentCombinedOrdinary0 remains historicale56643714win/56loss, productionOrdinary0 remains historical0f44441win; neither is an ade score.',
    'rootEvidenceArchiveStatus': 'Separate ade full-source/root-native evidence package being sealed by parent; no archive SHA guessed and no claim those root records are payloads of e47 package.',
    'originalUncommittedRecoveryGapRetained': True}
validation = {'currentSource': current_validation,
    'historicalSources': {HISTORICAL: {'source': HISTORICAL,
        'validation': old['productionValidation'],
        'scope': 'Exact prior e566 validation object retained as historical source evidence; its nested currentCombinedSource/status describe that historical source, not current ade.'}},
    'scoreAttribution': 'The two existing top-level ordinary0 records retain their exact sources, text and values. No new ordinary0/full-game score is assigned to ade.',
    'testCountScope': 'Current root52/8, author33/4 and all historical test runs retain separate scopes; no synthetic combined independent test total.'}
delta_addition = ' Current runtimeade41241 separately imports only e47 native crew-rendezvous/sailing/ship-navigation departure-route and shared-solid-frame fix plus its test/fixture over exacte566 AI; no078026 macro or a90c/ab0 medical import. Root52tests/8files+tsc0 and actual223200..2256002400tick normal3AI window,160saved full-state checkpoints/final/2430publiccommands equal e47, and only224370..22446090tick coldclosure are verified.39390 crosses receiver224435, normal naval helm cancels board224445; whole-body receiver support does not imply exact native goal completion. No income/attack/win,6gold paid repairs; ade has no complete ordinary0 yet. The earlier e56643714/56loss and0f44441 results remain historical source-attributed.'
text = old_bytes.decode()
start, close = array_span(text)
insert_at = len(text[:close].rstrip())
rendered = '\n'.join('    ' + line for line in json.dumps(entry, ensure_ascii=False, indent=2).splitlines())
candidate_text = text[:insert_at] + ',\n' + rendered + '\n  ' + text[close:]
candidate_text = replace_value(candidate_text, 'productionHead', CURRENT)
candidate_text = replace_value(candidate_text, 'productionDelta', old['productionDelta'] + delta_addition)
candidate_text = replace_value(candidate_text, 'productionValidation', validation)
new = read_json(candidate_text)
assert len(new['packages']) == 71 and new['packages'][:70] == old['packages']
new_start, new_close = array_span(candidate_text)
assert candidate_text[new_start + 1:new_close].startswith(text[start + 1:close].rstrip() + ',\n')
assert set(new) == set(old)
changed = [key for key in old if key != 'packages' and new[key] != old[key]]
assert set(changed) == {'productionHead', 'productionDelta', 'productionValidation'}
for key in old:
    if key in ['packages', *changed]:
        continue
    assert new[key] == old[key]
    a, b = value_span(text, key)
    c, d = value_span(candidate_text, key)
    assert text[a:b] == candidate_text[c:d]
assert validation['historicalSources'][HISTORICAL]['validation'] == old['productionValidation']
(OUT / 'bootstrap-complete-games-20261015-index.71.candidate.json').write_text(candidate_text)
dump('new-entry-71.verified.json', entry)
dump('productionValidation.ade.candidate.json', validation)
dump('root-native-evidence-attribution.json', {'classification': 'Read-only existing root reports/raw counts and Git blob comparison; no re-execution. Root bundle is still separate/pending sealing.',
    'productionSource': CURRENT, 'referenceSource': E47, 'AIBaseSource': HISTORICAL,
    'runtimeDeltaVsE566': changed_runtime, 'nativeThreeGitBytesExactE47': native_byte_equivalence,
    'rootRecordsAsReadSHABytes': root_hashes, 'rootRawRowCountsIndependentlyRead': root_raw_counts,
    'rootActualSummary': actual, 'rootValidationAsRecorded': root_validation,
    'comparisonSummary': {k: v for k, v in comparison.items() if k != 'checkpoints'},
    'rootColdClosure90AsRecorded': root_closure,
    'e47WholeBodySupportAsRecorded': body_summaries, 'e47PublicCancelRawRow47': public_cancel,
    'e47HealthAndStopErrata': {'hullHealth': health['classification'],
        'receiverInitialHP': 1.9163862053368348, 'receiverFinalHP': 19.916386205336835,
        'fleetHealthyClaim': False, 'observerStop': stop_errata},
    'scope': 'No everytick/allcases equivalence or full ordinary0 at ade. Other candidates and original uncommitted recovery gap unchanged.'})
dump('new-archive-stream-verification.json', {
    'classification': 'Only e47 sealed package compressed/payload SHA+bytes/regular coverage, raw linecounts and selected record consistency; no native/planner/test or inner source-capsule re-audit.',
    'archive': str(ARCHIVE), 'bytes': compressed_bytes, 'sha256': compressed_hash.hexdigest(),
    'manifest': MANIFEST, 'manifestSHA256': sha(kept[MANIFEST]), 'payloadCount': 277,
    'regularMembersIncludingIndex': 278, 'allPayloadSHAAndDeclaredBytesExact': True,
    'allActualBytesMatchTarHeaders': True, 'allRegularsExactlyCovered': True,
    'duplicateAndNonregularMembersRejected': True, 'gzipCRCAndEOFVerified': True,
    'selectedRecordsAndRawCountsAgree': True, 'rawJSONLRowCounts': raw_row_counts, 'inventory': regular})
delivery = {'createdAtUtc': datetime.now(timezone.utc).isoformat(), 'baseSourceHeadObserved': observed_head_before,
    'rootHeadObservedAfter': git('rev-parse', 'HEAD').decode().strip(),
    'oldIndexSHA256': OLD_SHA, 'candidateIndexSHA256': sha(candidate_text.encode()),
    'oldPackages': 70, 'newPackages': 71, 'old70EachValueAndRawPackageTextExact': True,
    'old0fProductionOrdinary0ValueAndRawTextExact': True, 'e566CurrentCombinedOrdinary0ValueAndRawTextExact': True,
    'strategyBaselineValueAndRawTextExact': True,
    'intentionalExistingMetadataChanges': changed, 'addedMetadataKeys': [],
    'historicalE566ValidationObjectValueExact': True, 'currentAdeOrdinary0Complete': False,
    'productionHead': CURRENT, 'strategyBaseline': old['strategyBaseline'],
    'rootCanonicalIndexSHA256Before': root_index_before_sha,
    'rootCanonicalIndexSHA256After': sha((REPO / ROOT_INDEX).read_bytes()),
    'rootWritesCopiesExtractionNativeTestsStagesCommits': False,
    'onlyNewPackageStreamVerified': True, 'earlier70PackagesNotReverifiedOrRepacked': True,
    'rootEvidenceArchiveStillPendingSeparateSeal': True,
    'activeCandidate': 'bootstrap-complete-games-20261015-index.71.candidate.json',
    'archive': {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
        'payloads': 277, 'regularFilesIncludingIndex': 278},
    'scriptUsage': 'python3 ' + str(OUT / 'verify-and-prepare71.py'),
    'originalUncommittedRecoveryGapRetained': True}
delivery['files'] = {name: {'path': str(OUT / name), 'bytes': (OUT / name).stat().st_size,
    'sha256': sha((OUT / name).read_bytes())} for name in [
    'bootstrap-complete-games-20261015-index.71.candidate.json', 'canonical-index-70.original.json',
    'new-entry-71.verified.json', 'productionValidation.ade.candidate.json',
    'root-native-evidence-attribution.json', 'new-archive-stream-verification.json',
    'README-append71.candidate.zh.md', 'verify-and-prepare71.py'] if (OUT / name).is_file()}
dump('FINAL-DELIVERY71.json', delivery)
print(json.dumps({k: v for k, v in delivery.items() if k != 'files'}, ensure_ascii=False))
