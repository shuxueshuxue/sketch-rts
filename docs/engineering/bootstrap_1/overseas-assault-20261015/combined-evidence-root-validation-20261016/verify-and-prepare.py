"""Read-only tar verification and external index proposal; never writes the repo."""
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
BASE = '5968fb787120ff854cae41a900f2bf6f1b76fbd0'
INDEX_PATH = 'docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
NATIVE_COMMIT = '19ef6d0dbc1f9775475810db5a2fd0b663effb75'
NATIVE_PATH = 'docs/engineering/bootstrap_1/overseas-assault-20261015/'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def dump(path, data):
    (OUT / path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def unique_json(data):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError('Duplicate manifest JSON key: ' + key)
            out[key] = value
        return out
    return json.loads(data, object_pairs_hook=pairs)

def canonical_path(name):
    p = PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts:
        raise ValueError('Unsafe member name, even though nothing is extracted: ' + name)
    return str(p)

def verify(spec):
    path = Path(spec['path'])
    compressed = hashlib.sha256()
    compressed_bytes = 0
    with path.open('rb') as inp:
        while chunk := inp.read(1024 * 1024):
            compressed.update(chunk)
            compressed_bytes += len(chunk)
    if compressed_bytes != spec['bytes'] or compressed.hexdigest() != spec['sha256']:
        raise ValueError('Archive identity differs: ' + str(path))
    regular, nonregular, manifests = {}, [], []
    with path.open('rb') as raw, gzip.GzipFile(fileobj=raw) as gz:
        with tarfile.open(fileobj=gz, mode='r|') as archive:
            for member in archive:
                name = canonical_path(member.name)
                if member.isdir():
                    continue
                if not member.isfile():
                    nonregular.append({'path': name, 'type': member.type.decode('ascii', errors='replace')})
                    continue
                if name in regular:
                    raise ValueError('Duplicate normalized regular member: ' + name)
                digest, size = hashlib.sha256(), 0
                keep = bytearray() if name == spec['manifest'] else None
                stream = archive.extractfile(member)
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)
                    if keep is not None:
                        keep.extend(chunk)
                if size != member.size:
                    raise ValueError('Actual read differs from tar header bytes: ' + name)
                regular[name] = {'bytes': size, 'sha256': digest.hexdigest()}
                if keep is not None:
                    manifests.append(bytes(keep))
        # Force gzip CRC/EOF verification, even if tar ended at its zero blocks.
        while gz.read(1024 * 1024):
            pass
    if nonregular or len(manifests) != 1:
        raise ValueError('Expected only regular payloads and one exact manifest: ' + str(path))
    manifest = unique_json(manifests[0])
    records = manifest.get('files', manifest.get('payload'))
    if isinstance(records, dict):
        records = [{'path': p, **({'sha256': v} if isinstance(v, str) else v)} for p, v in records.items()]
    if not isinstance(records, list):
        raise ValueError('Unknown manifest record shape: ' + str(path))
    mapped, declared_bytes, differences = {}, 0, []
    prefix = PurePosixPath(spec['manifest']).parent
    for row in records:
        name = canonical_path(str(prefix / row['path']))
        if name in mapped:
            raise ValueError('Duplicate payload record: ' + name)
        mapped[name] = row
        actual = regular.get(name)
        if not actual or actual['sha256'] != row['sha256']:
            differences.append({'path': name, 'reason': 'missing payload or hash mismatch'})
        if 'bytes' in row:
            declared_bytes += 1
            if not actual or actual['bytes'] != row['bytes']:
                differences.append({'path': name, 'reason': 'declared payload byte mismatch'})
    covered = set(regular) == set(mapped) | {spec['manifest']}
    if differences or not covered or len(mapped) != spec['payloads'] or len(regular) != spec['regular']:
        raise ValueError('Manifest coverage/count/hash/bytes differs: ' + json.dumps(differences))
    result = {**spec, 'manifestSHA256': sha(manifests[0]), 'payloadHashesVerified': True,
        'payloadBytesReadMatchTarHeaders': True, 'declaredPayloadByteRecords': declared_bytes,
        'declaredPayloadByteRecordsVerified': declared_bytes,
        'allPayloadBytesDeclaredAndVerified': declared_bytes == len(mapped),
        'allRegularMembersExactlyCovered': covered, 'duplicateRegularMembersRejected': True,
        'nonregularPayloads': nonregular, 'gzipCRCAndEOFVerified': True,
        'payloadInventory': regular}
    if spec.get('gitArchiveCommit'):
        # Original local package is also compared to the already committed blob,
        # with no sparse checkout, no restoration and no temporary tar copy.
        proc = subprocess.Popen(['git', '-C', str(REPO), 'show',
            spec['gitArchiveCommit'] + ':' + NATIVE_PATH + path.name], stdout=subprocess.PIPE)
        digest, count = hashlib.sha256(), 0
        while chunk := proc.stdout.read(1024 * 1024):
            count += len(chunk)
            digest.update(chunk)
        if proc.wait() or count != compressed_bytes or digest.hexdigest() != compressed.hexdigest():
            raise ValueError('Original archive differs from exact committed native blob')
        result['originalArchiveEqualsCommittedGitBlob'] = True
    return result

old_bytes = git('show', BASE + ':' + INDEX_PATH)
old = unique_json(old_bytes)
if len(old['packages']) != 59:
    raise ValueError('This proposal is pinned to exactly59 prior packages')
if (OUT / 'canonical-index-59.original.json').read_bytes() != old_bytes:
    raise ValueError('External original does not equal exact5968 Git blob')
observed_head_before = git('rev-parse', 'HEAD').decode().strip()
native = unique_json(git('show', NATIVE_COMMIT + ':' + NATIVE_PATH + 'native-query-integration-20261016.json'))
specs = []
for i, row in enumerate(native['packages']):
    folder = 'bootstrap-native-primitives-20261016' if i == 0 else 'bootstrap-native-primitives-v2-20261016'
    specs.append({'path': '/workspace/.playtest/' + folder + '/' + row['file'],
        'bytes': row['bytes'], 'sha256': row['sha256'], 'manifest': row['index'],
        'payloads': row['payloadFiles'], 'regular': row['regularFilesIncludingIndex'],
        'gitArchiveCommit': NATIVE_COMMIT})
specs += [
    {'path': '/workspace/.playtest/bootstrap-summoner-v5-v7-holdout-0f5bf-193200-evidence.tar.gz',
     'bytes': 70402379, 'sha256': '989d5ccaa1e39270c1252c62eafada6143ce08facddb5559606200bd01fb024c',
     'manifest': 'bootstrap-summoner-v5-v7-holdout-0f5bf-20261016/INDEX.json', 'payloads': 855, 'regular': 856},
    {'path': '/workspace/.playtest/colony-bounty-feasibility-20261016-evidence.tar.gz',
     'bytes': 1113317, 'sha256': 'b931c0000ae7e8e183d7da0674529414fcbec09eaed43b664afbd916a4efb585',
     'manifest': 'INDEX.json', 'payloads': 33, 'regular': 34},
]
results = [verify(spec) for spec in specs]
sources = [
    '5db730d574bf6dc20e29b1874e442c043d24f122; base0f5bf native readonly queries',
    '9119feec0dd4b4933d5f8940b80df98abba80259; target replacement ID relookup on5db',
    'Fixed0f5bf01a ordinary0 summoner-v5+v7 predeclared generated holdout; exact same-source79800 recovery',
    'Read-only actual0f5bf holdout112800/145800 full planner and capital/bounty/refund evidence',
]
classes = [
    'Native land-arrival/automatic-attack query primitives. Three recorded-public-command components7905/10425/16245,65world/nextId checkpoints and73tests belong to5db. Three stored memories readonly; no new full-pipeline strategy game or AI consumer. Original delivery counted index among payload; actual231payload+1index.',
    'Final native target query re-resolves actual entity ID after replacement, preserving stale live-index behavior; runtime/arrival unchanged from5db.12query tests and stale-index witness are separate from root53tests/7files/tsc. No new ordinary0; original44441 remains0f5bf. Original delivery count corrected here only:20payload+1index.',
    'One genuine predeclared holdout ordinary0, original process exit137 after complete79800, exact world/id/all3mem restore plus139commands/2hits/10events persisted tail matched. Parent-authorized clean193200 observation stop/winnernull, not natural defeat or victory.132000..193200 bounded strategic stagnation; earlier two real outpost assaults do not clear22/13remaining enemy buildings.19integrity checks, normal500/3/8,1443source/frozen184 exact; seed now development, not bootstrap acceptance.',
    'Five pure full-p0 planner queries on actual112800/145800 original inputs, no game/step/issued command. Affordability removal/bounty target changes only island memory, actual6/5commands unchanged.45bounties/160paid cutter refund are real rules but not executed fixes; actual88395hall payment/88639destruction and102111/176/207bounties70+45+45 retained. Loading112800 and tiny-repair145800 blockers differ; no new ordinary0 or solved recovery.',
]

def entry(row, source, classification):
    return {'file': Path(row['path']).name, 'bytes': row['bytes'], 'sha256': row['sha256'],
        'indexedPayloadFiles': row['payloads'], 'archiveRegularFiles': row['regular'],
        'payloadManifest': row['manifest'], 'payloadHashesVerified': row['payloadHashesVerified'],
        'source': source, 'classification': classification}

additions = [entry(row, source, classification) for row, source, classification in zip(results, sources, classes)]
names = [p['file'] for p in old['packages']] + [p['file'] for p in additions]
if len(set(names)) != 63:
    raise ValueError('Duplicate package filename in63proposal')
# Text insertion preserves the complete existing59 package texts verbatim,
# rather than parsing and reformatting their values or metadata.
text = old_bytes.decode('utf-8')
start = re.search(r'"packages"\s*:\s*\[', text).end() - 1
_, length = json.JSONDecoder().raw_decode(text[start:])
close = start + length - 1
prefix = text[:close]
trimmed = prefix.rstrip()
insert_at = len(trimmed)
rendered = ',\n'.join('\n'.join('    ' + line for line in json.dumps(p, ensure_ascii=False, indent=2).splitlines()) for p in additions)
candidate = text[:insert_at] + ',\n' + rendered + '\n  ' + text[close:]
new = unique_json(candidate)
if new['packages'][:59] != old['packages'] or len(new['packages']) != 63:
    raise ValueError('Old59 values changed')
if {k:v for k,v in old.items() if k != 'packages'} != {k:v for k,v in new.items() if k != 'packages'}:
    raise ValueError('Existing production/strategy metadata changed')
if candidate[:insert_at] != text[:insert_at] or candidate.endswith(text[close:]) is not True:
    raise ValueError('Original package prefix/suffix not preserved verbatim')
(OUT / 'bootstrap-complete-games-20261015-index.63.candidate.json').write_text(candidate)
dump('additions-4.verified.json', additions)
deck_specs = []
for name in ['bootstrap-deck-casualty-d251-focused-and-oom40350-evidence', 'bootstrap-deck-casualty-a269-natural41255-evidence']:
    sealed = unique_json(Path('/workspace/.playtest/' + name + '-seal.json').read_bytes())
    deck_specs.append({'path': sealed['archive'], 'bytes': sealed['bytes'], 'sha256': sealed['sha256'],
        'manifest': 'INDEX.json', 'payloads': sealed['payloads'], 'regular': sealed['regularFilesIncludingIndex']})
deck_results = [verify(spec) for spec in deck_specs]
deck_classes = [
    'Unmerged fixedd251 focused35460..36000 and interrupted continuation through40350, no natural result on d251; retain all512/1024OOM failures and causal memo controls. Not new ordinary0 or acceptance.',
    'Hybrid changed-code continuation: switch35460 todeckd251,40350 to native bounded memoa269, naturalp0win41255/enemy0/intervalownloss0.8of13original army landed,5still aboard. Not ordinary0 or a new combined-production result; full terminal closure is separate.',
]
deck_entries = [entry(row, 'd251 deck continuation' if i == 0 else 'd251+a269 hybrid native continuation', deck_classes[i]) for i,row in enumerate(deck_results)]
dump('optional-65-entries.prepared.json', {'scope': 'Preverified only. Not appended to63candidate, no archives copied into root. Await parent integration decision and final source metadata.', 'entries': deck_entries})
care_cache_specs = [
    {'path':'/workspace/.playtest/bootstrap-care-native-filter-20261016/bootstrap-care-native-filter-evidence.tar.gz',
     'bytes':28752166,'sha256':'78c74bee9021a9e9b36d89309632066575076a01426ed1e72c6981d8cd3023e0',
     'manifest':'evidence-index.json','payloads':318,'regular':319},
    {'path':'/workspace/.playtest/bootstrap-solid-memo-bounded600d-evidence.tar.gz',
     'bytes':6789108,'sha256':'ad1732d4ee7825ced003e76d262187e96f664c99d8a17bafb6cbb703da6f7788',
     'manifest':'INDEX.json','payloads':12,'regular':13},
]
care_cache_results = [verify(spec) for spec in care_cache_specs]
care_cache_entries = [
    entry(care_cache_results[0], 'ceedc2f13a0dd2986db3a26089855dd1866660f1; base9119feec',
        'Care native-arrival/pursuit filter, unchanged rule/owner/triage. Three real short pairs plus actual3AI same10200input tails: baseline26107p1win, candidate43714p0win/enemy0. Not ordinary0 or holdout; skips early7905effects. New samples restore old3bdb/5f trajectories, not demonstrated beyond5f.7905patient1079 alive18HP on both;1322also changes.65tests/tsc and static JS-identical sim type narrowing separately recorded.'),
    entry(care_cache_results[1], '600d67cb049f11f7a94f22735d8a2d50757ef4b2; pure native memo on19ef6d0d',
        'Exact solid byHull memo FIFO128 eviction; miss recomputes original Minkowski result, no routing cap/fallback/AI/rule change.160heading eviction/recompute geometry and real40350postcommand..40351 uncached fullworld/id fixture,24tests/tsc1024. Earlier compiler512OOM remains separate. d251 delivery manifest is not600d AI source; a26941255 hybrid win and old0f44441 are not600d ordinary0 results.'),
]
final_results = results + deck_results + care_cache_results
final_additions = additions + deck_entries + care_cache_entries
all_names = [p['file'] for p in old['packages']] + [p['file'] for p in final_additions]
if len(set(all_names)) != 67:
    raise ValueError('Duplicate package filename in67proposal')
rendered67 = ',\n'.join('\n'.join('    ' + line for line in json.dumps(p, ensure_ascii=False, indent=2).splitlines()) for p in final_additions)
candidate67 = text[:insert_at] + ',\n' + rendered67 + '\n  ' + text[close:]
new67 = unique_json(candidate67)
if new67['packages'][:59] != old['packages'] or len(new67['packages']) != 67:
    raise ValueError('Old59 values changed in67proposal')
if {k:v for k,v in old.items() if k != 'packages'} != {k:v for k,v in new67.items() if k != 'packages'}:
    raise ValueError('Production/strategy metadata changed in67proposal')
if candidate67[:insert_at] != text[:insert_at] or not candidate67.endswith(text[close:]):
    raise ValueError('Old59 text or metadata suffix changed in67proposal')
(OUT/'bootstrap-complete-games-20261015-index.67.candidate.json').write_text(candidate67)
dump('additions-8.verified.json',final_additions)
dump('archive-verification.json', {'classification': 'Independent streaming decompression and SHA/byte/coverage validation; no extraction, archive copies, repack, tests or simulation.', 'final8':final_results})
current_index = REPO / INDEX_PATH
audit = {'createdAtUtc': datetime.now(timezone.utc).isoformat(), 'baseDocsCommit': BASE,
    'rootHeadObservedBefore': observed_head_before, 'rootHeadObservedAfter': git('rev-parse','HEAD').decode().strip(),
    'originalCanonicalIndexPath': INDEX_PATH, 'oldIndexSHA256': sha(old_bytes),
    'rootCanonicalIndexStillEqualsPinned5968': current_index.read_bytes() == old_bytes,
    'activeCandidate':'bootstrap-complete-games-20261015-index.67.candidate.json',
    'candidateIndexSHA256': sha(candidate67.encode()), 'oldPackages':59, 'newPackages':67,
    'interim63CandidateRetainedAsPreparationOnly':'bootstrap-complete-games-20261015-index.63.candidate.json',
    'old59EntriesEachValueUnchanged': new67['packages'][:59] == old['packages'],
    'originalTextBeforeInsertionAndMetadataSuffixVerbatim': candidate67[:insert_at] == text[:insert_at] and candidate67.endswith(text[close:]),
    'allOtherIndexMetadataUnchanged': True, 'strategyBaselineRetained': old['strategyBaseline'],
    'productionHeadRetainedPendingParentFinalSource': old['productionHead'], 'finalCombinedProductionHeadProvided':False,
    'productionOrdinary0AttributionUnchanged': new67['productionOrdinary0'] == old['productionOrdinary0'],
    'actualMainArchiveBytes':sum(r['bytes'] for r in final_results), 'mainPayloadsVerified':sum(r['payloads'] for r in final_results),
    'main4AllDeclaredPayloadBytesVerified': all(r['allPayloadBytesDeclaredAndVerified'] for r in results),
    'allMainRegularsExactlyCovered':all(r['allRegularMembersExactlyCovered'] for r in final_results),
    'deckAndCacheByteNote':'The two deck and one cache INDEX files declare SHA only. Every payload SHA and observed byte count versus tar header was verified; do not claim originally declared per-payload byte fields exist.',
    'noRootWritesStagesCommitsOrCopies':True,'noNativeOrTests':True,'old59ArchivesNotRepackedOrReverifiedInThisBatch':True,
    'archives':[{k:v for k,v in r.items() if k!='payloadInventory'}for r in final_results],
    'originalUncommittedWorkspaceRecoveryGapRetained':True}
dump('next-evidence-index-20261016.json', audit)
print(json.dumps({k:v for k,v in audit.items() if k not in ['archives','optionalDeckArchives']},ensure_ascii=False))
