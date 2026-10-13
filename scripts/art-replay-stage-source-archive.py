#!/usr/bin/env python3
"""Exact source archive for the fixed exact-upload-replay/stage-run-v3 diagnostic run.

--archive creates and verifies manifests/container; --prune explicitly removes
only unchanged untracked snapshot files. --verify needs the container and Git,
not original raw/helper artifacts. --materialize restores the original complete-source-snapshot
directory, or that directory beneath a new --out directory for one --folder.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / 'docs/art/refactor/followup/card-streaming/stall-followup'
STORE = REPO / 'docs/art/refactor/followup/source-archives'
RUNS = ('exact-upload-replay/stage-run-v3',)
DIRECTORIES = ('complete-source-snapshot',)
COMMIT = '42bd61c74934dc76f30d42b62e1e31eb5c5974ff'
EXPECTED_SET = '99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0'
COUNT, SOURCE_BYTES = 1125, 9687156
LIMIT = 90 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(name):
    path = PurePosixPath(name)
    require(isinstance(name, str) and name and not path.is_absolute()
            and '..' not in path.parts and '.' not in path.parts
            and path.as_posix() == name and '\\' not in name,
            'Unsafe relative path: ' + str(name))
    return path


def no_links(path):
    require(not any(p.is_symlink() for p in (path, *path.parents)),
            'Symlink path: ' + str(path))


def regular(path):
    no_links(path)
    require(path.is_file(), 'Missing/nonregular file: ' + str(path))


def write_json(path, value):
    no_links(path)
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def set_digest(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def git_blobs():
    tree = subprocess.check_output(['git', 'ls-tree', '-rz', COMMIT, 'src'], cwd=REPO)
    blobs = {}
    for record in tree.split(b'\0'):
        if not record:
            continue
        header, name = record.decode().split('\t', 1)
        mode, kind, sha = header.split()
        require(kind == 'blob' and mode in ('100644', '100755'), 'Unsupported Git source type')
        safe(name)
        blobs[name] = sha
    require(len(blobs) == COUNT, 'Git source count differs')
    return blobs


def check_bytes(data, entry, blobs):
    require(len(data) == entry['size'] and hashlib.sha256(data).hexdigest() == entry['sha256'],
            'Source size/SHA256 mismatch: ' + entry['name'])
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    require(blob == blobs.get(entry['name']), 'Git blob mismatch: ' + entry['name'])


def inventory(root, blobs):
    no_links(root)
    require(root.is_dir(), 'Missing snapshot: ' + str(root))
    files = []
    for path in sorted(root.rglob('*')):
        no_links(path)
        require(path.is_file() or path.is_dir(), 'Special snapshot member: ' + str(path))
        if path.is_file():
            name = path.relative_to(root).as_posix()
            safe(name)
            data = path.read_bytes()
            entry = dict(name=name, size=len(data), sha256=hashlib.sha256(data).hexdigest())
            check_bytes(data, entry, blobs)
            files.append(entry)
    files.sort(key=lambda entry: entry['name'])
    require(set(f['name'] for f in files) == set(blobs), 'Source/Git name set differs')
    require(len(files) == COUNT and sum(f['size'] for f in files) == SOURCE_BYTES,
            'Frozen source count/size differs')
    require(set_digest(files) == EXPECTED_SET, 'Frozen source set differs')
    return files


def validate(manifest, run, blobs):
    require(run in RUNS and manifest['version'] == 1 and manifest['run'] == run,
            'Manifest run/version differs')
    require(manifest['sourceCommit'] == COMMIT, 'Manifest source commit differs')
    targets = [(BASE / run / name).relative_to(REPO).as_posix() for name in DIRECTORIES]
    require(manifest['targets'] == targets, 'Manifest original target paths differ')
    files = manifest['files']
    require([f['name'] for f in files] == sorted(blobs), 'Manifest complete Git source names differ')
    for f in files:
        safe(f['name'])
        require(set(f) == {'name', 'size', 'sha256'} and type(f['size']) is int and f['size'] >= 0
                and re.fullmatch('[0-9a-f]{64}', f['sha256']), 'Invalid file entry')
    require(len(files) == COUNT and sum(f['size'] for f in files) == SOURCE_BYTES,
            'Manifest count/size differs')
    require(set_digest(files) == manifest['fileSetSha256'] == EXPECTED_SET,
            'Manifest canonical source set SHA differs')
    archive = manifest['archive']
    require(archive['file'] == EXPECTED_SET + '.tar.gz'
            and type(archive['bytes']) is int and 0 < archive['bytes'] < LIMIT
            and re.fullmatch('[0-9a-f]{64}', archive['sha256']), 'Invalid archive entry')
    require(manifest['sets'] == [dict(directory=name, files=COUNT, bytes=SOURCE_BYTES,
                                    fileSetSha256=EXPECTED_SET) for name in DIRECTORIES],
            'Manifest single source directory identity differs')


def check_present(manifest, allow_missing, blobs):
    for directory in DIRECTORIES:
        root = BASE / manifest['run'] / directory
        no_links(root)
        if not root.exists():
            require(allow_missing, 'Missing original snapshot: ' + str(root))
            continue
        expected = {f['name']: f for f in manifest['files']}
        present = set()
        for path in root.rglob('*'):
            no_links(path)
            require(path.is_file() or path.is_dir(), 'Special snapshot member')
            if path.is_file():
                name = path.relative_to(root).as_posix()
                require(name in expected, 'Unexpected original member: ' + str(path))
                check_bytes(path.read_bytes(), expected[name], blobs)
                present.add(name)
        require(allow_missing or present == set(expected), 'Original files missing: ' + str(root))


def extract_verified(manifest, destination, blobs):
    archive = STORE / manifest['archive']['file']
    regular(archive)
    require(archive.stat().st_size == manifest['archive']['bytes'] < LIMIT
            and digest(archive) == manifest['archive']['sha256'], 'Container size/SHA256 differs')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        require([m.name for m in members] == [f['name'] for f in manifest['files']],
                'Container member order/set differs')
        for member, entry in zip(members, manifest['files']):
            safe(member.name)
            require(member.isfile() and not member.issym() and not member.islnk()
                    and member.size == entry['size'], 'Container member type/size differs')
            data = tar.extractfile(member).read()
            check_bytes(data, entry, blobs)
            path = destination / entry['name']
            no_links(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                stream.write(data)


def archive_create(files):
    STORE.mkdir(parents=True, exist_ok=True)
    no_links(STORE)
    archive = STORE / (EXPECTED_SET + '.tar.gz')
    if not archive.exists():
        temporary = archive.with_name(archive.name + '.replay-stage.tmp')
        no_links(temporary)
        owned_temporary = False
        try:
            raw = temporary.open('xb')
            owned_temporary = True
            with raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw,
                    mtime=0, compresslevel=6) as zipped, tarfile.open(fileobj=zipped, mode='w',
                    format=tarfile.USTAR_FORMAT) as tar:
                for entry in files:
                    info = tarfile.TarInfo(entry['name'])
                    info.size = entry['size']; info.mode = 0o644; info.mtime = 0
                    with (BASE / RUNS[0] / DIRECTORIES[0] / entry['name']).open('rb') as stream:
                        tar.addfile(info, stream)
            require(temporary.stat().st_size < LIMIT, 'Archive exceeds 90MiB; originals retained')
            os.link(temporary, archive)
        finally:
            if owned_temporary and temporary.is_file() and not temporary.is_symlink():
                temporary.unlink()
    regular(archive)
    return dict(file=archive.name, bytes=archive.stat().st_size, sha256=digest(archive))


def materialize(manifest, extracted, destination, blobs):
    # Preflight every existing file before restoring the source directory.
    no_links(destination)
    for directory in DIRECTORIES:
        for entry in manifest['files']:
            path = destination / directory / entry['name']
            no_links(path)
            if path.exists():
                regular(path)
                check_bytes(path.read_bytes(), entry, blobs)
    for directory in DIRECTORIES:
        for entry in manifest['files']:
            path = destination / directory / entry['name']
            no_links(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                with (extracted / entry['name']).open('rb') as src, path.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
            check_bytes(path.read_bytes(), entry, blobs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--archive', action='store_true')
    modes.add_argument('--verify', action='store_true')
    modes.add_argument('--materialize', action='store_true')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--folder', choices=RUNS)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    require(not args.prune or args.archive or args.verify, '--prune needs --archive or --verify')
    require(not args.folder or not args.archive, '--archive covers all fixed targets')
    require(not args.out or args.materialize and args.folder, '--out needs --materialize --folder')
    runs = (args.folder,) if args.folder else RUNS
    blobs = git_blobs()
    manifests = []
    if args.archive:
        for run in runs:
            require(not (BASE / run / 'replay-stage-source-archive.json').exists(), 'Manifest exists; use --verify')
        inventories = [(run, directory, inventory(BASE / run / directory, blobs))
                       for run in runs for directory in DIRECTORIES]
        files = inventories[0][2]
        require(all(candidate == files for _, _, candidate in inventories),
                'Source sets differ; refusing shared archive/prune')
        archive = archive_create(files)
        for run in runs:
            manifests.append(dict(version=1, run=run, sourceCommit=COMMIT,
                targets=[(BASE / run / name).relative_to(REPO).as_posix() for name in DIRECTORIES],
                sets=[dict(directory=name, files=COUNT, bytes=SOURCE_BYTES,
                           fileSetSha256=EXPECTED_SET) for name in DIRECTORIES],
                fileSetSha256=EXPECTED_SET,
                fileSetHashDefinition='SHA256 of compact sorted-key UTF-8 JSON array of sorted {name,size,sha256}.',
                archive=archive, files=files,
                captureStatus='Original failed stage diagnostic result retained unchanged; source preservation does not establish capture success.',
                meaning='Exact source bytes/paths and specified Git blobs only; raw/helper/vendor inputs are independently preserved.'))
    else:
        for run in runs:
            path = BASE / run / 'replay-stage-source-archive.json'
            regular(path)
            manifests.append(json.loads(path.read_text()))
    for run, manifest in zip(runs, manifests):
        validate(manifest, run, blobs)
        check_present(manifest, allow_missing=not args.archive, blobs=blobs)
        with tempfile.TemporaryDirectory(prefix='replay-stage-source-verify-', dir='/tmp') as temp:
            extracted = Path(temp)
            extract_verified(manifest, extracted, blobs)
            if args.materialize:
                destination = args.out.absolute() if args.out else BASE / run
                no_links(destination)
                if args.out:
                    destination.mkdir(parents=True, exist_ok=False)
                materialize(manifest, extracted, destination, blobs)
        print('VERIFIED ' + run + ' sets=1 files=1125 bytes=9687156 sourceCommit=' + COMMIT, flush=True)
    if args.archive:
        for manifest in manifests:
            write_json(BASE / manifest['run'] / 'replay-stage-source-archive.json', manifest)
    deleted = 0
    if args.prune:
        tracked = {p.decode() for p in subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).split(b'\0') if p}
        for manifest in manifests:
            check_present(manifest, allow_missing=False, blobs=blobs)
            for directory in DIRECTORIES:
                for entry in manifest['files']:
                    path = BASE / manifest['run'] / directory / entry['name']
                    require(path.relative_to(REPO).as_posix() not in tracked, 'Refuse tracked source prune: ' + str(path))
        for manifest in manifests:
            for directory in DIRECTORIES:
                for entry in manifest['files']:
                    path = BASE / manifest['run'] / directory / entry['name']
                    regular(path)
                    check_bytes(path.read_bytes(), entry, blobs)
                    path.unlink(); deleted += 1
    archives = {m['archive']['file']: m['archive'] for m in manifests}
    summary = dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
        sourceCommit=COMMIT, executionScriptSha256=digest(Path(__file__)),
        verifiedRuns=len(manifests), verifiedSets=len(DIRECTORIES) * len(manifests),
        verifiedFiles=len(DIRECTORIES) * COUNT * len(manifests), originalSourceBytes=len(DIRECTORIES) * SOURCE_BYTES * len(manifests),
        uniqueArchives=len(archives), archiveBytes=sum(a['bytes'] for a in archives.values()),
        archives=list(archives.values()), fileSetSha256=EXPECTED_SET, deletedFiles=deleted,
        restoredFiles=len(DIRECTORIES) * COUNT * len(manifests) if args.materialize else 0,
        restoredRoot=str(args.out.absolute()) if args.out else None,
        everySourceFileSha256AndGitBlobVerified=True,
        rawHelperVendorFilesReadOrChanged=False,
        meaning='Source byte preservation only; failed runs retain original failure status.')
    report = args.report or (STORE / 'replay-stage-v3-source-archive-report.json' if args.archive else None)
    if report:
        write_json(report, summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    main()
