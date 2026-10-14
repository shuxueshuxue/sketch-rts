#!/usr/bin/env python3
"""Lossless inputs for five fixed queue captures and their completed analysis.

PNG and both full-source snapshots are outside this input archive. Every other
captured input is streamed to an exact gzip sidecar, independently decoded and
verified before explicit pruning. Original failures and filenames remain intact.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / 'docs/art/refactor/followup/card-streaming/stall-followup'
STORE = BASE / 'queue-archives'
MANIFEST = STORE / 'input-archives.json'
RUNS = ('queue-bracket/control', 'queue-bracket-v2/control',
        'queue-bracket-v3/control', 'queue-bracket-v3/pre', 'queue-bracket-v3/pre-post')
ANALYSIS = 'queue-bracket-v3/analysis-strict-v3'
TOPS = ('queue-bracket', 'queue-bracket-v2', 'queue-bracket-v3')
LIMIT = 90 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(name):
    parts = PurePosixPath(name)
    require(not parts.is_absolute() and '..' not in parts.parts and parts.as_posix() == name,
            'Unsafe relative path')
    require(any(name.startswith(top + '/') for top in TOPS), 'Path outside fixed queue roots')


def regular(path, root):
    require(path.is_file() and not path.is_symlink(), 'Nonregular captured file')
    require(not any(p.is_symlink() for p in path.parents if p == root or root in p.parents), 'Symlink parent')


def write_json(path, value):
    with path.open('x') as out:
        json.dump(value, out, indent=2); out.write('\n')


def original_inputs():
    files = []
    for run in RUNS:
        directory = BASE / run
        require(directory.is_dir() and not directory.is_symlink(), 'Missing fixed capture')
        for path in directory.rglob('*'):
            if path.is_file():
                name = path.relative_to(directory)
                if name.parts[0] in ('source-snapshot', 'complete-source-snapshot'):
                    continue
                if path.suffix in ('.png', '.md', '.gz') or path.name.startswith('queue-source-archive'):
                    continue
                files.append(path)
    for path in (BASE / ANALYSIS).iterdir():
        if path.is_file() and path.suffix not in ('.md', '.gz'):
            files.append(path)
    for top in TOPS:
        files.extend(path for path in (BASE / top).iterdir()
                     if path.is_file() and path.suffix in ('.json', '.log'))
    result = sorted(set(files), key=lambda p: p.relative_to(BASE).as_posix())
    require(result and len(result) == len(files), 'Missing/duplicate capture input')
    return result


def validate(manifest):
    require(manifest['version'] == 1 and tuple(manifest['runs']) == RUNS and manifest['analysis'] == ANALYSIS, 'Manifest fixed scope')
    require([f['path'] for f in manifest['files']] == sorted({f['path'] for f in manifest['files']}), 'Manifest member order/set')
    for row in manifest['files']:
        safe(row['path']); safe(row['gzipPath'])
        require(row['gzipPath'] == row['path'] + '.gz', 'Sidecar path changed')
        packed = BASE / row['gzipPath']
        regular(packed, BASE)
        require(packed.stat().st_size == row['gzipBytes'] < LIMIT and digest(packed) == row['gzipSha256'], 'Packed bytes differ')
        original = BASE / row['path']
        if original.exists():
            regular(original, BASE)
            require(original.stat().st_size == row['bytes'] and digest(original) == row['sha256'], 'Original bytes differ')


def decoded_sha(row, destination=None):
    checksum = hashlib.sha256(); size = 0
    output = None
    if destination is not None:
        path = destination / row['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        require(not any(p.is_symlink() for p in path.parents if p == destination or destination in p.parents), 'Unsafe restore parent')
        output = path.open('xb')
    try:
        with gzip.open(BASE / row['gzipPath'], 'rb') as src:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                checksum.update(chunk); size += len(chunk)
                if output:
                    output.write(chunk)
    finally:
        if output:
            output.close()
    require(size == row['bytes'] and checksum.hexdigest() == row['sha256'], 'Decoded size/SHA differs')


def archive():
    require(not MANIFEST.exists(), 'Already archived; use --verify')
    STORE.mkdir(exist_ok=True)
    paths = original_inputs()
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).decode().split('\0'))
    files = []
    for index, original in enumerate(paths):
        regular(original, BASE)
        name = original.relative_to(BASE).as_posix(); safe(name)
        checksum = digest(original); size = original.stat().st_size
        packed = original.with_name(original.name + '.gz')
        require(not packed.exists(), 'Exclusive sidecar already exists')
        with packed.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as dst, original.open('rb') as src:
            shutil.copyfileobj(src, dst, length=1024 * 1024)
        require(packed.stat().st_size < LIMIT, 'Sidecar exceeds strict 90 MiB; no original removed')
        row = dict(path=name, bytes=size, sha256=checksum,
                   gzipPath=name + '.gz', gzipBytes=packed.stat().st_size, gzipSha256=digest(packed),
                   originallyTracked=original.relative_to(REPO).as_posix() in tracked)
        decoded_sha(row)
        require(digest(original) == checksum and original.stat().st_size == size, 'Original changed during compression')
        files.append(row)
        print('PACKED ' + str(index+1) + '/' + str(len(paths)) + ' ' + name + ' original=' + str(size) + ' gzip=' + str(row['gzipBytes']), flush=True)
    manifest = dict(version=1, runs=list(RUNS), analysis=ANALYSIS, toolSha256=digest(Path(__file__)),
                    sourceEpoch='42bd61c74934dc76f30d42b62e1e31eb5c5974ff', files=files,
                    meaning='Exact original capture input bytes/filenames retained, including failed v1/v2. Complete source snapshots archived separately. PNG and maintained scripts unchanged.')
    validate(manifest)
    write_json(MANIFEST, manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive', action='store_true')
    mode.add_argument('--verify', action='store_true')
    mode.add_argument('--materialize', action='store_true')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    require(not args.prune or args.archive or args.verify, '--prune requires --archive or --verify')
    require(not args.out or args.materialize, '--out needs --materialize')
    manifest = archive() if args.archive else json.loads(MANIFEST.read_text())
    validate(manifest)
    destination = args.out.resolve() if args.out else BASE
    if args.materialize and args.out:
        destination.mkdir(parents=True, exist_ok=False)
    if args.materialize:
        for row in manifest['files']:
            path = destination / row['path']
            if path.exists():
                regular(path, destination)
                require(path.stat().st_size == row['bytes'] and digest(path) == row['sha256'], 'Refuse changed restore target')
    for row in manifest['files']:
        if args.materialize and not (destination / row['path']).exists():
            decoded_sha(row, destination)
        else:
            decoded_sha(row)
        if args.materialize:
            require(digest(destination / row['path']) == row['sha256'], 'Restored bytes differ')
    deleted = 0
    if args.prune:
        validate(manifest)
        for row in manifest['files']:
            path = BASE / row['path']; regular(path, BASE)
            require(digest(path) == row['sha256'], 'Original changed before prune')
        tracked = set(subprocess.check_output(['git','ls-files','-z'],cwd=REPO).decode().split('\0'))
        names = [(BASE / row['path']).relative_to(REPO).as_posix() for row in manifest['files']]
        tracked_names = [name for name in names if name in tracked]
        if tracked_names:
            subprocess.run(['git','rm','--',*tracked_names],cwd=REPO,check=True)
        for row in manifest['files']:
            path = BASE / row['path']
            if path.exists():
                path.unlink()
            deleted += 1
    summary = dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
                   verifiedInputs=len(manifest['files']), originalBytes=sum(r['bytes'] for r in manifest['files']),
                   gzipBytes=sum(r['gzipBytes'] for r in manifest['files']),
                   largestGzipBytes=max(r['gzipBytes'] for r in manifest['files']),
                   originalOver100MB=sum(r['bytes'] >= 100000000 for r in manifest['files']),
                   decodedOriginalSizeAndShaVerified=True, deletedOriginals=deleted,
                   restoredInputs=len(manifest['files']) if args.materialize else 0,
                   toolSha256=digest(Path(__file__)), meaning='Evidence storage only, no changed source/capture/diagnostic conclusions.')
    if args.archive:
        write_json(STORE / 'input-archive-create-report.json', summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    main()
