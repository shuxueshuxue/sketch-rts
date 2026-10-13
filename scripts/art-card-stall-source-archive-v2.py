#!/usr/bin/env python3
"""Exact archives for four fixed, completed upload v2 pilot source snapshots.

--archive creates and verifies containers/manifests, retaining all originals.
--verify checks original capture documents, containers and every extracted byte.
--materialize [--folder RUN] restores original source-snapshot paths; existing
files must match. --prune is explicit and accepted with --archive or --verify.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / 'docs/art/refactor/followup/card-streaming/stall-followup'
STORE = REPO / 'docs/art/refactor/followup/source-archives'
RUNS = (
    'row-band-pilot-v2/original-A',
    'row-band-pilot-v2/candidate-B',
    'ring512-pilot-v2/original-A',
    'ring512-pilot-v2/candidate-B',
)
SNAPSHOT = 'complete-source-snapshot'
COMMIT = '8345a0dcfeb96b6777ac3940ec64cba13816c851'
EXPECTED_SET = '468839ab37bee10734865f09d6364d9e04d2efa0e501ce97da8b2cc21ed53736'
LIMIT = 90 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(name):
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts
            and '.' not in path.parts and path.as_posix() == name, 'Unsafe path: ' + name)
    return path


def regular(path, root):
    require(path.is_file() and not path.is_symlink(), 'Nonregular file: ' + str(path))
    require(not any(p.is_symlink() for p in [path.parent, *path.parents]
                    if p == root or root in p.parents), 'Symlink parent: ' + str(path))


def set_digest(files):
    data = [{k: f[k] for k in ('name', 'size', 'sha256')} for f in files]
    encoded = json.dumps(data, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(encoded).hexdigest()


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def capture_maps(run, files):
    path = BASE / run / 'raw.json'
    raw = json.loads(path.read_text())
    require(raw['sourceCommit'] == COMMIT, 'Wrong source epoch: ' + run)
    info = raw.get('uploadIsolation', {}).get('sourceInventory')
    require(isinstance(info, dict), 'Missing capture provenance: ' + run)
    start = info.get('sourceSha256')
    expected = {f['name']: f['sha256'] for f in files}
    require(start == expected, 'Original capture source map differs: ' + run)
    require(info.get('finalSourceSha256') == expected, 'Final source map differs: ' + run)
    require(info.get('sourceStayedFrozen') is True, 'Capture source freeze failed: ' + run)
    require(raw.get('completed') is True, 'Capture incomplete: ' + run)
    snapshots = info.get('sourceSnapshots')
    require(isinstance(snapshots, list) and len(snapshots) == len(files), 'Source snapshot inventory size')
    mapped = {}
    for row in snapshots:
        name = row['relativePath']
        safe(name)
        require(name not in mapped and row['snapshot'] == SNAPSHOT + '/' + name, 'Source snapshot inventory path')
        mapped[name] = row['sha256']
    require(mapped == expected, 'Original snapshot inventory differs: ' + run)


def check_present(manifest, allow_missing):
    root = BASE / manifest['run'] / SNAPSHOT
    expected_names = {f['name'] for f in manifest['files']}
    present = set()
    if root.exists():
        require(not root.is_symlink(), 'Symlink snapshot root')
        for path in root.rglob('*'):
            require(not path.is_symlink(), 'Symlink snapshot member')
            if path.is_file():
                present.add(path.relative_to(root).as_posix())
        require(present <= expected_names, 'Unexpected snapshot members')
    for f in manifest['files']:
        path = root / f['name']
        if path.exists():
            regular(path, root)
            require(path.stat().st_size == f['size'] and digest(path) == f['sha256'],
                    'Present bytes differ: ' + str(path))
        else:
            require(allow_missing, 'Missing original: ' + str(path))


def validate(manifest, run):
    require(manifest['version'] == 2 and manifest['run'] == run and run in RUNS, 'Manifest run/version')
    require(manifest['target'] == (BASE / run / SNAPSHOT).relative_to(REPO).as_posix(), 'Target path')
    files = manifest['files']
    require([f['name'] for f in files] == sorted({f['name'] for f in files}), 'Member order/set')
    for f in files:
        safe(f['name'])
        require(isinstance(f['size'], int) and f['size'] >= 0, 'Bad size')
        require(len(f['sha256']) == 64 and all(c in '0123456789abcdef' for c in f['sha256']), 'Bad SHA')
    require(len(files) == 1120 and sum(f['size'] for f in files) == 9651718, 'Frozen file count/size')
    require(set_digest(files) == manifest['fileSetSha256'] == EXPECTED_SET, 'File-set SHA')
    require(manifest['archive']['file'] == EXPECTED_SET + '.tar.gz', 'Container name')
    for source in manifest['sources']:
        safe(source['name'])
        path = BASE / run / source['name']
        regular(path, BASE / run)
        require(digest(path) == source['sha256'], 'Original document changed: ' + str(path))
    capture_maps(run, files)


def extract_verified(manifest, destination):
    archive = STORE / manifest['archive']['file']
    regular(archive, STORE)
    require(archive.stat().st_size == manifest['archive']['bytes'] < LIMIT, 'Archive size')
    require(digest(archive) == manifest['archive']['sha256'], 'Archive SHA')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        require([m.name for m in members] == [f['name'] for f in manifest['files']], 'Tar member set/order')
        for member, f in zip(members, manifest['files']):
            safe(member.name)
            require(member.isfile() and not member.issym() and not member.islnk()
                    and member.size == f['size'], 'Tar member type/size')
            path = destination / f['name']
            path.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as src, path.open('xb') as dst:
                shutil.copyfileobj(src, dst)
            require(digest(path) == f['sha256'], 'Extracted bytes differ: ' + f['name'])


def build(run):
    root = BASE / run / SNAPSHOT
    require(root.is_dir() and not root.is_symlink(), 'Missing/symlink snapshot: ' + run)
    files = []
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Symlink snapshot member')
        if path.is_file():
            regular(path, root)
            files.append(dict(name=path.relative_to(root).as_posix(), size=path.stat().st_size, sha256=digest(path)))
    files.sort(key=lambda f: f['name'])
    require(set_digest(files) == EXPECTED_SET, 'Frozen complete set mismatch: ' + run)
    sources = []
    directory = BASE / run
    # Raw provenance and all executable/provider root snapshots stay untouched.
    for path in sorted(directory.iterdir()):
        if path.is_file() and path.suffix in {'.json', '.js', '.mjs', '.ts', '.html'} and path.name not in {'trace.json', 'source-archive.json'}:
            regular(path, directory)
            sources.append(dict(name=path.name, sha256=digest(path)))
    for name in ('runtime-helper-snapshots', 'optimized-dependency-snapshots', 'source-snapshot'):
        for path in sorted((directory / name).rglob('*')):
            if path.is_file():
                regular(path, directory)
                sources.append(dict(name=path.relative_to(directory).as_posix(), sha256=digest(path)))
    capture_maps(run, files)
    archive = STORE / (EXPECTED_SET + '.tar.gz')
    if not archive.exists():
        temporary = archive.with_name(archive.name + '.tmp')
        with temporary.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as zipped, tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as tar:
            for f in files:
                info = tarfile.TarInfo(f['name'])
                info.size = f['size']; info.mode = 0o644; info.mtime = 0
                with (root / f['name']).open('rb') as stream:
                    tar.addfile(info, stream)
        require(temporary.stat().st_size < LIMIT, 'Archive too large; no original removed')
        require(not archive.exists(), 'Concurrent container creation')
        os.link(temporary, archive)
        temporary.unlink()
    return dict(version=2, run=run, target=root.relative_to(REPO).as_posix(),
                sourceCommit=COMMIT, fileSetSha256=EXPECTED_SET,
                fileSetHashDefinition='SHA256 of UTF-8 compact sorted-key JSON array of sorted {name,size,sha256}; exact original source bytes and relative paths.',
                archive=dict(file=archive.name, bytes=archive.stat().st_size, sha256=digest(archive)),
                sources=sources, files=files,
                meaning='Exact original source preservation only. Raw/helper/provider/metadata and failed capture status unchanged. Materialize restores original analyzer paths.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--archive', action='store_true')
    modes.add_argument('--verify', action='store_true')
    modes.add_argument('--materialize', action='store_true')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--folder', choices=RUNS)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    require(not args.prune or (args.archive or args.verify), '--prune requires --archive or --verify')
    require(not args.folder or not args.archive, '--archive always covers the four fixed completed pilot targets')
    require(not args.out or (args.materialize and args.folder), '--out needs --materialize --folder')
    runs = (args.folder,) if args.folder else RUNS
    if args.archive:
        require(all(not (BASE / run / 'source-archive.json').exists() for run in runs), 'Manifest already exists; use --verify')
        STORE.mkdir(parents=True, exist_ok=True)
    manifests = []
    for run in runs:
        manifest = build(run) if args.archive else json.loads((BASE / run / 'source-archive.json').read_text())
        validate(manifest, run)
        with tempfile.TemporaryDirectory(prefix='art-stall-source-verify-', dir='/tmp') as temp:
            extracted = Path(temp)
            extract_verified(manifest, extracted)
            check_present(manifest, allow_missing=not args.archive)
            if args.materialize:
                destination = args.out.resolve() if args.out else BASE / run / SNAPSHOT
                if args.out:
                    destination.mkdir(parents=True, exist_ok=False)
                require(not destination.is_symlink(), 'Symlink destination')
                for f in manifest['files']:
                    path = destination / f['name']
                    if path.exists():
                        regular(path, destination)
                        require(digest(path) == f['sha256'], 'Refuse overwrite: ' + str(path))
                for f in manifest['files']:
                    path = destination / f['name']
                    path.parent.mkdir(parents=True, exist_ok=True)
                    require(not any(p.is_symlink() for p in path.parents if p == destination or destination in p.parents), 'Symlink restore parent')
                    if not path.exists():
                        with (extracted / f['name']).open('rb') as src, path.open('xb') as dst:
                            shutil.copyfileobj(src, dst)
                    require(digest(path) == f['sha256'], 'Restored bytes differ')
        manifests.append(manifest)
        print('VERIFIED ' + run + ' files=' + str(len(manifest['files'])), flush=True)
    if args.archive:
        for manifest in manifests:
            write_json(BASE / manifest['run'] / 'source-archive.json', manifest)
    deleted = 0
    if args.prune:
        tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).decode().split('\0'))
        for manifest in manifests:
            validate(manifest, manifest['run']); check_present(manifest, allow_missing=False)
            for f in manifest['files']:
                path = BASE / manifest['run'] / SNAPSHOT / f['name']
                require(path.relative_to(REPO).as_posix() not in tracked, 'Refuse tracked prune')
        for manifest in manifests:
            for f in manifest['files']:
                path = BASE / manifest['run'] / SNAPSHOT / f['name']
                require(digest(path) == f['sha256'], 'Original changed before prune')
                path.unlink(); deleted += 1
    unique = {m['archive']['file']: m['archive'] for m in manifests}
    summary = dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
                   verifiedRuns=len(manifests), verifiedFiles=sum(len(m['files']) for m in manifests),
                   originalSourceBytes=sum(sum(f['size'] for f in m['files']) for m in manifests),
                   uniqueArchives=len(unique), archiveBytes=sum(a['bytes'] for a in unique.values()),
                   archives=list(unique.values()), deletedFiles=deleted,
                   allOriginalDocumentsAndExtractedFileShaVerified=True,
                   excludedActiveRuns='All runs outside the four fixed completed row-band/ring512 pilot targets, including any formal or native run.',
                   meaning='Byte preservation only; no rendering, benchmark or changed capture status.')
    if args.archive:
        write_json(STORE / 'stall-source-archive-v2-report.json', summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    main()
