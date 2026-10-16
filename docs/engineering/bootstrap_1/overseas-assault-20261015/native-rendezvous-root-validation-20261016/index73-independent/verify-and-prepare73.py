"""Verify sealed ab0 full negative case; append73 only, all72 metadata exact."""
from pathlib import Path
from io import BytesIO
from datetime import datetime, timezone
from collections import Counter
import gzip
import hashlib
import json
import subprocess
import sys
sys.path.insert(0, '/workspace/.playtest/root-next-evidence-index72-20261016')
from stream_support import (sha, read_json, stream_archive, git_blob_inventory,
    append_package, assert_preserved_packages, assert_raw_metadata_equal)

OUT = Path(__file__).resolve().parent
REPO = Path('/workspace/sketch-rts-bootstrap-resume')
ROOT_INDEX = 'docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
BASE72 = Path('/workspace/.playtest/root-next-evidence-index72-20261016/bootstrap-complete-games-20261015-index.72.candidate.json')
BASE70 = Path('/workspace/.playtest/root-next-evidence-index71-20261016/canonical-index-70.original.json')
OLD_SHA = '69831e28d7fafbb12311fe63292e71a4ba2cd9611558f71e975836b8735bf40c'
CURRENT = 'ade412414d9232206f39e20f0182f0086605433c'
CANDIDATE = 'ab0ffd200725968a9c4887d2d7883cfeec1eaa8f'
A90 = 'a90c0119d7166baad1c9222781baab107deedbcb'
HISTORICAL = 'e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
ARCHIVE = Path('/workspace/.playtest/bootstrap-mercenary-return-ab0-complete-negative-evidence-20261016.tar.gz')
EXPECTED_BYTES = 17557242
EXPECTED_SHA = '7d98d3f4c185f13bd90bb2b97b02f36c3f6da1cb6582fe490eb291fd1b95ddee'
EXPECTED_INDEX_SHA = '9ca41348082fc0bd57500182b51d5019f5c65e649c8b7b6df3b83b19d37a949f'
P = 'return-evidence/'
EP = P + 'candidate-return-episode'
TAIL = P + 'candidate-complete-tail'
KEEP = {'INDEX.json', P + 'README.zh.md', P + 'runtime-source-seal.json',
    P + 'candidate-runtime-source.tar.gz', P + 'frozen184-runtime-source.tar.gz',
    P + 'inputs/original-e566-runtime-capsule.json', P + 'validation.json',
    P + 'complete-ledger-audit.json', P + 'inputs/actual-e566-13764-after-step.json.gz',
    P + 'inputs/actual-e566-13800.json.gz', P + 'baseline13764-13800.json',
    P + 'baseline13764-13800-terminal.json.gz', P + 'baseline13764-13800-commands.jsonl',
    P + 'baseline13764-13800-native-hits.jsonl',
    'closed-source-intent/same-old-world-source-intent.json',
    'closed-source-intent/old-source-stop-command-audit.json',
    P + 'query-pipeline-pair-scope-note.json'}
for prefix in [EP, TAIL]:
    KEEP.update(prefix + suffix for suffix in ['.json', '-restore.json', '-commands.jsonl',
        '-native-hits.jsonl', '-native-deaths.jsonl', '-terminal.json.gz'])

def dump(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

old_bytes = BASE72.read_bytes()
assert sha(old_bytes) == OLD_SHA
(OUT / 'canonical-external-index-72.original.json').write_bytes(old_bytes)
old = read_json(old_bytes)
old70_bytes = BASE70.read_bytes()
old70 = read_json(old70_bytes)
assert len(old['packages']) == 72 and old['productionHead'] == CURRENT
assert old['productionValidation']['currentSource']['ordinary0Complete'] is False
assert old['productionValidation']['currentSource']['unmergedCandidatesExcluded']['medicalAb0']
root_head_before = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD']).decode().strip()
root_index_before = sha((REPO / ROOT_INDEX).read_bytes())
assert root_head_before == CURRENT
digest, size = hashlib.sha256(), 0
with ARCHIVE.open('rb') as inp:
    while chunk := inp.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
assert size == EXPECTED_BYTES and digest.hexdigest() == EXPECTED_SHA
with ARCHIVE.open('rb') as inp:
    inventory, kept = stream_archive(inp, KEEP)
manifest = read_json(kept['INDEX.json'])
assert sha(kept['INDEX.json']) == EXPECTED_INDEX_SHA and manifest['payloadFiles'] == 401
paths = set()
for row in manifest['files']:
    name = row['name']
    assert name not in paths
    paths.add(name)
    assert inventory[name] == {'sha256': row['sha256'], 'bytes': row['bytes']}
assert len(paths) == 401 and len(inventory) == 402 and set(inventory) == paths | {'INDEX.json'}
assert sum(inventory[name]['bytes'] for name in paths) == manifest['payloadBytes'] == 36835428

def record(name):
    return read_json(kept[name])

def frame(name):
    return read_json(gzip.decompress(kept[name]))

def rows(name):
    assert not kept[name] or kept[name].endswith(b'\n')
    return [read_json(line) for line in kept[name].splitlines()]

seal = record(P + 'runtime-source-seal.json')
assert seal['head'] == CANDIDATE and seal['allLiveSourceFilesUnchangedDuringSeal']
source_bytes, frozen_bytes = kept[P + 'candidate-runtime-source.tar.gz'], kept[P + 'frozen184-runtime-source.tar.gz']
assert len(source_bytes) == seal['currentSourceArchive']['bytes'] == 4530623
assert sha(source_bytes) == seal['currentSourceArchive']['sha256'] == '5f01169bfec8a9032b050cad168867875caf39a510c8591eb2bfdfab9a0a8830'
source_inventory, source_kept = stream_archive(BytesIO(source_bytes), {'SOURCE-INDEX.json', 'docs/engineering/bootstrap_1/frozen-policy.json'})
source_index = read_json(source_kept['SOURCE-INDEX.json'])
assert source_index['head'] == CANDIDATE and source_index['filesCount'] == len(source_index['files']) == 1465
source_paths = {row['path'] for row in source_index['files']}
assert len(source_paths) == 1465 and len(source_inventory) == 1466 and set(source_inventory) == source_paths | {'SOURCE-INDEX.json'}
assert all(source_inventory[row['path']]['sha256'] == row['sha256'] for row in source_index['files'])
assert git_blob_inventory(REPO, CANDIDATE, source_paths) == {name: source_inventory[name] for name in source_paths}
assert len(frozen_bytes) == seal['frozenArchive']['bytes'] == 1190331
assert sha(frozen_bytes) == seal['frozenArchive']['sha256'] == 'a43493bbbdb0e8b7e9810d64da6014e40b333d28f15f408249b5e74fe475f90a'
frozen_inventory, _ = stream_archive(BytesIO(frozen_bytes))
reference = record(P + 'inputs/original-e566-runtime-capsule.json')
assert len(frozen_inventory) == 497 and {name: row['sha256'] for name, row in frozen_inventory.items()} == reference['frozenFiles']
policy = read_json(source_kept['docs/engineering/bootstrap_1/frozen-policy.json'])
assert sha(source_kept['docs/engineering/bootstrap_1/frozen-policy.json']) == reference['frozenManifestSHA256'] == '0490e7d43d109e70be3b141f76d1276a778a3402f3ea19f51a8cd37fee941774'
assert policy['rulesVersion'] == 2 and policy['files'] == reference['frozenManifestFiles'] and len(policy['files']) == 184
assert all(frozen_inventory[name]['sha256'] == expected for name, expected in policy['files'].items())
episode, tail = record(EP + '.json'), record(TAIL + '.json')
ledger = record(P + 'complete-ledger-audit.json')
validation = record(P + 'validation.json')
assert episode['head'] == tail['head'] == ledger['head'] == CANDIDATE
assert episode['base'] == tail['base'] == A90 and episode['originalReference'] == HISTORICAL
assert episode['allMandatoryExact'] and tail['allMandatoryExact']
assert all(episode['mandatory'].values()) and all(tail['mandatory'].values())
assert episode['result']['tick'] == 14101 and episode['result']['winner'] is None
assert episode['actualReturnRelease']['tick'] == 14100
assert episode['actualReturnRelease']['actualCenterGap'] == 174.3649921331567 < 180
assert episode['doctorAtEnd']['hp'] == episode['doctorAtEnd']['maxHp'] == 105
assert episode['actualReturnRelease']['acceptedCommand']['scriptId'] == 'v6Backline'
assert tail['result']['tick'] == 41057 and tail['result']['winner'] == 'p1' and tail['result']['stopReason'] == 'natural-winner'
assert tail['doctorAtEnd'] is None and ledger['naturalResult']['remaining']['p0']['units'] == ledger['naturalResult']['remaining']['p0']['buildings'] == 0
initial = frame(P + 'inputs/actual-e566-13764-after-step.json.gz')
episode_final, final = frame(EP + '-terminal.json.gz'), frame(TAIL + '-terminal.json.gz')
episode_restore, tail_restore = record(EP + '-restore.json'), record(TAIL + '-restore.json')
assert episode_restore['sha256'] == sha(kept[P + 'inputs/actual-e566-13764-after-step.json.gz'])
assert tail_restore['sha256'] == sha(kept[EP + '-terminal.json.gz'])
assert all(episode_restore['checks'].values()) and all(tail_restore['checks'].values())
assert initial['snapshot']['tick'] == 13764 and episode_final['snapshot']['tick'] == 14101 and final['snapshot']['tick'] == 41057
assert set(initial['memories']) == set(episode_final['memories']) == set(final['memories']) == {'p0', 'p1', 'p2'}
assert not any(unit['owner'] == 'p0' for unit in final['snapshot']['units'])
assert not any(building['owner'] == 'p0' for building in final['snapshot']['buildings'])
assert frame(P + 'baseline13764-13800-terminal.json.gz') == frame(P + 'inputs/actual-e566-13800.json.gz')
baseline = record(P + 'baseline13764-13800.json')
assert baseline['allChecksExact'] and all(baseline['checks'].values())
all_commands, all_hits, terminal_rows, raw_counts = [], [], [], {}
for prefix, commands, hits in [(EP, 369, 36), (TAIL, 35159, 2077)]:
    command_rows, hit_rows, death_rows = rows(prefix + '-commands.jsonl'), rows(prefix + '-native-hits.jsonl'), rows(prefix + '-native-deaths.jsonl')
    assert len(command_rows) == commands and len(hit_rows) == hits
    assert record(prefix + '.json')['counts']['commands'] == commands and record(prefix + '.json')['counts']['hits'] == hits
    all_commands.extend(command_rows)
    all_hits.extend(hit_rows)
    terminal_rows.extend(death_rows)
    raw_counts[prefix] = {'commands': len(command_rows), 'hits': len(hit_rows), 'terminalStreamRows': len(death_rows)}
assert len(terminal_rows) == 157
terminal_by_id, cleanup_by_id = {}, {}
for row in terminal_rows:
    assert row['permanent']
    if row['type'] == 'native-unit-terminal':
        assert row['id'] not in terminal_by_id
        terminal_by_id[row['id']] = row
    else:
        assert row['type'] == 'terminal-status-update' and row['status'] == 'native-removal-after-nonpositive'
        assert row['id'] not in cleanup_by_id
        cleanup_by_id[row['id']] = row
assert len(terminal_by_id) == 145 and len(cleanup_by_id) == 12 and set(cleanup_by_id) <= set(terminal_by_id)
confirmed = {}
for unit_id, row in terminal_by_id.items():
    if row['confirmation'] == 'absent-at-native-boundary':
        assert unit_id not in cleanup_by_id
        confirmed[unit_id] = row['tick']
    else:
        assert row['confirmation'] == 'hp<=0-awaiting-cleanup' and unit_id in cleanup_by_id
        confirmed[unit_id] = cleanup_by_id[unit_id]['tick']
initial_corpses = {corpse['unitId']: corpse for corpse in initial['snapshot']['corpses']}
final_corpses = {corpse['unitId']: corpse for corpse in final['snapshot']['corpses']}
assert len(initial_corpses) == 54 and len(final_corpses) == 199
assert not set(initial_corpses) & set(confirmed) and set(final_corpses) == set(initial_corpses) | set(confirmed)
assert all(final_corpses[unit_id]['diedAtTick'] == tick for unit_id, tick in confirmed.items())
assert Counter(c['owner'] for c in final_corpses.values()) == {'p0': 62, 'p1': 79, 'p2': 39, 'neutral': 19}
assert all(ledger['checks'].values()) and ledger['newConfirmedDeathCount'] == 145 and ledger['finalCorpseCount'] == 199
assert ledger['doctor2255']['candidateActualDeathTick'] == confirmed['unit-p0-fieldMedic-2255'] == 17203
assert ledger['doctor2255']['originalActualDeathTick'] == 13964 and ledger['doctor2255']['extensionTicks'] == 3239 and not ledger['doctor2255']['survivedEnd']
doctor_fatal = [hit for hit in all_hits if hit['target'] == 'unit-p0-fieldMedic-2255' and hit['positiveToNonpositive']]
assert len(doctor_fatal) == 1 and doctor_fatal[0]['tick'] == 17203 and doctor_fatal[0]['attacker'] == 'unit-p1-emberRavager-2297'
assert validation['uniqueCoveredCases'] == 101 and validation['existingPassed'] == 94 and validation['newFinalPassed'] == 7
source_intent = record('closed-source-intent/same-old-world-source-intent.json')
assert [row['tick'] for row in source_intent['rows']] == [14400, 15000, 15600, 16200, 16800, 17400, 18000]
assert all(all(row['checks'].values()) and row['stopOnlyVsOriginal']['entriesEqual'] and row['returnOnlyVsStopBase']['entriesEqual'] for row in source_intent['rows'])
old_stops = record('closed-source-intent/old-source-stop-command-audit.json')
assert old_stops['allOldAcceptedStopCount'] == old_stops['allOldPlannedStopCount'] == 1
assert old_stops['allOldAcceptedStops'][0]['tick'] == 13875
assert not any('horse4294' in name or 'postloss' in name for name in paths)

entry = {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
    'indexedPayloadFiles': 401, 'archiveRegularFiles': 402, 'payloadManifest': 'INDEX.json',
    'payloadHashesVerified': True,
    'source': CANDIDATE + ' unmerged a90c stop plus narrow mercenary-return-road candidate over historicale566; actual changed-code13764 input, not ordinary0',
    'classification': 'Local13764..14101 full3AI return succeeds:14100 original180leash releases2255 at174.365gap/full105HP and backline issuesmove;14101 is completeafterstep continuation boundary. Same-source14101..41057 then naturallyp1WIN/p0zero units/buildings/62permanentlosses versus originale566 ordinary0p0WIN43714/56loss.2255 dies17203,3239ticks later than original13964, not terminal preservation or full-game benefit. Whole ledger54inherited corpses+145newconfirmed=199 IDs/native all-owner counters exact;157terminal rows include12hp0 provisional→cleanup updates, not157newdeaths or everytick replay. Original36tick13764..13800 baseline closes35commands/3hits; first candidate13770 actualgoal north→south, not an isolated full-match ablation of a90stop.1465source and497frozenarchive/184manifest independently verified.101distinct contracts94old+7new; first100/101 overlay-context red retained,7rerun includes6overlap, not107tests. Seven OLDworld three-source pureplans equal only at sampled14400..18000, not newtrajectory/alltimes proof. Later unclosedhorse4294 raw/native investigation excluded. Not integrated into ade; both historical ordinary0score records and currentade noordinary0 remain unchanged.'}
assert all(row['file'] != entry['file'] for row in old['packages'])
text = old_bytes.decode()
candidate_text = append_package(text, entry)
assert_preserved_packages(text, candidate_text, 72)
assert_raw_metadata_equal(text, candidate_text, [key for key in old if key != 'packages'])
new = read_json(candidate_text)
assert new['packages'][:70] == old70['packages']
assert_raw_metadata_equal(old70_bytes.decode(), candidate_text, ['productionOrdinary0', 'currentCombinedOrdinary0', 'strategyBaseline', 'unmergedObservationStatus', 'observationHistory'])
assert new['productionValidation']['historicalSources'][HISTORICAL]['validation'] == old70['productionValidation']
(OUT / 'bootstrap-complete-games-20261015-index.73.candidate.json').write_text(candidate_text)
dump('new-entry-73.verified.json', entry)
dump('ab0-complete-negative-case-summary.json', {
    'classification': 'Sealed record consistency plus independent stream/inner source/Git/frozen hashes and corpse/cleanup reconciliation; no native/planner/test reruns.',
    'candidate': CANDIDATE, 'base': A90, 'originalReference': HISTORICAL, 'integrated': False,
    'ordinary0': False, 'localWindow': {'from': 13764, 'to': 14101, 'releaseTick': 14100,
        'releaseGap': 174.3649921331567, 'leash': 180, 'HP': 105, 'counts': episode['counts']},
    'naturalTail': {'from': 14101, 'to': 41057, 'winner': 'p1', 'counts': tail['counts'],
        'remaining': ledger['naturalResult']['remaining'], 'nativeLosses': ledger['nativeUnitsLost']},
    'doctor2255': {key: ledger['doctor2255'][key] for key in ['originalActualDeathTick', 'candidateActualDeathTick', 'extensionTicks', 'survivedEnd']},
    'independentLedgerChecks': {'initialCorpseCount': 54, 'newUniqueTerminalIds': 145,
        'provisionalHP0CleanupUpdateRows': 12, 'rawTerminalStreamRows': 157, 'finalCorpses': 199,
        'initialAndNewDisjoint': True, 'allFinalCorpseIdsExact': True,
        'corpseTicksEqualConfirmedCleanupTicks': True, 'finalCorpseOwners': Counter(c['owner'] for c in final_corpses.values())},
    'rawCountsIndependentlyRead': raw_counts,
    'validationAsArchived': validation,
    'sampledOldWorldSourceIntent': {'ticks': [row['tick'] for row in source_intent['rows']],
        'allEntriesEqual': True, 'oldActualStopCount': 1, 'scope': source_intent['classification']},
    'scopeLimits': ['Local fullHP return/3239tick lifespan gain is followed by complete naturaldefeat; no production acceptance.',
        'Candidate combines a90stop and returngoal, so loss is not assigned solely to one home sorter.',
        'A valid static road does not guarantee future survival; no-road intent does not cancel existing native move.',
        '13800/60/75 queries use OLD actual inputs; late13860 newmove suppresses sameframe heal, preserved scope-note.',
        'Only source hashes/raw IDs/corpses and saved records verified here, not everytick whole trajectory replay.',
        'Newhorse4294 raw/native diagnostic excluded; oldsealed read-only summaries remain.',
        'Currentade has no completeordinary0; historicale566/0f scores and unrecovered originaluncommitted gap retained.']})
dump('new-archive-and-inner-stream-verification.json', {
    'archive': str(ARCHIVE), 'bytes': size, 'sha256': digest.hexdigest(), 'manifestSHA256': sha(kept['INDEX.json']),
    'payloadCount': 401, 'regularIncludingINDEX': 402, 'payloadBytes': manifest['payloadBytes'],
    'allPayloadSHABytesCoverageHeadersCRCExact': True,
    'sourceCapsule': {'file': 'return-evidence/candidate-runtime-source.tar.gz', 'bytes': len(source_bytes),
        'sha256': sha(source_bytes), 'sourceFiles': 1465, 'regularIncludingSOURCEINDEX': 1466,
        'allPayloadHashesCoverageExact': True, 'all1465GitBlobBytesAndSHAExact': True},
    'frozenArchive': {'bytes': len(frozen_bytes), 'sha256': sha(frozen_bytes),
        'all497HistoricalHashesExact': True, 'validated184ManifestExact': True},
    'rawCounts': raw_counts, 'confirmedNewDeathIds': len(confirmed),
    'all199FinalCorpseIDsAndCleanupTicksClosed': True, 'inventory': inventory,
    'scope': 'Read-only streams and archived-source/record reconciliation only. No native/planner/test execution.'})
delivery = {'createdAtUtc': datetime.now(timezone.utc).isoformat(),
    'rootHeadObservedBefore': root_head_before,
    'rootHeadObservedAfter': subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD']).decode().strip(),
    'baseExternalIndex72SHA256': OLD_SHA, 'candidateIndex73SHA256': sha(candidate_text.encode()),
    'oldPackages': 72, 'newPackages': 73, 'old72EachValueAndRawPackageTextExact': True,
    'old70OriginalAndNew71E47And72RootEntriesExact': True,
    'allMetadataValueAndRawTextExactVs72': True, 'bothOrdinary0RecordsValueAndRawTextExactVsRoot70': True,
    'historicalE566ValidationObjectValueExact': True,
    'metadataChangesVs72': [], 'metadataChangesVsRoot70': ['productionHead', 'productionDelta', 'productionValidation'],
    'currentProductionHead': CURRENT, 'currentAdeOrdinary0Complete': False,
    'rootIndexSHA256Before': root_index_before, 'rootIndexSHA256After': sha((REPO / ROOT_INDEX).read_bytes()),
    'rootWritesCopiesExtractionNativeTestsStagesCommits': False,
    'earlier72PackagesNotReverifiedOrRepacked': True,
    'activeFinalCandidate': 'bootstrap-complete-games-20261015-index.73.candidate.json',
    'requiredNewArchivesForParent': new['packages'][-3:],
    'scriptUsage': 'python3 ' + str(OUT / 'verify-and-prepare73.py'),
    'supportModule': '/workspace/.playtest/root-next-evidence-index72-20261016/stream_support.py',
    'supportModuleSHA256': sha(Path('/workspace/.playtest/root-next-evidence-index72-20261016/stream_support.py').read_bytes()),
    'originalUncommittedRecoveryGapRetained': True}
delivery['files'] = {name: {'path': str(OUT / name), 'bytes': (OUT / name).stat().st_size,
    'sha256': sha((OUT / name).read_bytes())} for name in ['bootstrap-complete-games-20261015-index.73.candidate.json',
    'canonical-external-index-72.original.json', 'new-entry-73.verified.json', 'ab0-complete-negative-case-summary.json',
    'new-archive-and-inner-stream-verification.json', 'README-append73.candidate.zh.md', 'verify-and-prepare73.py'] if (OUT / name).is_file()}
dump('FINAL-DELIVERY73.json', delivery)
print(json.dumps({k: v for k, v in delivery.items() if k not in ['files', 'requiredNewArchivesForParent']}, ensure_ascii=False))
