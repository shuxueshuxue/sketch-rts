"""Stream-verify only sealed078026 evidence and append external index69.

Does not extract/copy archives, write the repository, run native/tests, or stage.
Existing68 entry bytes and every top-level metadata value/raw text stay exact.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
from collections import Counter
import gzip
import hashlib
import json
import re
import subprocess
import tarfile

OUT = Path(__file__).resolve().parent
REPO = Path('/workspace/sketch-rts-bootstrap-resume')
BASE = '696197ebfc4d0234eca9aafc9e633318212de424'
PRODUCTION = 'e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
CANDIDATE = '07802649972cee4ccde66ec735d733917d931967'
ROOT_INDEX = 'docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
ARCHIVE = Path('/workspace/.playtest/macro-choice-recovery-e566-20261016-evidence.tar.gz')
EXPECTED_BYTES = 19379175
EXPECTED_SHA = '67fe8db45b9872ef7566fd3c3be96cd29f793538699749db6c8d79139f584e0a'
MANIFEST = 'INDEX.json'
EXPECTED_INDEX_SHA = '99e0d737b5287205db421754148712cea9c6c7e79bee7e295e7688e04b61d825'
KEEP = {MANIFEST, 'README.evidence.zh.md', 'native-193200/report.json',
        'native-193200/observation-stop.json', 'native-193200/native-hits.jsonl',
        'final-native-reconciliation.json', 'closure-237600-238516/proof.json',
        'validation-and-source-delivery.json', 'fixed-source.json',
        'capital-and-exits-223200.json', 'actual-loading-packing-counterfactual.json',
        'fleet-readonly/geometry-bounds.json',
        'independent-contract-review/FINAL-078026-CONTRACT-REVIEW.json'}
JSONL = {'native-193200/public-commands.jsonl': 40184,
         'native-193200/native-hits.jsonl': 8,
         'native-193200/native-events.jsonl': 4777,
         'closure-237600-238516/commands.jsonl': 721,
         'closure-237600-238516/hits.jsonl': 0,
         'closure-237600-238516/events.jsonl': 114}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def dump(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def canonical(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe archive member: ' + name)
    return str(path)

def read_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs)

def value_span(text, key):
    match = re.search(r'^  "' + re.escape(key) + r'":\s*', text, flags=re.M)
    if not match:
        raise ValueError('Missing top-level key: ' + key)
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    return match.end(), match.end() + length

def array_span(text):
    start = re.search(r'"packages"\s*:\s*\[', text).end() - 1
    _, length = json.JSONDecoder().raw_decode(text[start:])
    return start, start + length - 1

old_bytes = git('show', BASE + ':' + ROOT_INDEX)
old = read_json(old_bytes)
assert len(old['packages']) == 68 and old['productionHead'] == PRODUCTION
assert old['productionOrdinary0']['source'].startswith('0f5bf01a')
assert old['currentCombinedOrdinary0']['source'] == PRODUCTION
assert old['currentCombinedOrdinary0']['winTick'] == 43714
(OUT / 'canonical-index-68.original.json').write_bytes(old_bytes)
observed_head_before = git('rev-parse', 'HEAD').decode().strip()
root_index_before_sha = sha((REPO / ROOT_INDEX).read_bytes())
compressed_hash = hashlib.sha256()
compressed_bytes = 0
with ARCHIVE.open('rb') as inp:
    while chunk := inp.read(1024 * 1024):
        compressed_hash.update(chunk)
        compressed_bytes += len(chunk)
assert compressed_bytes == EXPECTED_BYTES and compressed_hash.hexdigest() == EXPECTED_SHA

regular = {}
kept = {}
seen = set()
line_counts = {}
event_types = Counter()
terminal_owners = Counter()
permanent_terminals = 0
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
            digest = hashlib.sha256()
            size = 0
            capture = bytearray() if name in KEEP else None
            record_count = 0
            tail = b''
            inp = tar.extractfile(member)
            while chunk := inp.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                if capture is not None:
                    capture.extend(chunk)
                if name in JSONL:
                    lines = (tail + chunk).split(b'\n')
                    tail = lines.pop()
                    for line in lines:
                        if not line:
                            raise ValueError('Empty raw JSONL record: ' + name)
                        record = read_json(line)
                        record_count += 1
                        if name == 'native-193200/native-events.jsonl':
                            event_types[record['type']] += 1
                            if record['type'] == 'native-unit-terminal':
                                permanent = record['permanent']
                                permanent_terminals += int(permanent)
                                owner = record['previous']['owner']
                                terminal_owners[('permanent:' if permanent else 'temporary:') + owner] += 1
            if name in JSONL:
                if tail:
                    raise ValueError('Raw JSONL lacks final newline: ' + name)
                if record_count != JSONL[name]:
                    raise ValueError('Raw record count differs: ' + name)
                line_counts[name] = record_count
            if size != member.size:
                raise ValueError('Actual read differs from tar header: ' + name)
            regular[name] = {'bytes': size, 'sha256': digest.hexdigest()}
            if capture is not None:
                kept[name] = bytes(capture)
    while gz.read(1024 * 1024):
        pass
assert set(kept) == KEEP and set(line_counts) == set(JSONL)
manifest = read_json(kept[MANIFEST])
assert sha(kept[MANIFEST]) == EXPECTED_INDEX_SHA and manifest['head'] == CANDIDATE
payloads = manifest['payloads']
paths = set()
for name, expected in payloads.items():
    name = canonical(name)
    assert name not in paths
    paths.add(name)
    if regular.get(name) != {'bytes': expected['bytes'], 'sha256': expected['sha256']}:
        raise ValueError('Payload hash/bytes mismatch: ' + name)
assert len(payloads) == 174 and len(regular) == 175
assert set(regular) == paths | {MANIFEST}

report = read_json(kept['native-193200/report.json'])
ledger = read_json(kept['final-native-reconciliation.json'])
closure = read_json(kept['closure-237600-238516/proof.json'])
validation = read_json(kept['validation-and-source-delivery.json'])
fixed = read_json(kept['fixed-source.json'])
capital = read_json(kept['capital-and-exits-223200.json'])
packing = read_json(kept['actual-loading-packing-counterfactual.json'])
geometry = read_json(kept['fleet-readonly/geometry-bounds.json'])
contract = read_json(kept['independent-contract-review/FINAL-078026-CONTRACT-REVIEW.json'])
stop = read_json(kept['native-193200/observation-stop.json'])
hits = [read_json(line) for line in kept['native-193200/native-hits.jsonl'].splitlines()]
assert report['head'] == fixed['head'] == contract['source']['head'] == CANDIDATE
assert fixed['base'] == contract['source']['base'] == PRODUCTION
assert len(fixed['hashes']) == 1468 and fixed['status'] == ''
assert all(report['restoreComparison'].values())
for key in ['sourcePre', 'sourcePost']:
    assert report[key]['files'] == 1468 and report[key]['changes'] == []
    assert report[key]['head'] == CANDIDATE and report[key]['status'] == ''
for key in ['frozenPre', 'frozenPost']:
    assert report[key] == {'files': 184, 'changed': [],
        'revision': 'd1ae110f2edd99f9c7d899ed61557891ab587639', 'rulesVersion': 2}
assert report['result'] == ledger['result'] == {
    'tick': 238516, 'winner': None, 'naturalComplete': False, 'observationStopped': True}
assert ledger['start'] == 193200 and ledger['end'] == 238516
assert report['counts'] == ledger['counts'] == {
    'commands': 40184, 'hits': 8, 'events': 4777, 'plannerFrames': 3022}
assert event_types == ledger['eventsByType'] and terminal_owners == ledger['terminalsByPermanenceOwner']
assert permanent_terminals == ledger['allPermanentTerminalCount'] == 0
assert hits == ledger['allHits'] and len(hits) == 8
assert all(h['attackerOwner'] == h['targetOwner'] == 'p0' for h in hits)
assert ledger['enemyInvolvedNativeHits'] == [] and ledger['allNativeStatsExactlyInitial']
assert ledger['nativeUnitsLostDelta'] == {'p0': 0, 'p1': 0, 'p2': 0}
assert ledger['duplicateTerminalIds'] == [] and ledger['all3MemoriesPresent']
assert stop['authorizedByParent'] is True
assert closure['start'] == 237600 and closure['end'] == 238516
assert all(closure['restore'].values()) and all(closure['closure'].values())
assert closure['counts'] == {'commands': 721, 'hits': 0, 'events': 114, 'thinks': 62}
for key in ['sourcePre', 'sourcePost']:
    assert closure[key] == {'files': 1468, 'changed': [], 'head': CANDIDATE}
assert validation['tests'][0]['tests'] == 39 and validation['tests'][0]['exitCode'] == 0
assert validation['tests'][-1]['exitCode'] == 0 and contract['tests']['fullSuiteGreen'] is False
assert validation['tests'][2]['failed'] == 4 and validation['tests'][2]['exitCode'] == 1
assert capital['source'] == CANDIDATE and capital['sourceChanged'] == []
assert capital['inputWorldIdAll3MemUnchanged'] and capital['actualLaunch'] is None
assert capital['currentGold'] == 383.33 and capital['hallCost'] == 400
assert capital['nativeRefundQuote'] == 160 and round(capital['quotedGoldAfterRefund'], 2) == 543.33
single_launch = [r for r in capital['bodyRemovalCounterfactuals'] if len(r['removed']) == 1 and 'launch' in r]
assert len(single_launch) == 1 and single_launch[0]['removed'] == ['unit-p0-bombardShip-50739']
assert packing['sourceChanged'] == [] and all(r['worldIdAll3MemUnchanged'] for r in packing['results'])
packing_samples = []
for result in packing['results']:
    for ship in result['ships']:
        c = ship['counterfactualGeometryOnly']
        packing_samples.append({'tick': result['tick'], 'ship': ship['id'],
            'required': result['required'], 'selectedPower': result['selectedPower'],
            'actualPermanentPayloadPower': ship['permanentPower'],
            'actualPayloadCount': len(ship['payload']),
            'actualTemporaryPayloadCount': sum(u['kind'] == 'spirit' for u in ship['payload']),
            'actualAdditionalPermanentFitsCount': sum(u['fits'] for u in ship['additionalPermanentFits']),
            'withoutTemporaryShapesSingleAdditionalFitsCount': sum(u['fits'] for u in c['withoutTemporaryAdditionalFits']),
            'selectedWholeCrewFitsActualDeck': ship['expeditionCrewFitsActualDeck'],
            'selectedWholeCrewFitsEmptyDeck': c['emptyDeckSelectedCrewFits'],
            'selectedWholeCrewFitsWithoutTemporaryShapes': c['withoutTemporaryPayloadSelectedCrewFits']})
first, second, third = packing_samples
assert first['tick'] == 194400 and first['actualPayloadCount'] == 11
assert first['actualPermanentPayloadPower'] == 11.055814645032301
assert second['tick'] == 198000 and second['actualTemporaryPayloadCount'] == 2
assert second['actualPermanentPayloadPower'] == 9.49571591547157
assert second['actualAdditionalPermanentFitsCount'] == 0 and second['withoutTemporaryShapesSingleAdditionalFitsCount'] == 19
assert first['required'] == second['required'] == 20.115569375546702
assert all(not r['selectedWholeCrewFitsEmptyDeck'] for r in packing_samples)
assert geometry['frameBefore'] == geometry['frameAfter']
assert geometry['source1468BeforeChanges'] == geometry['source1468AfterChanges'] == []

entry = {
    'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
    'indexedPayloadFiles': 174, 'archiveRegularFiles': 175, 'payloadManifest': MANIFEST,
    'payloadHashesVerified': True,
    'source': CANDIDATE + ' independent unmerged e566 macro-choice/functional-transport candidate; changed-code193200 continuation of original0f summoner-v5+v7 ordinary case',
    'classification': 'Supported observation stop238516 exit0/winnernull/naturalCompletefalse, not newordinary0 or natural defeat/win.193200..23851640184commands/8own collisionhits/4777events,0enemyhits/0permanent terminal and native stats unchanged;1520temporary expiry observations are not combat losses.11permanent units actually boarded and left home, but194400/198000 actual permanent payload11.0558/9.4957 below required20.1156. Empty-deck/temporary-shape-removal packing and223200bombard-shape-removal launch are pure counterfactuals, not actual transfer/travel/spawn.383.33gold<400hall;160native refund quote exists, not executed. Last237600..238516916tick same-source coldclosure721commands/0hits/114events/62pre-p0 hashes plus finalworld/id/3mem exact.1468source/frozen184/rules2 fixed;39changedtests+tsc0,4inherited deployment failures retained, no fullsuitegreen. Unmerged negative case, no new production score/acceptance; later harbor-transfer/medical work excluded.'}
assert all(row['file'] != entry['file'] for row in old['packages'])
text = old_bytes.decode()
start, close = array_span(text)
insert_at = len(text[:close].rstrip())
rendered = '\n'.join('    ' + line for line in json.dumps(entry, ensure_ascii=False, indent=2).splitlines())
candidate_text = text[:insert_at] + ',\n' + rendered + '\n  ' + text[close:]
new = read_json(candidate_text)
assert len(new['packages']) == 69 and new['packages'][:68] == old['packages']
new_start, new_close = array_span(candidate_text)
assert candidate_text[new_start + 1:new_close].startswith(text[start + 1:close].rstrip() + ',\n')
assert set(new) == set(old)
unchanged = []
for key, value in old.items():
    if key == 'packages':
        continue
    assert new[key] == value
    a, b = value_span(text, key)
    c, d = value_span(candidate_text, key)
    assert text[a:b] == candidate_text[c:d]
    unchanged.append(key)
(OUT / 'bootstrap-complete-games-20261015-index.69.candidate.json').write_text(candidate_text)
dump('new-entry-69.verified.json', entry)

negative = {
    'classification': 'Archived-record attribution and independent streaming/JSONL consistency only; no native/planner/test rerun and no production integration.',
    'source': CANDIDATE, 'base': PRODUCTION, 'integrated': False,
    'ordinary0': False, 'changedCodeContinuation': True, 'inputOriginalSource': '0f5bf01a05046169d4fb42322376f767b97bcc83',
    'inputTick': 193200, 'inputSHA256': report['inputSHA256'], 'result': report['result'],
    'process': {k: report[k] for k in ['pid', 'startedAtUtc', 'endedAtUtc']},
    'fullRestore': report['restoreComparison'], 'counts': report['counts'],
    'rawJSONLRowCountsIndependentlyRead': line_counts, 'rawEventTypesIndependentlyRead': event_types,
    'allEightHitRowsSameOwner': True, 'maximumOwnCollisionHitDamage': max(h['damage'] for h in hits),
    'permanentTerminalRowsIndependentlyRead': permanent_terminals,
    'terminalOwnersIndependentlyRead': terminal_owners,
    'nativeStatsUnchangedAsArchived': ledger['allNativeStatsExactlyInitial'],
    'sourceFilesPrePost': 1468, 'frozenFilesPrePost': 184, 'rulesVersion': 2,
    'terminalReplay': {'from': 237600, 'to': 238516, 'nativeTicks': 916,
        'restore': closure['restore'], 'checks': closure['closure'], 'counts': closure['counts']},
    'packingSamplesAsArchived': packing_samples,
    'packingScope': 'At198000 removing both temporary body shapes permits each of19 single extra-candidate queries, individually, not19 simultaneously. Selected whole crew still fails on empty deck in all3 recorded component inputs. Not an exhaustive search of alternate crew, actual disembark, or invasion proof.',
    'capitalAsArchived': {'tick': capital['tick'], 'gold': capital['currentGold'], 'hallCost': capital['hallCost'],
        'actualLaunch': capital['actualLaunch'], 'queuedJob': capital['yard']['queue'],
        'nativeRefundCommand': capital['nativeRefundCommand'], 'nativeRefundQuote': capital['nativeRefundQuote'],
        'quotedGoldAfterRefund': capital['quotedGoldAfterRefund'], 'unitQuotes': capital['unitQuotes'],
        'singleBodyRemovalWithLegalLaunch': single_launch[0]},
    'capitalScope': 'Body-set removal only; no demonstrated executable public move, real launch, refund, purchase, worker delivery, build survival or neutral camp win. Current cash is insufficient for400hall, but valid refund/bounty paths mean funds are not mathematically closed.',
    'fleetGeometryScope': 'Shore station can fit/fire while half-turn sweep samples fail; synthetic admission true/false components both return no goal for selected two warships. This does not establish actual full sailing/native FIFO execution or attainable combat position.',
    'validationAsArchived': {'changedTestsPassed': 39, 'typecheckExitCode': 0,
        'inheritedDeploymentFailures': 4, 'fullSuiteGreen': False,
        'sourceCapsule': validation['sourceCapsule']},
    'scopeLimits': ['Not a fresh0, new holdout score, natural win/loss or bootstrap acceptance.',
        'Only916terminal ticks have this exact native replay closure, not all45316ticks re-simulated by this review.',
        'Temporary expiry rows are not combat casualties;8selfcollisionhits include actual damage, maximum11.297212030904962.',
        'Observer polling and last-hit causal limits remain as sealed; onlyrecent summaries are bounded.',
        'Later harbor-transfer/medical work belongs to new unclosed sources and is excluded.',
        'Original broken-container uncommitted changes remain unavailable and unrecovered.']}
dump('unmerged-078026-negative-case.json', negative)
verification = {
    'classification': 'New archive only: compressed SHA/bytes, streaming tar headers/payload SHA+bytes/coverage, raw JSONL rows and selected archived records. Does not independently rerun native, source capsule audit, whole-game ledger generation or tests.',
    'archive': str(ARCHIVE), 'bytes': compressed_bytes, 'sha256': compressed_hash.hexdigest(),
    'payloadCount': len(payloads), 'regularMembersIncludingIndex': len(regular),
    'manifest': MANIFEST, 'manifestSHA256': sha(kept[MANIFEST]),
    'allPayloadSHAAndDeclaredBytesExact': True, 'allActualBytesMatchTarHeaders': True,
    'allRegularsExactlyCovered': True, 'duplicateAndNonregularMembersRejected': True,
    'gzipCRCAndEOFVerified': True, 'selectedRecordsAgree': True,
    'rawJSONLRows': line_counts, 'inventory': regular}
dump('new-archive-stream-verification.json', verification)
audit = {
    'createdAtUtc': datetime.now(timezone.utc).isoformat(), 'baseDocsCommit': BASE,
    'rootHeadObservedBefore': observed_head_before, 'rootHeadObservedAfter': git('rev-parse', 'HEAD').decode().strip(),
    'oldIndexSHA256': sha(old_bytes), 'candidateIndexSHA256': sha(candidate_text.encode()),
    'oldPackages': 68, 'newPackages': 69,
    'old68EachValueAndRawPackageTextExact': True, 'allExistingMetadataValueAndRawTextExact': True,
    'unchangedMetadataKeys': unchanged, 'intentionalExistingMetadataChanges': [], 'addedMetadataKeys': [],
    'productionHeadRetained': PRODUCTION, 'strategyBaselineRetained': old['strategyBaseline'],
    'old0fProductionOrdinary0ValueAndRawTextExact': True, 'e566CurrentCombinedOrdinary0ValueAndRawTextExact': True,
    'rootCanonicalIndexSHA256Before': root_index_before_sha,
    'rootCanonicalIndexSHA256After': sha((REPO / ROOT_INDEX).read_bytes()),
    'rootWritesCopiesExtractionNativeTestsStagesCommits': False,
    'onlyNewPackageStreamVerified': True, 'earlier68PackagesNotReverifiedOrRepacked': True,
    'activeCandidate': 'bootstrap-complete-games-20261015-index.69.candidate.json',
    'archive': {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
        'payloads': 174, 'regularFilesIncludingIndex': 175},
    'scriptUsage': 'python3 ' + str(OUT / 'verify-and-prepare69.py'),
    'originalUncommittedRecoveryGapRetained': True}
audit['files'] = {name: {'path': str(OUT / name), 'bytes': (OUT / name).stat().st_size,
    'sha256': sha((OUT / name).read_bytes())} for name in [
    'bootstrap-complete-games-20261015-index.69.candidate.json',
    'canonical-index-68.original.json', 'new-entry-69.verified.json',
    'unmerged-078026-negative-case.json', 'new-archive-stream-verification.json',
    'README-append69.candidate.zh.md', 'verify-and-prepare69.py'] if (OUT / name).is_file()}
dump('FINAL-DELIVERY69.json', audit)
print(json.dumps({k: v for k, v in audit.items() if k != 'files'}, ensure_ascii=False))
