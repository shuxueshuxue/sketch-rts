#!/usr/bin/env python3
"""Byte-exact latency evidence organization, never rendering or image decoding.

--plan reads only small published headers and file metadata, without hashing.
--archive [--prune] verifies full preservation before deleting expanded copies.
--verify checks envelopes, containers, entries, sources, and present payloads.
--materialize restores original paths, or payloads only under --out.
Do not execute archive/verify/materialize during CPU/GPU measurement windows.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / 'docs/art/refactor/followup/card-streaming/latency-investigation'
STORE = BASE / 'evidence-archives'
ENVELOPE = 'evidence-archive.json'
LIMIT = 90 * 1024 * 1024
CHUNK = 1024 * 1024
TARGETS = {'trace-current': 'trace', 'canvas-attribution': 'rgba'}
for family in ('peak-abba', 'mask-abba', 'rle-abba', 'rle-twohit-abba', 'upload-abba'):
    arms = ('original-A', 'production-B', 'production-B2', 'original-A2') if family in ('peak-abba', 'mask-abba') else ('original-A', 'candidate-B', 'candidate-B2', 'original-A2')
    for arm in arms:
        TARGETS[f'{family}/{arm}'] = 'png'

for family in ('rle-budget-pilot', 'rle-budget-abba', 'rle-budget-canonical-abba'):
    arms = ('original-A', 'candidate-B') if family == 'rle-budget-pilot' else ('original-A', 'candidate-B', 'candidate-B2', 'original-A2')
    for arm in arms:
        TARGETS[f'{family}/{arm}'] = 'png'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def relative_name(name):
    require(isinstance(name, str) and name and '\\' not in name, 'Invalid relative name')
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(part not in ('', '.', '..') for part in name.split('/')), 'Unsafe relative name: ' + name)
    return path


def location(root, name):
    path = root.joinpath(*relative_name(name).parts)
    current = root
    require(not current.is_symlink(), 'Symlink root refused: ' + str(root))
    for part in relative_name(name).parts:
        current = current / part
        require(not current.is_symlink(), 'Symlink path refused: ' + str(current))
    return path


def regular(path):
    require(not path.is_symlink() and path.is_file(), 'Not a regular file: ' + str(path))


def consume(stream, sink=None):
    digest = hashlib.sha256()
    size = 0
    while block := stream.read(CHUNK):
        digest.update(block)
        size += len(block)
        if sink is not None:
            sink.write(block)
    return size, digest.hexdigest()


def file_record(path):
    regular(path)
    with open(path, 'rb') as stream:
        size, sha = consume(stream)
    return {'size': size, 'sha256': sha}


def sha_ok(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()


def file_set_sha(files):
    return hashlib.sha256(canonical([{key: f[key] for key in ('name', 'size', 'sha256')} for f in files])).hexdigest()


def publish(temporary, final):
    # link creates the final name atomically and never replaces an existing file.
    os.link(temporary, final)
    temporary.unlink()


def publish_json(final, value):
    fd, name = tempfile.mkstemp(prefix='.' + final.name + '.', suffix='.tmp', dir=final.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        publish(temporary, final)
    finally:
        if temporary.exists():
            temporary.unlink()


def load_json(path):
    regular(path)
    return json.loads(path.read_bytes())


def payload_spec(target, kind):
    directory = location(BASE, target)
    files = []
    if kind == 'trace':
        proof = load_json(directory / 'raw.json')
        raw, zipped = proof['trace']['raw'], proof['trace']['gzip']
        require(proof.get('completed') is True and raw.get('complete') is True, 'Trace is not complete/frozen')
        require(raw['file'] == 'trace.json' and zipped['file'] == 'trace.json.gz', 'Unexpected trace paths')
        require(sha_ok(raw['sha256']) and sha_ok(zipped['sha256']), 'Trace published SHA missing')
        files = [{'name': raw['file'], 'size': raw['bytes'], 'sha256': raw['sha256'], 'keep': False}]
    elif kind == 'rgba':
        proof = load_json(directory / 'proof.json')
        require(proof.get('completed') is True, 'Canvas attribution proof is not complete/frozen')
        source = load_json(directory / 'corpus-manifest.json')
        require(source.get('format') == 'RGBA8' and source.get('completeSourceDomain') is True and source.get('rowOrientation') == 'top-down', 'Not a complete original RGBA corpus')
        require(len(source['images']) == 36, 'Expected the authorized 36 original samples')
        for image in source['images']:
            name = str(relative_name(image['file']))
            require(name.startswith('corpus/') and name.endswith('.rgba.bin'), 'Unexpected corpus path')
            require(image['width'] in (512, 704) and image['height'] == image['sourceSize'] == image['width'], 'Unexpected original RGBA domain')
            require(sha_ok(image['sha256']) and image.get('byteLength', image['width'] * image['height'] * 4) == image['width'] * image['height'] * 4, 'Original RGBA published SHA/byte length mismatch')
            files.append({'name': name, 'size': image['width'] * image['height'] * 4, 'sha256': image['sha256'], 'keep': False})
    else:
        proof = load_json(directory / 'raw.json')
        require(proof.get('completed') is True, 'Formal run is not complete/frozen; pass/fail is not changed by archiving')
        for cycle in proof['cycles']:
            for record in cycle['screenshots'].values():
                name = str(relative_name(record['path']))
                require(name.endswith('.png') and sha_ok(record['sha256']), 'Original encoded PNG SHA missing')
                files.append({'name': name, 'size': None, 'sha256': record['sha256'], 'keep': target == 'mask-abba/original-A' and name.endswith('cycle-0-battlefield.png')})
    files.sort(key=lambda item: item['name'])
    require(files and len({f['name'] for f in files}) == len(files), 'Duplicate/empty original payload set')
    return files


def sources(directory):
    # Preserve original metadata and helper bytes in place. Reports/README are
    # intentionally not frozen here; trace.json is the payload, not a header.
    result = []
    paths = list(directory.iterdir())
    snapshots = directory / 'source-snapshot'
    if snapshots.exists():
        require(not snapshots.is_symlink() and snapshots.is_dir(), 'Unsafe source snapshot directory')
        paths.extend(snapshots.rglob('*'))
    for path in sorted(paths):
        if path.name not in (ENVELOPE, 'trace.json') and path.suffix in ('.json', '.js', '.mjs', '.ts'):
            name = str(path.relative_to(directory).as_posix())
            result.append({'name': name, **file_record(location(directory, name))})
    require(result, 'No source/proof/header files found')
    return result


def observed_files(target, kind, expected):
    directory = location(BASE, target)
    actual_names = {str(path.relative_to(directory).as_posix()) for path in
                    (directory.glob('corpus/*.rgba.bin') if kind == 'rgba' else directory.rglob('*.png') if kind == 'png' else [directory / 'trace.json'])}
    require(actual_names == {f['name'] for f in expected}, 'Initial expanded payload set differs from published complete set: ' + target)
    result = []
    for entry in expected:
        actual = file_record(location(directory, entry['name']))
        require(actual['sha256'] == entry['sha256'] and (entry['size'] is None or actual['size'] == entry['size']), 'Original payload mismatch: ' + entry['name'])
        result.append({**entry, **actual})
    return result


def check_sources(manifest):
    directory = location(BASE, manifest['target'])
    for entry in manifest['sources']:
        relative_name(entry['name'])
        require(file_record(location(directory, entry['name'])) == {key: entry[key] for key in ('size', 'sha256')}, 'Original source/header/helper changed: ' + entry['name'])


def check_envelope(manifest):
    target, kind = manifest['target'], manifest['kind']
    require(manifest['version'] == 1 and TARGETS.get(target) == kind, 'Envelope target/version mismatch')
    files = manifest['files']
    require([f['name'] for f in files] == sorted({f['name'] for f in files}), 'Envelope file order/duplicates')
    require(file_set_sha(files) == manifest['fileSetSha256'], 'Envelope complete file-set SHA mismatch')
    expected = payload_spec(target, kind)
    require(len(expected) == len(files), 'Published complete file set changed')
    for actual, published in zip(files, expected):
        require(actual['name'] == published['name'] and actual['sha256'] == published['sha256'] and actual['keep'] == published['keep'] and (published['size'] is None or actual['size'] == published['size']), 'Envelope differs from published proof: ' + actual['name'])
        require(isinstance(actual['size'], int) and actual['size'] >= 0, 'Invalid original byte length')
    check_sources(manifest)
    archive = manifest['archive']
    location(BASE, archive['file'])
    if kind == 'trace':
        proof = load_json(location(BASE, target) / 'raw.json')['trace']['gzip']
        require(archive['file'] == target + '/' + proof['file'] and archive['size'] == proof['bytes'] and archive['sha256'] == proof['sha256'] and archive['format'] == 'gzip', 'Original trace gzip metadata changed')
    elif kind == 'png':
        require(archive['file'].startswith('evidence-archives/png-blobs-') and archive['format'] == 'png-blobs.tar.gz', 'Unexpected shared PNG container')
        members = archive['members']
        require([f['name'] for f in members] == sorted({f['name'] for f in members}), 'Blob order/duplicates')
        by_sha = {f['sha256']: f for f in members}
        require(len(by_sha) == len(members), 'Duplicate encoded blobs')
        for member in members:
            require(member['name'] == member['sha256'] + '.png' and sha_ok(member['sha256']) and isinstance(member['size'], int) and member['size'] > 0, 'Blob name/SHA/size mismatch')
        require(archive['file'] == 'evidence-archives/png-blobs-' + file_set_sha(members)[:16] + '.tar.gz', 'Blob-set/container identity mismatch')
        for entry in files:
            require(entry['sha256'] in by_sha and by_sha[entry['sha256']]['size'] == entry['size'], 'Original path does not map to exact encoded blob')
    else:
        require(archive['file'].startswith('evidence-archives/') and archive['format'] == 'tar.gz', 'Unexpected container path/format')


def present_files(manifest, allow_missing=True):
    directory = location(BASE, manifest['target'])
    result = []
    for entry in manifest['files']:
        path = location(directory, entry['name'])
        if path.exists():
            require(file_record(path) == {key: entry[key] for key in ('size', 'sha256')}, 'Expanded payload changed: ' + str(path))
            result.append((path, entry))
        else:
            require(allow_missing and not entry['keep'], 'Required expanded payload is missing: ' + str(path))
    return result


def stored_members(manifest, callback):
    archive = location(BASE, manifest['archive']['file'])
    if manifest['kind'] == 'trace':
        with gzip.open(archive, 'rb') as stream:
            callback(manifest['files'][0], stream)
    else:
        # Manual regular-file streaming, never extractall or image decoding.
        entries = manifest['archive'].get('members', manifest['files'])
        with tarfile.open(archive, 'r|gz') as tar:
            count = 0
            for member in tar:
                require(count < len(entries), 'Extra archive member')
                entry = entries[count]
                require(member.name == entry['name'] and member.isfile() and not member.issym() and not member.islnk() and not member.pax_headers and member.size == entry['size'], 'Unsafe/different archive member: ' + member.name)
                relative_name(member.name)
                with tar.extractfile(member) as stream:
                    callback(entry, stream)
                count += 1
            require(count == len(entries), 'Missing archive member')


def verify_container(manifest):
    archive = location(BASE, manifest['archive']['file'])
    require(file_record(archive) == {key: manifest['archive'][key] for key in ('size', 'sha256')}, 'Compressed container mismatch')
    if manifest['kind'] != 'trace':
        require(archive.stat().st_size < LIMIT, 'Container exceeds strict 90 MiB limit')
    def verify(entry, stream):
        size, sha = consume(stream)
        require(size == entry['size'] and sha == entry['sha256'], 'Stored original bytes mismatch: ' + entry['name'])
    stored_members(manifest, verify)


def create_tar(target, files, archive):
    STORE.mkdir(exist_ok=True)
    if archive.exists():
        return False  # A later full verification must still prove exact reuse.
    fd, name = tempfile.mkstemp(prefix='.latency-archive-', suffix='.tmp', dir=STORE)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as zipped, tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as tar:
            for entry in files:
                info = tarfile.TarInfo(entry['name'])
                info.size = entry['size']; info.mode = 0o644; info.mtime = 0; info.uid = info.gid = 0
                if 'sourceArchive' in entry:
                    # A verified old blob container can supply bytes when its
                    # expanded originals have already been pruned. No decode.
                    with tarfile.open(location(BASE, entry['sourceArchive']), 'r:gz') as previous:
                        member = previous.getmember(entry['name'])
                        require(member.isfile() and not member.issym() and not member.islnk() and not member.pax_headers and member.size == entry['size'], 'Unsafe previous encoded blob')
                        with previous.extractfile(member) as stream:
                            tar.addfile(info, stream)
                else:
                    original = location(location(BASE, entry.get('sourceTarget', target)), entry.get('sourceName', entry['name']))
                    with open(original, 'rb') as stream:
                        tar.addfile(info, stream)
        require(temporary.stat().st_size < LIMIT, 'New container exceeds strict 90 MiB limit; no source removed')
        # Complete member verification precedes publication, so a failed copy
        # cannot leave a bad final container blocking a retry.
        temporary_manifest = {'kind': 'rgba', 'files': files,
                              'archive': {'file': str(temporary.relative_to(BASE).as_posix()), **file_record(temporary), 'format': 'tar.gz'}}
        verify_container(temporary_manifest)
        publish(temporary, archive)
        return True
    finally:
        if temporary.exists():
            temporary.unlink()


def png_pool(targets):
    blobs = {}
    for target in targets:
        existing = location(BASE, target) / ENVELOPE
        if existing.exists():
            manifest = load_json(existing)
            if manifest['archive']['format'] == 'png-blobs.tar.gz':
                check_envelope(manifest); verify_container(manifest)
                for entry in manifest['archive']['members']:
                    previous = blobs.setdefault(entry['sha256'], {**entry, 'sourceArchive': manifest['archive']['file']})
                    require(previous['size'] == entry['size'], 'Encoded SHA aliases a different byte length')
                continue
        for entry in observed_files(target, 'png', payload_spec(target, 'png')):
            previous = blobs.setdefault(entry['sha256'], {'name': entry['sha256'] + '.png', 'size': entry['size'], 'sha256': entry['sha256'], 'sourceTarget': target, 'sourceName': entry['name']})
            require(previous['size'] == entry['size'], 'Encoded SHA aliases a different byte length')
    entries = sorted(blobs.values(), key=lambda entry: entry['name'])
    clean = [{key: f[key] for key in ('name', 'size', 'sha256')} for f in entries]
    file = STORE / ('png-blobs-' + file_set_sha(clean)[:16] + '.tar.gz')
    # Existing content-addressed containers are verified before reuse. Newly
    # appearing payloads need present source paths; never invent pixel aliases.
    if not file.exists():
        require(all('sourceTarget' in f or 'sourceArchive' in f for f in entries), 'Verified encoded payload source is missing')
    created = create_tar('', entries, file)
    archive = {'file': str(file.relative_to(BASE).as_posix()), **file_record(file), 'format': 'png-blobs.tar.gz', 'members': clean}
    verify_container({'kind': 'png', 'files': clean, 'archive': archive})
    return archive, created


def replace_own_envelope(path, value, previous):
    # Only our newly generated archive envelope is replaceable; never a raw,
    # proof, original corpus manifest, or source helper.
    require(path.name == ENVELOPE and file_record(path) == previous, 'Archive envelope changed before migration')
    fd, name = tempfile.mkstemp(prefix='.' + ENVELOPE + '.', suffix='.tmp', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        require(file_record(path) == previous, 'Archive envelope changed during migration')
        os.replace(temporary, path)
    finally:
        if temporary.exists(): temporary.unlink()


def prepare(target, kind, pool=None):
    directory = location(BASE, target)
    envelope = directory / ENVELOPE
    if envelope.exists():
        manifest = load_json(envelope)
        if kind != 'png' or manifest['archive']['format'] == 'png-blobs.tar.gz':
            check_envelope(manifest); verify_container(manifest); present_files(manifest)
            return manifest, False
        # Authorized migration of our provisional per-run tar envelopes. All
        # original PNGs still have to exist and match their published SHA.
        previous = file_record(envelope)
        check_sources(manifest); verify_container(manifest); present_files(manifest, allow_missing=False)
        superseded = manifest.get('supersededArchives', []) + [manifest['archive']]
    else:
        previous = None
        superseded = []
    files = observed_files(target, kind, payload_spec(target, kind))
    source_records = sources(directory)
    set_sha = file_set_sha(files)
    created = False
    if kind == 'trace':
        published = load_json(directory / 'raw.json')['trace']['gzip']
        archive = {'file': target + '/' + published['file'], 'size': published['bytes'], 'sha256': published['sha256'], 'format': 'gzip'}
    elif kind == 'png':
        require(pool is not None, 'Shared PNG pool missing')
        archive = pool
    else:
        filename = kind + '-' + target.replace('/', '-') + '-' + set_sha[:16] + '.tar.gz'
        file = STORE / filename
        created = create_tar(target, files, file)
        archive = {'file': str(file.relative_to(BASE).as_posix()), **file_record(file), 'format': 'tar.gz'}
    manifest = {'version': 1, 'target': target, 'kind': kind, 'fileSetSha256': set_sha,
                'fileSetHashDefinition': 'SHA256 compact sorted-key JSON of sorted {name,size,sha256}; original encoded bytes.',
                'sources': source_records, 'files': files, 'archive': archive,
                'meaning': 'Evidence storage only. Original JSON/RGBA/PNG bytes recover exactly; original proofs/helpers/results unchanged, including failures. Expanded payloads may be absent after verified prune.'}
    if superseded:
        manifest['supersededArchives'] = superseded
    check_envelope(manifest); verify_container(manifest); present_files(manifest, allow_missing=False)
    if previous is None: publish_json(envelope, manifest)
    else: replace_own_envelope(envelope, manifest, previous)
    return manifest, created


def retire_superseded(manifests):
    # Only containers named in our migrated envelopes qualify. Never glob and
    # delete unrelated archives, original gzip, or proof/helper files.
    references = set()
    for target in TARGETS:
        envelope = location(BASE, target) / ENVELOPE
        if envelope.exists():
            references.add(load_json(envelope)['archive']['file'])
    retired = []
    for manifest in manifests:
        for archive in manifest.get('supersededArchives', []):
            name = archive['file']
            expected = 'evidence-archives/png-' + manifest['target'].replace('/', '-') + '-' + manifest['fileSetSha256'][:16] + '.tar.gz'
            require(manifest['kind'] == 'png' and name == expected and archive['format'] == 'tar.gz', 'Not an owned provisional PNG container')
            require(name not in references, 'Provisional container is still referenced by an envelope')
            path = location(BASE, name)
            if path.exists():
                verify_container({'kind': 'png', 'files': manifest['files'], 'archive': archive})
                retired.append((path, archive))
    # Full verification precedes any unlink, including provisional containers.
    for path, archive in retired:
        require(file_record(path) == {key: archive[key] for key in ('size', 'sha256')}, 'Provisional container changed before removal')
        path.unlink()
    return len(retired), sum(archive['size'] for _, archive in retired)


def restore(manifest, destination):
    # Preflight all targets before any publication; resumed equal files are safe.
    destination.mkdir(parents=True, exist_ok=True)
    for entry in manifest['files']:
        path = location(destination, entry['name'])
        if path.exists():
            require(file_record(path) == {key: entry[key] for key in ('size', 'sha256')}, 'Refuse to overwrite changed restore target: ' + str(path))
    restored = 0
    def write(entry, stream):
        nonlocal restored
        final = location(destination, entry['name'])
        if final.exists():
            size, sha = consume(stream)
            require(size == entry['size'] and sha == entry['sha256'], 'Stored bytes changed during restore')
            return
        final.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.' + final.name + '.', suffix='.tmp', dir=final.parent)
        temporary = Path(name)
        try:
            with os.fdopen(fd, 'wb') as sink:
                size, sha = consume(stream, sink)
                sink.flush(); os.fsync(sink.fileno())
            require(size == entry['size'] and sha == entry['sha256'], 'Restore SHA mismatch: ' + entry['name'])
            publish(temporary, final); restored += 1
        finally:
            if temporary.exists():
                temporary.unlink()
    if manifest['archive']['format'] == 'png-blobs.tar.gz':
        def expand(blob, stream):
            with tempfile.TemporaryFile() as saved:
                size, sha = consume(stream, saved)
                require(size == blob['size'] and sha == blob['sha256'], 'Encoded blob changed during restore')
                for entry in manifest['files']:
                    if entry['sha256'] == blob['sha256']:
                        saved.seek(0); write(entry, saved)
        stored_members(manifest, expand)
    else:
        stored_members(manifest, write)
    for entry in manifest['files']:
        require(file_record(location(destination, entry['name'])) == {key: entry[key] for key in ('size', 'sha256')}, 'Restored final bytes mismatch')
    return restored


def select(args):
    if args.folder:
        prefix = 'docs/art/refactor/followup/card-streaming/latency-investigation/'
        target = args.folder.removeprefix(prefix).rstrip('/')
        require(target in TARGETS and (args.kind == 'all' or TARGETS[target] == args.kind), 'Folder is outside the authorized latency whitelist')
        require(location(BASE, target).is_dir(), 'Requested target does not exist')
        return [target], []
    selected = [target for target, kind in TARGETS.items() if args.kind in ('all', kind)]
    return [t for t in selected if location(BASE, t).is_dir()], [t for t in selected if not location(BASE, t).is_dir()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('plan', 'archive', 'verify', 'materialize'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--kind', choices=('all', 'trace', 'rgba', 'png'), default='all')
    parser.add_argument('--folder', help='One exact authorized target relative to latency-investigation or repo')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--out', type=Path, help='Payload-only restore destination; existing matching files may resume')
    args = parser.parse_args()
    require(not args.prune or args.archive, '--prune requires --archive')
    require(not args.out or args.materialize and args.folder, '--out requires --materialize --folder')
    targets, missing = select(args)
    require(targets, 'No authorized targets found')
    if args.plan:
        plans = []
        for target in targets:
            try:
                entries = payload_spec(target, TARGETS[target])
                envelope = location(BASE, target) / ENVELOPE
                recorded = {f['name']: f for f in load_json(envelope)['files']} if envelope.exists() else {}
                sizes = []
                for entry in entries:
                    size = entry['size']
                    if size is None and entry['name'] in recorded:
                        original = recorded[entry['name']]
                        require(original['sha256'] == entry['sha256'], 'Published/archived PNG identity changed')
                        size = original['size']
                    sizes.append(size if size is not None else location(location(BASE, target), entry['name']).stat().st_size)
                plans.append({'target': target, 'kind': TARGETS[target], 'ready': True, 'files': len(entries),
                              'publishedBytes': sum(sizes), 'envelopeExists': envelope.exists()})
            except Exception as error:
                plans.append({'target': target, 'ready': False, 'reason': str(error)})
        print(json.dumps({'operation': 'plan', 'noPayloadHashingCompressionOrDecoding': True, 'targets': plans, 'missingTargets': missing}, indent=2))
        return
    manifests, created_bytes, pool = [], 0, None
    if args.archive:
        png_targets = [target for target in targets if TARGETS[target] == 'png']
        if png_targets:
            pool, created = png_pool(png_targets)
            if created: created_bytes += pool['size']
    for target in targets:
        if args.archive:
            manifest, created = prepare(target, TARGETS[target], pool)
            if created:
                created_bytes += manifest['archive']['size']
        else:
            manifest = load_json(location(BASE, target) / ENVELOPE)
            check_envelope(manifest); verify_container(manifest); present_files(manifest)
        manifests.append(manifest)
    # No first unlink occurs until all targets/containers/envelopes have passed.
    deleted_files = deleted_bytes = restored_files = retired_files = retired_bytes = 0
    if args.prune:
        remaining = []
        for manifest in manifests:
            check_envelope(manifest); verify_container(manifest)
            remaining.extend((path, entry) for path, entry in present_files(manifest) if not entry['keep'])
        for path, entry in remaining:
            require(file_record(path) == {key: entry[key] for key in ('size', 'sha256')}, 'Payload changed before unlink')
            path.unlink(); deleted_files += 1; deleted_bytes += entry['size']
        retired_files, retired_bytes = retire_superseded(manifests)
    if args.materialize:
        for manifest in manifests:
            destination = args.out.resolve() if args.out else location(BASE, manifest['target'])
            restored_files += restore(manifest, destination)
    print(json.dumps({'operation': 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
                      'verifiedTargets': [m['target'] for m in manifests], 'missingTargets': missing,
                      'originalFiles': sum(len(m['files']) for m in manifests), 'originalBytes': sum(sum(f['size'] for f in m['files']) for m in manifests),
                      'newContainerBytes': created_bytes, 'deletedExpandedFiles': deleted_files, 'deletedExpandedBytes': deleted_bytes,
                      'retiredOwnProvisionalContainers': retired_files, 'retiredOwnProvisionalContainerBytes': retired_bytes,
                      'newPayloadNetBytesSaved': deleted_bytes - created_bytes, 'restoredFiles': restored_files,
                      'meaning': 'Repository evidence storage only, not game RAM/VRAM or rendering-performance savings.'}, indent=2))


if __name__ == '__main__':
    main()
