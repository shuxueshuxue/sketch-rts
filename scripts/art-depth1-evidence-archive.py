#!/usr/bin/env python3
"""Lossless depth1 evidence storage; no diagnostic result is rewritten.

Write/verify sidecar gzip files for all real inputs, keep PNG/Markdown untouched,
reuse the pinned original-Git source container, and restore original repo-relative
filenames. Only --prune removes fully verified unchanged untracked raw inputs.
This tool is intended to run after every capture/comparison has stopped.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile

REPO = Path(__file__).resolve().parent.parent
BASE_REL = 'docs/art/refactor/followup/card-streaming/stall-followup/depth1-scratch'
BASE = REPO / BASE_REL
ROOT_SCOPE = 'root'
RUN_FOLDERS = ('native-original-v1', 'native-original-v2', 'native-candidate-v2',
               'frame-abba/A1', 'frame-abba/B1', 'frame-abba/B2', 'frame-abba/A2',
               'native-compare-v2')
FOLDERS = (*RUN_FOLDERS, ROOT_SCOPE)
COMMIT = '42bd61c74934dc76f30d42b62e1e31eb5c5974ff'
SOURCE_SET = '99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0'
SOURCE_FILE = 'docs/art/refactor/followup/source-archives/' + SOURCE_SET + '.tar.gz'
SOURCE_GZIP_SHA = '4367770df4b0e80693571cd930574bda73701e91a04bb8e9b779863637e26ec2'
SOURCE_GZIP_BYTES, SOURCE_COUNT, SOURCE_BYTES = 2221603, 1125, 9687156
LIMIT = 90 * 1024 * 1024
SOURCE_DIRECTORY = 'complete-source-snapshot'
COMPARATOR_KEYS = {'scriptSha256': 'scripts/art-card-upload-depth1-compare.mjs',
                   'analyzerSha256': 'scripts/art-card-upload-depth1-frame-compare.mjs'}
SOURCE_FIELDS = ('expectedCommit', 'sourceSnapshots', 'sourceSha256',
                 'finalSourceSha256', 'gitSourceBlobSha1', 'sourcePublicTree',
                 'sourceStayedFrozen', 'uploaderOverride')
STATUS_FIELDS = ('completed', 'failure', 'validation', 'browserTeardownComplete')


def folder_root(folder):
    require(folder in FOLDERS, 'Unknown fixed scope')
    return BASE if folder == ROOT_SCOPE else BASE / folder


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def no_links(path):
    require(not any(p.is_symlink() for p in (path, *path.parents)),
            'Symlink path refused: ' + str(path))


def regular(path):
    no_links(path)
    require(path.is_file(), 'Missing/nonregular file: ' + str(path))


def digest(path):
    regular(path)
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(name):
    require(isinstance(name, str) and name and '\\' not in name, 'Invalid relative path')
    value = PurePosixPath(name)
    require(bool(value.parts) and not value.is_absolute() and '..' not in value.parts and '.' not in value.parts
            and value.as_posix() == name, 'Unsafe relative path: ' + name)
    return value


def member_path(name, folder):
    safe(name)
    prefix = folder_root(folder).relative_to(REPO).as_posix() + '/'
    require(name.startswith(prefix) and not name.startswith(prefix + 'archives/'),
            'Member outside fixed capture scope: ' + name)
    if folder == ROOT_SCOPE:
        local = name[len(prefix):]
        require('/' not in local or local.startswith('executed-comparison-scripts/'),
                'Root input cannot overlap a run folder: ' + name)
    return REPO / name


def write_json(path, value):
    no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as output:
        json.dump(value, output, indent=2); output.write('\n')


def set_sha(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True,
                         separators=(',', ':')).encode()).hexdigest()


def git_blobs():
    records = subprocess.check_output(['git', 'ls-tree', '-rz', COMMIT, 'src'], cwd=REPO)
    result = {}
    for record in records.split(b'\0'):
        if not record:
            continue
        head, name = record.decode().split('\t', 1)
        mode, kind, blob = head.split(); safe(name)
        require(kind == 'blob' and mode in ('100644', '100755'), 'Unsupported Git source entry')
        result[name] = blob
    require(len(result) == SOURCE_COUNT, 'Pinned Git source count differs')
    return result


def source_bytes_ok(data, entry, blobs):
    require(len(data) == entry['size'] and hashlib.sha256(data).hexdigest() == entry['sha256'],
            'Original source size/SHA differs: ' + entry['name'])
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    require(actual == blobs.get(entry['name']), 'Original source Git blob differs: ' + entry['name'])


def canonical_source(blobs):
    path = REPO / SOURCE_FILE; regular(path)
    require(path.stat().st_size == SOURCE_GZIP_BYTES and digest(path) == SOURCE_GZIP_SHA,
            'Existing canonical source container identity differs; no replacement is created')
    files, payloads = [], {}
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        require([m.name for m in members] == sorted(blobs), 'Canonical tar member order/set differs')
        for member in members:
            safe(member.name)
            require(member.isfile() and not member.issym() and not member.islnk(),
                    'Nonregular canonical source member')
            stream = archive.extractfile(member); require(stream is not None, 'Unreadable source member')
            data = stream.read(); entry = dict(name=member.name, size=len(data),
                                               sha256=hashlib.sha256(data).hexdigest())
            require(member.size == len(data), 'Canonical tar member size differs')
            source_bytes_ok(data, entry, blobs)
            files.append(entry); payloads[entry['name']] = data
    require(len(files) == SOURCE_COUNT and sum(f['size'] for f in files) == SOURCE_BYTES
            and set_sha(files) == SOURCE_SET, 'Canonical original source set differs')
    return files, payloads


def inspect_tree(root):
    no_links(root); require(root.is_dir(), 'Missing capture folder: ' + str(root))
    files = []
    for path in sorted(root.rglob('*'), key=lambda p: p.relative_to(root).as_posix()):
        no_links(path)
        require(path.is_file() or path.is_dir(), 'Special capture member: ' + str(path))
        if path.is_file():
            files.append(path)
    return files


def scope_files(folder):
    """The root scope owns only root files and its comparator snapshots."""
    root = folder_root(folder)
    if folder != ROOT_SCOPE:
        return inspect_tree(root)
    no_links(root); require(root.is_dir(), 'Missing evidence root')
    files = []
    children = {PurePosixPath(name).parts[0] for name in RUN_FOLDERS}
    for path in sorted(root.iterdir(), key=lambda p: p.relative_to(root).as_posix()):
        no_links(path)
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            if path.name in ('archives',):
                continue
            if path.name == 'executed-comparison-scripts':
                files.extend(inspect_tree(path))
            else:
                require(path.name in children, 'Unassigned evidence directory: ' + str(path))
                if path.name == 'frame-abba':
                    require({p.name for p in path.iterdir()} == {'A1', 'B1', 'B2', 'A2'},
                            'Unassigned frame-abba member')
                    for child in path.iterdir():
                        no_links(child); require(child.is_dir(), 'Non-directory frame arm')
        else:
            raise RuntimeError('Special evidence root member: ' + str(path))
    return sorted(files, key=lambda p: p.relative_to(root).as_posix())


def source_fields(proof, pointer):
    if pointer == '/sourceInventory':
        inventory = proof.get('sourceInventory')
    elif pointer == '/uploadIsolation/sourceInventory':
        inventory = proof.get('uploadIsolation', {}).get('sourceInventory')
    else:
        raise RuntimeError('Unsupported source inventory JSON pointer')
    require(isinstance(inventory, dict), 'Missing recorded source inventory')
    return {key: inventory[key] for key in SOURCE_FIELDS if key in inventory}


def validate_source_fields(fields, canonical, blobs):
    require(fields.get('expectedCommit') == COMMIT, 'Recorded source epoch differs')
    if 'sourceSha256' in fields:
        require(fields['sourceSha256'] == {name: row['sha256'] for name, row in canonical.items()},
                'Recorded original source SHA map differs from pinned Git bytes')
    if 'gitSourceBlobSha1' in fields:
        require(fields['gitSourceBlobSha1'] == blobs, 'Recorded source Git map differs')
    rows = fields.get('sourceSnapshots', [])
    require(isinstance(rows, list), 'Invalid source snapshot list')
    names = [row.get('relativePath') for row in rows]
    require(len(names) == len(set(names)), 'Duplicate recorded original source snapshot')
    for row in rows:
        name = row.get('relativePath'); safe(name)
        require(name in canonical and row.get('snapshot') == SOURCE_DIRECTORY + '/' + name
                and row.get('sha256') == canonical[name]['sha256'],
                'Recorded source snapshot row differs')


def source_inventory_records(folder, canonical, blobs):
    root = folder_root(folder); records = []
    for name in ('proof.json', 'raw.json'):
        path = root / name
        if not path.exists():
            continue
        regular(path); data = path.read_bytes(); proof = json.loads(data)
        inventory = proof.get('sourceInventory')
        pointer = '/sourceInventory'
        if inventory is None and isinstance(proof.get('uploadIsolation'), dict):
            inventory = proof['uploadIsolation'].get('sourceInventory')
            pointer = '/uploadIsolation/sourceInventory'
        if inventory is None:
            continue
        require(isinstance(inventory, dict), 'Invalid recorded source inventory')
        captured = source_fields(proof, pointer)
        validate_source_fields(captured, canonical, blobs)
        records.append(dict(proofPath=path.relative_to(REPO).as_posix(), bytes=len(data),
                            sha256=hashlib.sha256(data).hexdigest(), jsonPointer=pointer,
                            originalFields=captured,
                            originalStatus={key: proof[key] for key in STATUS_FIELDS if key in proof}))
    return records


def inspect_source(folder, canonical, blobs):
    root = folder_root(folder) / SOURCE_DIRECTORY; no_links(root)
    present = root.exists(); captured = []
    if present:
        allowed_directories = {parent.as_posix() for name in canonical
                               for parent in PurePosixPath(name).parents if parent.as_posix() != '.'}
        for path in root.rglob('*'):
            no_links(path)
            if path.is_dir():
                require(path.relative_to(root).as_posix() in allowed_directories,
                        'Unexpected original source directory: ' + str(path))
        for path in inspect_tree(root):
            name = path.relative_to(root).as_posix(); safe(name)
            require(name in canonical, 'Unexpected/non-Git file in original source directory')
            source_bytes_ok(path.read_bytes(), canonical[name], blobs)
            captured.append(canonical[name])
    captured.sort(key=lambda row: row['name'])
    status = ('missing' if not present else 'empty' if not captured else
              'complete' if len(captured) == SOURCE_COUNT else 'partial')
    return dict(path=root.relative_to(REPO).as_posix(), originallyPresent=present,
                status=status, capturedFiles=captured, capturedCount=len(captured),
                capturedBytes=sum(row['size'] for row in captured), capturedFileSetSha256=set_sha(captured),
                meaning='Restore only actual captured members; the full reusable Git container does not imply a partial/missing run captured all files.')


def freeze_comparators(folder):
    key = ('scriptSha256' if folder == 'native-compare-v2' else
           'analyzerSha256' if folder == ROOT_SCOPE else None)
    if key is None:
        return []
    root = folder_root(folder); recorded = []
    # Raw difference rows can contain millions of assertions. Their complete bytes
    # are streamed into gzip; only the actual small comparator report needs parsing.
    path = root / ('summary.json' if folder == 'native-compare-v2' else 'frame-compare-v1.json')
    regular(path); value = json.loads(path.read_bytes())
    require(isinstance(value, dict) and isinstance(value.get(key), str)
            and re.fullmatch('[0-9a-f]{64}', value[key]), 'Actual comparator report/script SHA is required')
    recorded.append(dict(report=path.relative_to(REPO).as_posix(), reportSha256=digest(path),
                         key=key, script=COMPARATOR_KEYS[key], sha256=value[key]))
    existing = [path for path in scope_files(folder) if path.suffix == '.mjs']
    for row in recorded:
        expected = row['sha256']; matching = [path for path in existing if digest(path) == expected]
        if matching:
            snapshot = matching[0]
        else:
            script = REPO / row['script']; regular(script)
            require(digest(script) == expected, 'Current comparator differs from actual recorded script; provide the original snapshot')
            snapshot = root / 'executed-comparison-scripts' / (expected + '.mjs')
            no_links(snapshot); snapshot.parent.mkdir(parents=True, exist_ok=True)
            with script.open('rb') as source, snapshot.open('xb') as target:
                shutil.copyfileobj(source, target)
            require(digest(snapshot) == expected, 'Comparison script snapshot differs')
            existing.append(snapshot)
        row['snapshot'] = snapshot.relative_to(REPO).as_posix()
    return recorded


def input_paths(folder, source):
    root = folder_root(folder); excluded = {source['path'] + '/' + row['name'] for row in source['capturedFiles']}
    result, kept = [], []
    for path in scope_files(folder):
        relative = path.relative_to(root)
        if relative.parts[0] == 'archives':
            continue
        name = path.relative_to(REPO).as_posix()
        if name in excluded:
            continue
        # Named source-snapshot/*.ts provider files and executed-candidate.ts
        # are inputs. Never exclude them just because their directory says source.
        member_path(name, folder)
        (kept if path.suffix.lower() in ('.png', '.md') else result).append(path)
    # Path compares filesystem components, which can disagree with the canonical
    # relative POSIX strings used by the archive manifests and verifier.
    return (sorted(result, key=lambda p: p.relative_to(REPO).as_posix()),
            sorted(kept, key=lambda p: p.relative_to(REPO).as_posix()))


def decode_input(row, output=None):
    path = REPO / row['gzipPath']; regular(path)
    checksum = hashlib.sha256(); size = 0
    with gzip.open(path, 'rb') as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            checksum.update(chunk); size += len(chunk)
            if output is not None:
                output.write(chunk)
    require(size == row['bytes'] and checksum.hexdigest() == row['sha256'],
            'Complete decoded input size/SHA differs: ' + row['path'])


def decoded_json(row):
    # Called only after the complete stored/decoded byte identities were checked.
    with gzip.open(REPO / row['gzipPath'], 'rb') as stream:
        return json.load(stream)


def pack_input(path, folder, tracked):
    regular(path); name = path.relative_to(REPO).as_posix(); member_path(name, folder)
    original_sha, size = digest(path), path.stat().st_size
    packed = path.with_name(path.name + '.gz'); no_links(packed)
    require(not packed.exists(), 'Exclusive gzip output already exists: ' + str(packed))
    with path.open('rb') as source, packed.open('xb') as raw, gzip.GzipFile(
            filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as output:
        shutil.copyfileobj(source, output, length=1024 * 1024)
    row = dict(path=name, bytes=size, sha256=original_sha, gzipPath=name + '.gz',
               gzipBytes=packed.stat().st_size, gzipSha256=digest(packed), originallyTracked=name in tracked)
    require(row['gzipBytes'] < LIMIT, 'Gzip exceeds 90 MiB; no original removed')
    decode_input(row)
    require(path.stat().st_size == size and digest(path) == original_sha, 'Input changed during compression')
    return row


def manifests(folder):
    directory = folder_root(folder) / 'archives'
    return directory / 'input-archives.json', directory / 'source-archives.json'


def archive_folder(folder, canonical, blobs, tracked):
    input_manifest, source_manifest = manifests(folder)
    require(not input_manifest.exists() and not source_manifest.exists(), 'Archive manifest exists; use --verify')
    source = inspect_source(folder, canonical, blobs)
    inventories = source_inventory_records(folder, canonical, blobs)
    require(folder in (ROOT_SCOPE, 'native-compare-v2') or inventories,
            'Actual capture source inventory is required')
    comparisons = freeze_comparators(folder)
    paths, kept = input_paths(folder, source)
    require(paths, 'No actual inputs in fixed folder')
    rows = [pack_input(path, folder, tracked) for path in paths]
    source_record = dict(version=1, folder=folder, toolSha256=digest(Path(__file__)), sourceCommit=COMMIT,
        archive=dict(path=SOURCE_FILE, bytes=SOURCE_GZIP_BYTES, sha256=SOURCE_GZIP_SHA,
                     fullOriginalFileSetSha256=SOURCE_SET, files=SOURCE_COUNT, decodedBytes=SOURCE_BYTES),
        directory=source, recordedSourceInventories=inventories,
        meaning='Original Git source bytes only; candidate/provider executed bytes are independent input members. Missing/partial original capture is not promoted to complete.')
    input_record = dict(version=1, folder=folder, toolSha256=digest(Path(__file__)), files=rows,
        keptFiles=[dict(path=path.relative_to(REPO).as_posix(), bytes=path.stat().st_size,
                        sha256=digest(path), reason='Uncompressed PNG or human Markdown') for path in kept],
        sourceManifest=source_manifest.relative_to(REPO).as_posix(),
        comparisonScripts=comparisons,
        meaning='Exact actual output/helper/runtime/optimizer/provider bytes. Original failure and result fields remain unchanged. PNG/Markdown and manifests are not compressed.')
    write_json(source_manifest, source_record); write_json(input_manifest, input_record)
    return input_record, source_record


def validate_folder(inputs, source, folder, canonical, blobs):
    require(inputs['version'] == source['version'] == 1 and inputs['folder'] == source['folder'] == folder,
            'Manifest scope/version differs')
    require(inputs['sourceManifest'] == manifests(folder)[1].relative_to(REPO).as_posix(),
            'Original source manifest link differs')
    require(inputs['toolSha256'] == source['toolSha256']
            and re.fullmatch('[0-9a-f]{64}', inputs['toolSha256']), 'Recorded archive tool identity differs')
    expected_archive = dict(path=SOURCE_FILE, bytes=SOURCE_GZIP_BYTES, sha256=SOURCE_GZIP_SHA,
                           fullOriginalFileSetSha256=SOURCE_SET, files=SOURCE_COUNT, decodedBytes=SOURCE_BYTES)
    require(source['archive'] == expected_archive and source['sourceCommit'] == COMMIT,
            'Source archive identity differs')
    directory = source['directory']
    expected_path = (folder_root(folder) / SOURCE_DIRECTORY).relative_to(REPO).as_posix()
    require(directory['path'] == expected_path, 'Source restore directory changed')
    members = directory['capturedFiles']
    require([row['name'] for row in members] == sorted({row['name'] for row in members}), 'Source member set/order differs')
    for row in members:
        safe(row['name']); require(row == canonical.get(row['name']), 'Source member is not pinned original Git')
    require(directory['capturedCount'] == len(members) and directory['capturedBytes'] == sum(row['size'] for row in members)
            and directory['capturedFileSetSha256'] == set_sha(members), 'Captured source subset differs')
    require(isinstance(directory['originallyPresent'], bool), 'Invalid original source directory presence')
    expected_status = ('missing' if not directory['originallyPresent'] else 'empty' if not members else
                       'complete' if len(members) == SOURCE_COUNT else 'partial')
    require(directory['status'] == expected_status and (directory['originallyPresent'] or not members),
            'Original source presence/status differs from the captured subset')
    existing_source = REPO / directory['path']; no_links(existing_source)
    if existing_source.exists():
        actual = inspect_source(folder, canonical, blobs)
        require(directory['originallyPresent'] and actual['capturedFiles'] == members,
                'Present original source members differ from the actual captured set')
    require([row['path'] for row in inputs['files']] == sorted({row['path'] for row in inputs['files']}), 'Input member set/order differs')
    for row in inputs['files']:
        member_path(row['path'], folder); path = member_path(row['gzipPath'], folder)
        require(row['gzipPath'] == row['path'] + '.gz', 'Gzip path is not original filename sidecar')
        regular(path); require(path.stat().st_size == row['gzipBytes'] < LIMIT and digest(path) == row['gzipSha256'],
                               'Stored gzip bytes/SHA differ')
        decode_input(row)
        raw = REPO / row['path']
        if raw.exists():
            regular(raw); require(raw.stat().st_size == row['bytes'] and digest(raw) == row['sha256'], 'Present raw input differs')
    input_by_path = {row['path']: row for row in inputs['files']}
    kept = inputs['keptFiles']
    require([row['path'] for row in kept] == sorted({row['path'] for row in kept}), 'Kept file set/order differs')
    for row in kept:
        path = member_path(row['path'], folder); regular(path)
        require(path.suffix.lower() in ('.png', '.md') and path.stat().st_size == row['bytes']
                and digest(path) == row['sha256'], 'Uncompressed protected file differs')
        require(row['path'] not in input_by_path, 'Input/protected file scopes overlap')
    expected_paths = set(input_by_path) | {row['gzipPath'] for row in inputs['files']} | {
        row['path'] for row in kept} | {directory['path'] + '/' + row['name'] for row in members}
    for path in scope_files(folder):
        relative = path.relative_to(folder_root(folder))
        if relative.parts[0] != 'archives':
            require(path.relative_to(REPO).as_posix() in expected_paths,
                    'Unrecorded evidence file: ' + str(path))
    for record in source['recordedSourceInventories']:
        member_path(record['proofPath'], folder)
        row = next((row for row in inputs['files'] if row['path'] == record['proofPath']), None)
        require(row is not None and row['sha256'] == record['sha256'] and row['bytes'] == record['bytes'], 'Original source inventory proof identity differs')
        proof = decoded_json(row)
        fields = source_fields(proof, record['jsonPointer'])
        require(record['originalFields'] == fields and record['originalStatus'] == {
            key: proof[key] for key in STATUS_FIELDS if key in proof},
            'Manifest original inventory/status differs from exact decoded proof')
        validate_source_fields(fields, canonical, blobs)
    require(folder in (ROOT_SCOPE, 'native-compare-v2') or source['recordedSourceInventories'],
            'Actual capture source inventory record is required')
    expected_compare_key = ('scriptSha256' if folder == 'native-compare-v2' else
                            'analyzerSha256' if folder == ROOT_SCOPE else None)
    require(bool(inputs['comparisonScripts']) == (expected_compare_key is not None),
            'Comparison script scope differs')
    for record in inputs['comparisonScripts']:
        require(record['snapshot'] in input_by_path and input_by_path[record['snapshot']]['sha256'] == record['sha256'],
                'Executed comparison snapshot differs from recorded hash')
        require(record['report'] in input_by_path and input_by_path[record['report']]['sha256'] == record['reportSha256'],
                'Original comparison report differs')
        report = decoded_json(input_by_path[record['report']])
        require(record['key'] == expected_compare_key
                and record['script'] == COMPARATOR_KEYS[record['key']]
                and report.get(record['key']) == record['sha256'],
                'Executed comparison snapshot is not bound to the actual decoded report')


def restore_file(path, expected_size, expected_sha, write):
    no_links(path)
    if path.exists():
        regular(path); require(path.stat().st_size == expected_size and digest(path) == expected_sha,
                               'Refuse changed restore target: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as output:
            write(output)
        require(path.stat().st_size == expected_size and digest(path) == expected_sha, 'Restored exact bytes differ')


def copy_file(source, destination, size, sha):
    def write(output):
        with source.open('rb') as stream:
            shutil.copyfileobj(stream, output, length=1024 * 1024)
    restore_file(destination, size, sha, write)


def remove_empty_source_directories(directory):
    root = REPO / directory['path']; no_links(root)
    if not root.exists():
        return
    for path in sorted(root.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        no_links(path); require(path.is_dir(), 'Unexpected file remains in source directory before removal')
        path.rmdir()
    root.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive', action='store_true'); mode.add_argument('--verify', action='store_true')
    mode.add_argument('--materialize', action='store_true')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--folder', action='append', choices=FOLDERS,
                        help='Fixed run scope; root owns root logs/providers and frame comparator. Default: all scopes.')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    require(not args.prune or args.archive or args.verify, '--prune requires --archive or --verify')
    require(not args.out or args.materialize, '--out only applies to --materialize')
    folders = tuple(args.folder) if args.folder else FOLDERS
    require(len(folders) == len(set(folders)), 'Duplicate folder scope')
    blobs = git_blobs(); files, payloads = canonical_source(blobs)
    canonical = {row['name']: row for row in files}
    tracked = {p.decode() for p in subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).split(b'\0') if p}
    if args.archive:
        # Reject a previously archived scope before creating any new sidecars.
        for folder in folders:
            ip, sp = manifests(folder)
            no_links(ip); no_links(sp)
            require(not ip.exists() and not sp.exists(), 'Archive manifest exists; use --verify')
            scope_files(folder)
    loaded = []
    for folder in folders:
        if args.archive:
            inputs, source = archive_folder(folder, canonical, blobs, tracked)
        else:
            ip, sp = manifests(folder); regular(ip); regular(sp)
            inputs, source = json.loads(ip.read_bytes()), json.loads(sp.read_bytes())
        validate_folder(inputs, source, folder, canonical, blobs)
        loaded.append((folder, inputs, source))
    destination = args.out.absolute() if args.out else REPO
    if args.materialize:
        no_links(destination)
        if args.out:
            destination.mkdir(parents=True, exist_ok=False)
        for folder, inputs, source in loaded:
            for row in inputs['files']:
                restore_file(destination / row['path'], row['bytes'], row['sha256'], lambda out, row=row: decode_input(row, out))
            for row in inputs['keptFiles']:
                copy_file(REPO / row['path'], destination / row['path'], row['bytes'], row['sha256'])
            directory = source['directory']
            if directory['originallyPresent']:
                source_destination = destination / directory['path']; no_links(source_destination)
                source_destination.mkdir(parents=True, exist_ok=True)
            for row in directory['capturedFiles']:
                restore_file(destination / directory['path'] / row['name'], row['size'], row['sha256'],
                             lambda out, row=row: out.write(payloads[row['name']]))
            if args.out:
                for manifest in manifests(folder):
                    copy_file(manifest, destination / manifest.relative_to(REPO), manifest.stat().st_size, digest(manifest))
        if args.out:
            # Also preserve the single pinned reusable source container in the independent tree.
            copy_file(REPO / SOURCE_FILE, destination / SOURCE_FILE, SOURCE_GZIP_BYTES, SOURCE_GZIP_SHA)
    deleted = 0
    if args.prune:
        # Full preflight before any deletion. No git add/rm/staging is performed.
        prune = []
        for folder, inputs, source in loaded:
            directory = source['directory']
            require(directory['status'] != 'partial', 'Refuse source prune for a partial original capture')
            for row in inputs['files']:
                path = REPO / row['path']; regular(path)
                require(row['path'] not in tracked and path.stat().st_size == row['bytes'] and digest(path) == row['sha256'],
                        'Refuse tracked/changed input prune: ' + row['path'])
                prune.append((path, row['bytes'], row['sha256']))
            for row in directory['capturedFiles']:
                path = REPO / directory['path'] / row['name']; regular(path)
                name = path.relative_to(REPO).as_posix()
                require(name not in tracked and path.stat().st_size == row['size'] and digest(path) == row['sha256'],
                        'Refuse tracked/changed source prune: ' + name)
                source_bytes_ok(path.read_bytes(), row, blobs); prune.append((path, row['size'], row['sha256']))
        for path, size, sha in prune:
            regular(path); require(path.stat().st_size == size and digest(path) == sha, 'File changed before prune')
            path.unlink(); deleted += 1
        for _, _, source in loaded:
            remove_empty_source_directories(source['directory'])
    summary = dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
        folders=list(folders), verifiedInputs=sum(len(i['files']) for _, i, _ in loaded),
        verifiedUncompressedFiles=sum(len(i['keptFiles']) for _, i, _ in loaded),
        sourceMembers=sum(s['directory']['capturedCount'] for _, _, s in loaded),
        originalInputBytes=sum(row['bytes'] for _, i, _ in loaded for row in i['files']),
        gzipInputBytes=sum(row['gzipBytes'] for _, i, _ in loaded for row in i['files']),
        sourceContainerReused=SOURCE_FILE, sourceContainerSha256=SOURCE_GZIP_SHA,
        deletedOriginalFiles=deleted, toolSha256=digest(Path(__file__)), restoredRoot=str(destination) if args.materialize else None,
        sourceShaSizeGitAndEveryInputDecodedShaSizeVerified=True,
        originalDiagnosticStatusesUnchanged=True, productionAndGitIndexNotModified=True)
    if args.report:
        write_json(args.report.absolute(), summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    main()
