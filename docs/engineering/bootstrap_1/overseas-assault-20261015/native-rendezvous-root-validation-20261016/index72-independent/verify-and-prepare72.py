"""Verify root ade package incl source/frozen nested archives; external index72."""
from pathlib import Path
from io import BytesIO
from datetime import datetime, timezone
import hashlib
import json
import subprocess
from stream_support import (sha, read_json, stream_archive, verify_dict_manifest,
    git_blob_inventory, replace_value, append_package, assert_preserved_packages,
    assert_raw_metadata_equal)

OUT = Path(__file__).resolve().parent
REPO = Path('/workspace/sketch-rts-bootstrap-resume')
ROOT_INDEX = 'docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
BASE71 = Path('/workspace/.playtest/root-next-evidence-index71-20261016/bootstrap-complete-games-20261015-index.71.candidate.json')
OLD_SHA = '9e826b5d17ab6372aefc549457798961fda068ee33449aaa7642de3eed1d1ee2'
CURRENT = 'ade412414d9232206f39e20f0182f0086605433c'
HISTORICAL = 'e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
ARCHIVE = Path('/workspace/.playtest/root-native-rendezvous-ade41241-20261016-evidence.tar.gz')
EXPECTED_SHA = '98f2bd2169c612ece8aee6f5a72c81d20787330b691edaf971d4409ac8e8aade'
EXPECTED_BYTES = 12754401
EXPECTED_INDEX_SHA = '065475edef936c136ae0cd8227e07b6e1070bc1f9d4f86aa868619e542ab0cc3'
RUNTIME_REFERENCE = Path('/workspace/.playtest/bootstrap-combined-e566-archer-v8v8-ordinary0-20261016/game-runtime-source.json')
KEEP = {'INDEX.json', 'root-source-ade41241.tar.gz', 'root-frozen-source.tar.gz',
    'root-source-capsule-verification.json', 'fixed-source.json', 'root-final-validation.json',
    'root-actual-window-result.json', 'root-vs-e47-recorded-comparison.json',
    'closure-224370-224460/proof.json', 'root-validation.json',
    'native-223200-225600/commands.jsonl', 'native-223200-225600/hits.jsonl',
    'native-223200-225600/events.jsonl', 'render-module-correction.json'}

def dump(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

old_bytes = BASE71.read_bytes()
assert sha(old_bytes) == OLD_SHA
(OUT / 'canonical-external-index-71.original.json').write_bytes(old_bytes)
old = read_json(old_bytes)
assert old['productionHead'] == CURRENT and len(old['packages']) == 71
root_head_before = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD']).decode().strip()
root_index_before = sha((REPO / ROOT_INDEX).read_bytes())
assert root_head_before == CURRENT
digest, total = hashlib.sha256(), 0
with ARCHIVE.open('rb') as inp:
    while chunk := inp.read(1024 * 1024):
        digest.update(chunk)
        total += len(chunk)
assert total == EXPECTED_BYTES and digest.hexdigest() == EXPECTED_SHA
with ARCHIVE.open('rb') as inp:
    inventory, kept = stream_archive(inp, KEEP)
manifest = read_json(kept['INDEX.json'])
assert sha(kept['INDEX.json']) == EXPECTED_INDEX_SHA and manifest['sourceHead'] == CURRENT
verify_dict_manifest(inventory, manifest['files'])
assert len(manifest['files']) == 212 and len(inventory) == 213
source_receipt = read_json(kept['root-source-capsule-verification.json'])
source_bytes = kept['root-source-ade41241.tar.gz']
frozen_bytes = kept['root-frozen-source.tar.gz']
assert len(source_bytes) == source_receipt['bytes'] == 4476512
assert sha(source_bytes) == source_receipt['sha256'] == 'cf872441040c5a0deda917e9fde15601c2dc9e00802bd43e9f2a38b1ac90e94c'
source_inventory, source_kept = stream_archive(BytesIO(source_bytes), {'INDEX.json', 'docs/engineering/bootstrap_1/frozen-policy.json'})
source_index = read_json(source_kept['INDEX.json'])
assert source_index['sourceHead'] == CURRENT and source_index['rulesVersion'] == 2
source_files = verify_dict_manifest(source_inventory, source_index['files'])
assert len(source_files) == 1464 and len(source_inventory) == 1465
fixed = read_json(kept['fixed-source.json'])
assert fixed['head'] == CURRENT and {name: row['sha256'] for name, row in source_files.items()} == fixed['hashes']
commit_inventory = git_blob_inventory(REPO, CURRENT, source_files)
assert commit_inventory == source_files
assert len(frozen_bytes) == source_receipt['frozenArchive']['bytes'] == 1190331
assert sha(frozen_bytes) == source_receipt['frozenArchive']['sha256'] == 'a43493bbbdb0e8b7e9810d64da6014e40b333d28f15f408249b5e74fe475f90a'
frozen_inventory, _ = stream_archive(BytesIO(frozen_bytes))
reference_bytes = RUNTIME_REFERENCE.read_bytes()
reference = read_json(reference_bytes)
assert len(frozen_inventory) == len(reference['frozenFiles']) == 497
assert {name: row['sha256'] for name, row in frozen_inventory.items()} == reference['frozenFiles']
assert sha(frozen_bytes) == reference['frozenArchiveSHA256'] and len(frozen_bytes) == reference['frozenArchiveBytes']
policy_bytes = source_kept['docs/engineering/bootstrap_1/frozen-policy.json']
policy = read_json(policy_bytes)
assert sha(policy_bytes) == reference['frozenManifestSHA256'] == '0490e7d43d109e70be3b141f76d1276a778a3402f3ea19f51a8cd37fee941774'
assert policy['files'] == reference['frozenManifestFiles'] and len(policy['files']) == 184
assert all(frozen_inventory[name]['sha256'] == expected for name, expected in policy['files'].items())
assert policy['rulesVersion'] == 2 and policy['revision'] == 'd1ae110f2edd99f9c7d899ed61557891ab587639'
final_validation = read_json(kept['root-final-validation.json'])
actual = read_json(kept['root-actual-window-result.json'])
comparison = read_json(kept['root-vs-e47-recorded-comparison.json'])
closure = read_json(kept['closure-224370-224460/proof.json'])
assert actual['head'] == final_validation['source'] == CURRENT
assert actual['counts'] == final_validation['counts'] == {'commands': 2430, 'hits': 0, 'events': 231, 'thinks': 160}
assert actual['winner'] is None and actual['naturalComplete'] is False
assert final_validation['observedPermanentTerminals'] == 0 and final_validation['nativeUnitsLostUnchanged']
assert final_validation['noCurrentSourceOrdinary0Complete'] and final_validation['macro078026AndMedicalA90cAb0NotIntegrated']
rows = {}
for name, count in [('commands', 2430), ('hits', 0), ('events', 231)]:
    rows[name] = [read_json(line) for line in kept['native-223200-225600/' + name + '.jsonl'].splitlines()]
    assert len(rows[name]) == count
permanent = [event for event in rows['events'] if event['type'] == 'native-unit-terminal' and event['permanent']]
assert permanent == []
assert comparison['savedCheckpointCount'] == comparison['referenceAvailable'] == len(comparison['checkpoints']) == 160
assert comparison['allWorldId3memAtAvailableCheckpoints'] and comparison['finalWorld'] and comparison['finalNextId'] and comparison['finalAll3Memories']
assert comparison['publicCommands'] == {'root': 2430, 'reference': 2430, 'allExact': True}
assert all(row[key] for row in comparison['checkpoints'] for key in ['available', 'world', 'nextId', 'all3mem'])
assert closure['start'] == 224370 and closure['end'] == 224460 and closure['counts'] == {'commands': 91, 'hits': 0, 'events': 7}
assert all(closure['proof']['restore'].values()) and all(closure['proof']['final'].values())
assert len(closure['proof']['thinks']) == 6 and all(row[k] for row in closure['proof']['thinks'] for k in ['snapshot', 'nextId', 'all3mem'])
assert closure['proof']['commands'] and closure['proof']['hits'] and closure['proof']['eventsWithOriginalCommandIndices']

entry = {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
    'indexedPayloadFiles': 212, 'archiveRegularFiles': 213, 'payloadManifest': 'INDEX.json',
    'payloadHashesVerified': True,
    'source': CURRENT + ' root native3file-only rendezvous integration over exacte566 AI; actual changed-code223200..225600 from prior078026 saved state',
    'classification': 'Independent root52tests/8files+tsc0; no078026macro/a90c-ab0medical imported. Actual2400tick normal3AI complete restore/world/id/3mem,1464source/184manifest prepost exact;2430commands/0hits/231events/160p0plans.160saved full-state checkpoints/final and all2430commands equal e47 two segments, not everytick/allcases. Root90tick224370..224460 coldrestore/6prethink/final/91commands/0hits/7events exact. Paidcutter birth223546; passenger parent224435 then normal naval publichelm cancels remainingboard224445, independent wholebody receiver support, not exactnative arrival completion.0new permanentloss but no income/attack/win;383.33→377.33 is6paidrepairs, receiver remains injured. Sealed inner1464source+INDEX exactadeGitblobs and full497frozenarchive/184manifest verified. Native saved-world drawWorld rerender with module-resolution failure/correction retained, not historical animation. No ade completeordinary0; historicale56643714/56loss and0f44441 scores unchanged; original uncommitted gap remains.'}
assert all(row['file'] != entry['file'] for row in old['packages'])
text = old_bytes.decode()
candidate_text = append_package(text, entry)
validation = json.loads(json.dumps(old['productionValidation']))
current = validation['currentSource']
current['rootEvidenceArchiveStatus'] = 'Sealed independent ade source/frozen/native evidence package; external stream verification includes both nested archives, no new native/test execution.'
current['rootEvidenceArchive'] = {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
    'payloads': 212, 'regularIncludingINDEX': 213,
    'sourceCapsule': {'file': 'root-source-ade41241.tar.gz', 'bytes': len(source_bytes), 'sha256': sha(source_bytes),
        'selectedSourceFiles': 1464, 'regularIncludingINDEX': 1465, 'allSHABytesCoverageAndAdeGitBlobExact': True},
    'frozenArchive': {'file': 'root-frozen-source.tar.gz', 'bytes': len(frozen_bytes), 'sha256': sha(frozen_bytes),
        'allHistorical497HashesExact': True, 'validatedManifest184Exact': True,
        'reference': str(RUNTIME_REFERENCE), 'referenceSHA256': sha(reference_bytes)}}
current['native2400']['completeArchivedLedger'] = {'permanentTerminals': 0, 'nativeUnitsLostUnchanged': True,
    'temporaryTerminalRows': 75, 'scope': 'Observed transient terminal/removal rows do not become permanent casualties; no complete-match gain established.'}
candidate_text = replace_value(candidate_text, 'productionValidation', validation)
new = read_json(candidate_text)
assert_preserved_packages(text, candidate_text, 71)
assert_raw_metadata_equal(text, candidate_text, [k for k in old if k not in ['packages', 'productionValidation']])
assert new['productionValidation']['historicalSources'] == old['productionValidation']['historicalSources']
assert new['productionHead'] == CURRENT and new['productionValidation']['currentSource']['ordinary0Complete'] is False
(OUT / 'bootstrap-complete-games-20261015-index.72.candidate.json').write_text(candidate_text)
dump('new-entry-72.verified.json', entry)
dump('productionValidation.ade.sealed.candidate.json', validation)
dump('new-archive-and-inner-stream-verification.json', {
    'classification': 'Only sealed root package/inner archives read, Git blob batch read and existing record consistency. No extraction/copy/native/planner/tests/source edits.',
    'archive': str(ARCHIVE), 'bytes': total, 'sha256': digest.hexdigest(),
    'manifestSHA256': sha(kept['INDEX.json']), 'payloadCount': 212, 'regularIncludingINDEX': 213,
    'allSHABytesCoverageHeadersCRCExact': True, 'outerInventory': inventory,
    'sourceCapsule': {'bytes': len(source_bytes), 'sha256': sha(source_bytes),
        'payloads': 1464, 'regularIncludingINDEX': 1465, 'indexSHA256': sha(source_kept['INDEX.json']),
        'allPayloadSHABytesCoverageExact': True, 'all1464AdeGitBlobBytesAndSHAExact': True,
        'allFixedSourceManifestRowsExact': True},
    'frozenArchive': {'bytes': len(frozen_bytes), 'sha256': sha(frozen_bytes), 'regularFiles': 497,
        'all497HistoricalReferenceHashesExact': True, 'policyManifest184Exact': True,
        'policyManifestSHA256': sha(policy_bytes), 'reference': str(RUNTIME_REFERENCE),
        'referenceSHA256': sha(reference_bytes)},
    'rawCountsIndependentlyRead': {key: len(value) for key, value in rows.items()},
    'rawPermanentTerminalsIndependentlyRead': 0, 'noCurrentSourceOrdinary0': True})
delivery = {'createdAtUtc': datetime.now(timezone.utc).isoformat(),
    'rootHeadObservedBefore': root_head_before,
    'rootHeadObservedAfter': subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD']).decode().strip(),
    'baseExternalIndexSHA256': OLD_SHA, 'candidateIndexSHA256': sha(candidate_text.encode()),
    'oldPackages': 71, 'newPackages': 72, 'old71EachValueAndRawPackageTextExact': True,
    'old70OriginalEntriesAndNew71E47EntryExact': True, 'bothOrdinary0RecordsValueAndRawTextExact': True,
    'historicalE566ValidationObjectValueExact': True, 'currentAdeOrdinary0Complete': False,
    'metadataChangedVs71': ['productionValidation'], 'metadataChangedVsRoot70': ['productionHead', 'productionDelta', 'productionValidation'],
    'rootIndexSHA256Before': root_index_before, 'rootIndexSHA256After': sha((REPO / ROOT_INDEX).read_bytes()),
    'rootWritesCopiesExtractionNativeTestsStagesCommits': False,
    'onlyNewRootPackageAndNestedArchivesVerified': True, 'earlier71PackagesNotReverifiedOrRepacked': True,
    'activeCandidate': 'bootstrap-complete-games-20261015-index.72.candidate.json',
    'archive': {'file': ARCHIVE.name, 'bytes': EXPECTED_BYTES, 'sha256': EXPECTED_SHA,
        'payloads': 212, 'regularIncludingINDEX': 213},
    'scriptUsage': 'python3 ' + str(OUT / 'verify-and-prepare72.py'),
    'originalUncommittedRecoveryGapRetained': True}
delivery['files'] = {name: {'path': str(OUT / name), 'bytes': (OUT / name).stat().st_size,
    'sha256': sha((OUT / name).read_bytes())} for name in ['bootstrap-complete-games-20261015-index.72.candidate.json',
    'canonical-external-index-71.original.json', 'new-entry-72.verified.json', 'productionValidation.ade.sealed.candidate.json',
    'new-archive-and-inner-stream-verification.json', 'README-append72.candidate.zh.md', 'verify-and-prepare72.py', 'stream_support.py'] if (OUT / name).is_file()}
dump('FINAL-DELIVERY72.json', delivery)
print(json.dumps({k: v for k, v in delivery.items() if k != 'files'}, ensure_ascii=False))
