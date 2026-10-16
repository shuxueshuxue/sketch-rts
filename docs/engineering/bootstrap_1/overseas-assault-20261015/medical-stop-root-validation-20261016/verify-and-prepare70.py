"""Read-only sealed medical negative-case stream verification; external index70.

No extraction, archive copying, repository edits, native/planner/test execution.
The pinned working index69 is preserved in full except one appended package.
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
BASE = '696197ebfc4d0234eca9aafc9e633318212de424'
PRODUCTION = 'e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
CANDIDATE = 'a90c0119d7166baad1c9222781baab107deedbcb'
ROOT_INDEX = 'docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
OLD_SHA = 'a561d110d9ff1a937a0ba0b5df262b919d7b8f42589aea1bb6aabec89350a04e'
ARCHIVE = Path('/workspace/.playtest/bootstrap-e566-medical-and-stop-ownership-evidence-20261016.tar.gz')
EXPECTED_BYTES = 5886640
EXPECTED_SHA = '0e1f8c7c0a1c85a75f4bddbb78f342bdd61ef5cc3cffe4b11fc15018c47c8c89'
EXPECTED_INDEX_SHA = '8f721f128ae1eabe538dc970d18b27d1305b3b23a54e38357ddf26815b002785'
MANIFEST = 'INDEX.json'
BP = 'baseline/baseline13800-13964'
CP = 'candidate/candidate13800-13964'
KEEP = {MANIFEST, 'candidate/comparison.json', 'candidate/comparison-prior-serialization.json',
        'candidate/comparison-serialization-note.json', 'candidate/validation.json',
        'candidate/independent-review.json', 'candidate/final-source-audit.json',
        'candidate/query-actual13875.json', 'baseline/return-goal-safety-query.json',
        'candidate/inputs/actualordinary0-13800.json.gz',
        'candidate/inputs/actualordinary0-13964-after-step.json.gz',
        'candidate/README.zh.md'}
for prefix in [BP, CP]:
    KEEP.update(prefix + suffix for suffix in ['.json', '-restore.json', '-source-preflight.json',
        '-source-postflight.json', '-commands.jsonl', '-native-hits.jsonl', '-native-deaths.jsonl',
        '-terminal.json.gz', '-prethink-13800.json.gz'])
JSONL_COUNTS = {BP + '-commands.jsonl': 157, CP + '-commands.jsonl': 164,
               BP + '-native-hits.jsonl': 14, CP + '-native-hits.jsonl': 11,
               BP + '-native-deaths.jsonl': 1, CP + '-native-deaths.jsonl': 1}

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

def array_span(text):
    start = re.search(r'"packages"\s*:\s*\[', text).end() - 1
    _, length = json.JSONDecoder().raw_decode(text[start:])
    return start, start + length - 1

observed_head_before = git('rev-parse', 'HEAD').decode().strip()
root_index_before_sha = sha((REPO / ROOT_INDEX).read_bytes())
original = OUT / 'canonical-working-index-69.original.json'
if original.exists():
    old_bytes = original.read_bytes()
else:
    old_bytes = (REPO / ROOT_INDEX).read_bytes()
    if sha(old_bytes) != OLD_SHA:
        raise ValueError('Root working index is not authorized pinned69')
    original.write_bytes(old_bytes)
assert sha(old_bytes) == OLD_SHA
old = read_json(old_bytes)
old68 = read_json(git('show', BASE + ':' + ROOT_INDEX))
assert len(old['packages']) == 69 and old['packages'][:68] == old68['packages']
assert all(old[k] == v for k, v in old68.items() if k != 'packages')
assert old['productionHead'] == PRODUCTION and old['currentCombinedOrdinary0']['winTick'] == 43714
assert old['currentCombinedOrdinary0']['ownPermanentLosses'] == 56
assert old['productionOrdinary0']['source'].startswith('0f5bf01a')

compressed_hash = hashlib.sha256()
compressed_bytes = 0
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
assert sha(kept[MANIFEST]) == EXPECTED_INDEX_SHA
paths = set()
for row in manifest['files']:
    name = canonical(row['name'])
    assert name not in paths
    paths.add(name)
    if regular.get(name) != {'bytes': row['bytes'], 'sha256': row['sha256']}:
        raise ValueError('Payload SHA/bytes mismatch: ' + name)
assert len(paths) == manifest['payloadFiles'] == 112 and len(regular) == 113
assert set(regular) == paths | {MANIFEST}
assert sum(regular[name]['bytes'] for name in paths) == manifest['payloadBytes'] == 9297779

def record(name):
    return read_json(kept[name])

def frame(name):
    return read_json(gzip.decompress(kept[name]))

raw_rows = {}
for name, expected in JSONL_COUNTS.items():
    if kept[name] and not kept[name].endswith(b'\n'):
        raise ValueError('Missing JSONL final newline: ' + name)
    rows = [read_json(line) for line in kept[name].splitlines()]
    assert len(rows) == expected
    raw_rows[name] = rows
baseline = record(BP + '.json')
candidate = record(CP + '.json')
comparison = record('candidate/comparison.json')
validation = record('candidate/validation.json')
query = record('candidate/query-actual13875.json')
audit = record('candidate/final-source-audit.json')
review = record('candidate/independent-review.json')
serialization = record('candidate/comparison-serialization-note.json')
roads = record('baseline/return-goal-safety-query.json')
assert baseline['head'] == comparison['baseHead'] == validation['base'] == PRODUCTION
assert candidate['head'] == comparison['candidateHead'] == validation['candidate'] == CANDIDATE
assert baseline['allChecksExact'] and all(baseline['checks'].values()) and comparison['baselineClosed']
assert candidate['allMandatoryExact'] and all(candidate['mandatory'].values())
assert candidate['allChecksExact'] is False
assert candidate['checks']['terminalWorldExact'] is False and candidate['checks']['terminalAll3memExact'] is False
assert candidate['checks']['terminalNextIdExact'] and candidate['checks']['terminalSetupExact']
assert candidate['checks']['commandsExact'] is False and candidate['checks']['hitsExact'] is False
assert baseline['result']['tick'] == candidate['result']['tick'] == 13964
assert baseline['result']['winner'] is candidate['result']['winner'] is None
assert baseline['counts']['actualCommands'] == 157 and baseline['counts']['actualHits'] == 14
assert candidate['counts']['actualCommands'] == 164 and candidate['counts']['actualHits'] == 11
assert baseline['counts']['plans'] == candidate['counts']['plans'] == 33
for prefix, head in [(BP, PRODUCTION), (CP, CANDIDATE)]:
    restore = record(prefix + '-restore.json')
    assert restore['inputSHA256'] == '2243a6cbc103f2c133b054868febf04aad20ecabd4304e14267f637bb8a3116d'
    assert all(restore[key] for key in ['restoreWorld', 'restoreNextId', 'restoreAll3mem', 'restoreSetup', 'restoreExact'])
    pre, post = record(prefix + '-source-preflight.json'), record(prefix + '-source-postflight.json')
    assert pre == post['source'] and pre['head'] == head and pre['status'] == '' and len(pre['files']) == 1462
    assert post['frozenPre'] == post['frozenPost'] and len(post['frozenPre']) == 497
    assert record(prefix + '.json')['counts']['frozenFiles'] == 497
initial = frame('candidate/inputs/actualordinary0-13800.json.gz')
base_initial, cand_initial = frame(BP + '-prethink-13800.json.gz'), frame(CP + '-prethink-13800.json.gz')
initial_fields_equal = {key: initial[key] == base_initial[key] == cand_initial[key]
                        for key in ['snapshot', 'nextId', 'memories', 'setup']}
assert all(initial_fields_equal.values()) and set(initial['memories']) == {'p0', 'p1', 'p2'}
base_terminal, cand_terminal = frame(BP + '-terminal.json.gz'), frame(CP + '-terminal.json.gz')
actual_terminal = frame('candidate/inputs/actualordinary0-13964-after-step.json.gz')
baseline_terminal_fields = {key: base_terminal[key] == actual_terminal[key]
                            for key in ['snapshot', 'nextId', 'memories', 'setup']}
assert all(baseline_terminal_fields.values())
assert cand_terminal['snapshot'] != actual_terminal['snapshot'] and cand_terminal['memories'] != actual_terminal['memories']
assert cand_terminal['nextId'] == actual_terminal['nextId'] and cand_terminal['setup'] == actual_terminal['setup']

base_commands, cand_commands = raw_rows[BP + '-commands.jsonl'], raw_rows[CP + '-commands.jsonl']
first_difference = next(i for i, (a, b) in enumerate(zip(base_commands, cand_commands)) if a != b)
assert first_difference == comparison['firstCommandSequenceDifference']['position'] == 80
assert base_commands[first_difference] == comparison['firstCommandSequenceDifference']['baseline']
assert cand_commands[first_difference] == comparison['firstCommandSequenceDifference']['candidate']
assert base_commands[first_difference]['tick'] == cand_commands[first_difference]['tick'] == 13875
assert base_commands[first_difference]['command'] == {'type': 'stop', 'unitIds': ['unit-p0-fieldMedic-2255']}
assert all(query['checks'].values())
base_query, cand_query = query['results']
assert base_query['head'] == PRODUCTION and cand_query['head'] == CANDIDATE
removed = [e for e in base_query['entries'] if e not in cand_query['entries']]
assert len(removed) == 1 and removed[0]['command'] == base_commands[first_difference]['command']
assert [e for e in base_query['entries'] if e != removed[0]] == cand_query['entries']
assert base_query['afterMemory'] == cand_query['afterMemory']
for result in query['results']:
    assert result['worldUnchanged'] and result['nextIdUnchanged'] and result['otherOwnersUnchanged']

doctor = 'unit-p0-fieldMedic-2255'
death_facts = {}
for label, prefix, terminal, tick in [('baseline', BP, base_terminal, 13964), ('candidate', CP, cand_terminal, 13942)]:
    deaths, hits = raw_rows[prefix + '-native-deaths.jsonl'], raw_rows[prefix + '-native-hits.jsonl']
    assert len(deaths) == 1 and deaths[0]['id'] == doctor and deaths[0]['tick'] == tick and deaths[0]['permanent']
    fatal = [hit for hit in hits if hit['target'] == doctor and hit['positiveToNonpositive']]
    assert len(fatal) == 1 and fatal[0]['tick'] == tick
    assert fatal[0]['attacker'] == 'unit-p2-knight-2670' and fatal[0]['hpAfter'] <= 0
    assert all(unit['id'] != doctor for unit in terminal['snapshot']['units'])
    corpses = [corpse for corpse in terminal['snapshot']['corpses'] if corpse['unitId'] == doctor]
    assert len(corpses) == 1 and corpses[0]['diedAtTick'] == tick
    outgoing = [hit for hit in hits if hit['attacker'] == doctor]
    death_facts[label] = {'tick': tick, 'fatalHit': {k: fatal[0][k] for k in ['tick', 'attacker', 'target', 'damage', 'hpBefore', 'hpAfter']},
                         'corpseTick': corpses[0]['diedAtTick'], 'removed': True,
                         'outgoing': [{k: hit[k] for k in ['tick', 'target', 'damage']} for hit in outgoing]}
assert [h['damage'] for h in death_facts['baseline']['outgoing']] == [4, 4, 4]
assert death_facts['candidate']['outgoing'] == []
extra_golem = [hit for hit in raw_rows[CP + '-native-hits.jsonl']
               if hit['target'] == doctor and hit['attacker'] == 'unit-p2-golem-2491']
assert len(extra_golem) == 1 and extra_golem[0]['tick'] == 13918 and extra_golem[0]['damage'] == 39
assert not any(hit['target'] == doctor and hit['attacker'] == 'unit-p2-golem-2491'
               for hit in raw_rows[BP + '-native-hits.jsonl'])
assert validation['checks'][0]['testsPassed'] == 25 and validation['checks'][0]['exitCode'] == 0
assert validation['checks'][1]['exitCode'] == 0
assert sha(kept['candidate/comparison.json']) == review['comparisonSHA256'] == serialization['finalDerivedSHA256']
assert sha(kept['candidate/comparison-prior-serialization.json']) == serialization['originalDerivedSHA256']
assert comparison == record('candidate/comparison-prior-serialization.json')
assert serialization['sameParsedJSONValues'] and serialization['previousSerializationRecoveredByteExact']
assert audit['base']['inheritedCapsuleFiles'] == audit['candidate']['inheritedCapsuleFiles'] == 1462
assert audit['candidate']['extraFiles'] == 1 and audit['base']['extraFiles'] == 0
assert all(row['fullWorldNextIdAll3memSerializedUnchanged'] for row in roads['rows'])
road_summaries = [{'tick': row['tick'], 'goals': [{'hall': goal['home']['id'],
    'safeLandTravelTicks': goal.get('safeLandTravelTicks'),
    'retreatRoadTicks': goal.get('retreatLandRoad', {}).get('ticks') if isinstance(goal.get('retreatLandRoad'), dict) else None,
    'endpointGapToHallCenter': goal['endpointGapToHomeCenter']} for goal in row['goals']]} for row in roads['rows']]

entry = {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
    'indexedPayloadFiles': 112, 'archiveRegularFiles': 113, 'payloadManifest': MANIFEST,
    'payloadHashesVerified': True,
    'source': 'Actuale566 developed archer-v8+v8 ordinary0 loss diagnosis; independent unmergeda90c0119 stop-ownership candidate from identical13800 fullworld/id/3mem input',
    'classification': 'Only13800..13964 native164tick full3AI pair, not newordinary0/fullmatch/generalization. Samee566 baseline closes actualworld/id/3mem/setup/157commands/14hits; a90c restore/source/frozen exact but actualoutput diverges164commands/11hits. First sequence divergence13875 removes2255claim-violating v6Backline stop; all other entries/memory same only in that single13875purequery, not the entire window. Candidate retains unsafe northhall return, takes extra13918golem39damage, loses baseline3x4 outgoing damage and dies13942 versus original13964,22ticks earlier; each window has only this one new permanent death, fatalhit/corpse/removal closed.25protocol tests+tsc0 do not show rescue/tactical benefit; not integrated.1462inherited source/497frozen files prepost exact; newcandidate adds1test. Loss survey and static road/drawWorld evidence do not prove other deaths preventable or future route survival. Productione56643714/56loss and old0f record unchanged; later medical destination work excluded.'}
assert all(row['file'] != entry['file'] for row in old['packages'])
text = old_bytes.decode()
start, close = array_span(text)
insert_at = len(text[:close].rstrip())
rendered = '\n'.join('    ' + line for line in json.dumps(entry, ensure_ascii=False, indent=2).splitlines())
candidate_text = text[:insert_at] + ',\n' + rendered + '\n  ' + text[close:]
new = read_json(candidate_text)
assert len(new['packages']) == 70 and new['packages'][:69] == old['packages']
new_start, new_close = array_span(candidate_text)
assert candidate_text[new_start + 1:new_close].startswith(text[start + 1:close].rstrip() + ',\n')
assert set(new) == set(old)
unchanged_keys = []
for key, value in old.items():
    if key == 'packages':
        continue
    assert new[key] == value
    a, b = value_span(text, key)
    c, d = value_span(candidate_text, key)
    assert text[a:b] == candidate_text[c:d]
    unchanged_keys.append(key)
(OUT / 'bootstrap-complete-games-20261015-index.70.candidate.json').write_text(candidate_text)
dump('new-entry-70.verified.json', entry)
negative = {'classification': 'Independent streaming/archived-record and raw shortwindow consistency audit only. No native/planner/test run or production integration.',
    'base': PRODUCTION, 'candidate': CANDIDATE, 'integrated': False,
    'from': 13800, 'to': 13964, 'nativeTicks': 164, 'fresh0': False, 'completeMatch': False,
    'initialWorldIdAll3MemSetupFieldsEqual': initial_fields_equal,
    'baselineTerminalWorldIdAll3MemSetupFieldsEqualOriginal': baseline_terminal_fields,
    'baselineArchivedChecks': baseline['checks'], 'candidateArchivedChecks': candidate['checks'],
    'rawRowCountsIndependentlyRead': {name: len(rows) for name, rows in raw_rows.items()},
    'actualFirstCommandSequenceDifference': comparison['firstCommandSequenceDifference'],
    'actualExactRawCommandPrefixCount': first_difference,
    'single13875PureQueryOnlyStopRemoved': True, 'single13875PureQueryP0MemorySame': True,
    'entireWindowOnlyOneCommandRemoved': False,
    'doctor': doctor, 'deathFactsIndependentlyReadFromRawAndTerminalCorpses': death_facts,
    'candidateExtraGolemHit': {k: extra_golem[0][k] for k in ['tick', 'attacker', 'target', 'damage', 'hpBefore', 'hpAfter']},
    'candidateDeathEarlierTicks': 22,
    'sourceAsArchived': {'base': audit['base']['head'], 'candidate': audit['candidate']['head'],
        'inheritedFilesEach': 1462, 'candidateAdditionalTestFiles': 1, 'historicalFrozenFilesCheckedEach': 497,
        'rulesVersion': 2, 'validatedFrozenManifestFiles': 184},
    'validationAsArchived': validation, 'roadQueriesAsArchived': road_summaries,
    'roadScope': 'Native static current known-threat geometry, hall building-body endpoint64 away from hall center; no guarantee of future survival against faster pursuer. Candidate did not change return goal.',
    'derivedComparisonSerialization': serialization,
    'scopeLimits': ['Original natural43714win/56permanentlosses stays attributed solely to fixede566 ordinary0.',
        'Loss survey of8healers/veterans is a subset of original56 losses; fieldMedic2255/1907 are not priests; not all deaths shown preventable.',
        '25local protocol tests and tsc0 establish neither rescue nor improved complete match.',
        'Candidate terminalworld/mem/command/hit differences are real behavior, not failed initial restore; all recordedfalsechecks retained.',
        'Actual13875 first public divergence is not equivalent to all later commands remaining same.',
        'Snapshot drawWorld uses fresh static facing, not reconstructed historical animation.',
        'Later destination/return-owner candidates and harbor work excluded.',
        'Original broken-container uncommitted workspace gap remains unrecovered.']}
dump('unmerged-a90c-medical-negative-case.json', negative)
dump('new-archive-stream-verification.json', {
    'classification': 'Only new sealed package hash/bytes/coverage/JSONL and archived-record consistency. Does not rerun native, private queries, tests or wholematch audit.',
    'archive': str(ARCHIVE), 'bytes': compressed_bytes, 'sha256': compressed_hash.hexdigest(),
    'manifest': MANIFEST, 'manifestSHA256': sha(kept[MANIFEST]),
    'payloadCount': 112, 'payloadBytes': manifest['payloadBytes'], 'regularMembersIncludingIndex': 113,
    'allPayloadSHAAndDeclaredBytesExact': True, 'allActualBytesMatchTarHeaders': True,
    'allRegularsExactlyCovered': True, 'duplicateAndNonregularMembersRejected': True,
    'gzipCRCAndEOFVerified': True, 'selectedRecordsAndRawShortWindowFactsAgree': True,
    'rawJSONLRowCounts': {name: len(rows) for name, rows in raw_rows.items()}, 'inventory': regular})
delivery = {'createdAtUtc': datetime.now(timezone.utc).isoformat(), 'baseDocsCommit': BASE,
    'baseIndexKind': 'Authorized uncommitted working index69 appended to committed68; pinned by exactSHA.',
    'rootHeadObservedBefore': observed_head_before, 'rootHeadObservedAfter': git('rev-parse', 'HEAD').decode().strip(),
    'oldIndexSHA256': OLD_SHA, 'candidateIndexSHA256': sha(candidate_text.encode()),
    'oldPackages': 69, 'newPackages': 70, 'old69EachValueAndRawPackageTextExact': True,
    'allExistingMetadataValueAndRawTextExact': True, 'unchangedMetadataKeys': unchanged_keys,
    'intentionalExistingMetadataChanges': [], 'addedMetadataKeys': [],
    'productionHeadRetained': PRODUCTION, 'strategyBaselineRetained': old['strategyBaseline'],
    'old0fProductionOrdinary0ValueAndRawTextExact': True, 'e566CurrentCombinedOrdinary0ValueAndRawTextExact': True,
    'rootCanonicalIndexSHA256Before': root_index_before_sha,
    'rootCanonicalIndexSHA256After': sha((REPO / ROOT_INDEX).read_bytes()),
    'rootWritesCopiesExtractionNativeTestsStagesCommits': False,
    'onlyNewPackageStreamVerified': True, 'earlier69PackagesNotReverifiedOrRepacked': True,
    'activeCandidate': 'bootstrap-complete-games-20261015-index.70.candidate.json',
    'archive': {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
        'payloads': 112, 'regularFilesIncludingIndex': 113},
    'scriptUsage': 'python3 ' + str(OUT / 'verify-and-prepare70.py'),
    'originalUncommittedRecoveryGapRetained': True}
delivery['files'] = {name: {'path': str(OUT / name), 'bytes': (OUT / name).stat().st_size,
    'sha256': sha((OUT / name).read_bytes())} for name in [
    'bootstrap-complete-games-20261015-index.70.candidate.json', 'canonical-working-index-69.original.json',
    'new-entry-70.verified.json', 'unmerged-a90c-medical-negative-case.json',
    'new-archive-stream-verification.json', 'README-append70.candidate.zh.md', 'verify-and-prepare70.py'] if (OUT / name).is_file()}
dump('FINAL-DELIVERY70.json', delivery)
print(json.dumps({k: v for k, v in delivery.items() if k != 'files'}, ensure_ascii=False))
