#!/usr/bin/env python3
"""Byte-exact captured evidence storage; v2 supports pruning restored mirrors.

Never changes test rules or original input bytes. --archive creates verified
gzip sidecars plus a manifest; --verify validates every decoded byte; explicit
--prune additionally removes the proven originals. --materialize restores each
original path, or its complete repo-relative path under a new --out directory.
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
PREFIX = 'docs/art/refactor/followup/card-streaming/stall-followup/'
REPORT = REPO / 'docs/art/refactor/followup/naming-gate'
MANIFEST = REPORT / 'artifact-archives.json'
OPTIMIZED = 'optimized-dependency-snapshots/26529ad0b0c5085e0505d5934eb3e2a1c38689b991de42ffba0b6560e40bdb4d.js'
TARGETS = tuple(sorted([
    PREFIX + 'current-trace/trace.json',
    PREFIX + 'current-gl-trace/trace.json',
    *[PREFIX + 'mip-half-camera/' + arm + '/' + name
      for arm in ('reference', 'candidate')
      for name in ('camera-harness.mjs', 'parent-camera-harness.mjs', 'proof.json')],
    *[PREFIX + 'mip-half-abba-v2/' + arm + '/' + OPTIMIZED
      for arm in ('production-A', 'candidate-B', 'candidate-B2', 'production-A2')],
    *[PREFIX + family + '/' + arm + '/' + OPTIMIZED
      for family in ('row-band-pilot-v2', 'ring512-pilot-v2')
      for arm in ('original-A', 'candidate-B')],
    *[PREFIX + family + '/analysis-strict/analysis.json'
      for family in ('row-band-pilot-v2', 'ring512-pilot-v2')],
]))
EXISTING_GZIP = {PREFIX + 'current-trace/trace.json', PREFIX + 'current-gl-trace/trace.json'}
LIMIT = 90 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(name):
    parts = PurePosixPath(name)
    require(name.startswith(PREFIX) and not parts.is_absolute()
            and '..' not in parts.parts and parts.as_posix() == name, 'Unsafe captured path')


def regular(path, root):
    require(path.is_file() and not path.is_symlink(), 'Nonregular file: ' + str(path))
    require(not any(p.is_symlink() for p in path.parents if p == root or root in p.parents), 'Symlink parent')


def write_json(path, value):
    with path.open('x') as out:
        json.dump(value, out, indent=2); out.write('\n')


def provenance():
    classification_path = REPORT / 'classification.json.gz'
    classification = json.loads(gzip.decompress(classification_path.read_bytes()))
    require(classification['sourceCommit'] == '42bd61c74934dc76f30d42b62e1e31eb5c5974ff', 'Wrong inspected epoch')
    require(classification['currentAddedToBaseline'] == list(TARGETS), 'Fixed input list differs from classification')
    expected = {row['path']: row for row in classification['details'] if row['path'] in TARGETS}
    require(len(expected) == 18, 'Expected eighteen capture inputs')
    documents = [dict(path=str((REPORT / name).relative_to(REPO)), sha256=digest(REPORT / name))
                 for name in ('classification.json.gz', 'current-single-test.log.gz', 'new-report-archives.json')]
    return classification, expected, documents


def create_manifest():
    require(not MANIFEST.exists(), 'Manifest exists; use --verify')
    _, expected, documents = provenance()
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).decode().split('\0'))
    files = []
    for name in TARGETS:
        safe(name)
        original = REPO / name
        regular(original, REPO)
        require(original.stat().st_size == expected[name]['bytes']
                and digest(original) == expected[name]['sha256'], 'Captured original changed: ' + name)
        packed = REPO / (name + '.gz')
        if name in EXISTING_GZIP:
            regular(packed, REPO)
        else:
            require(not packed.exists(), 'New gzip already exists: ' + name)
            with packed.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as out, original.open('rb') as src:
                shutil.copyfileobj(src, out)
        require(packed.stat().st_size < LIMIT, 'Container exceeds 90 MiB')
        files.append(dict(path=name, bytes=original.stat().st_size, sha256=expected[name]['sha256'],
                          category=expected[name]['category'], originallyTracked=name in tracked,
                          existingGzipRetained=name in EXISTING_GZIP,
                          gzipPath=name + '.gz', gzipBytes=packed.stat().st_size, gzipSha256=digest(packed)))
    return dict(version=1, fixedSourceEpoch='42bd61c74934dc76f30d42b62e1e31eb5c5974ff',
                toolSha256=digest(Path(__file__)), documents=documents, files=files,
                unchangedTestSha256=digest(REPO / 'src/sdk/package-boundaries.test.ts'),
                meaning='Exact captured inputs and path identities retained. No test rule or original byte changed. Existing baseline findings are outside this fixed list.')


def validate(manifest):
    require(manifest['version'] == 1 and [row['path'] for row in manifest['files']] == list(TARGETS), 'Manifest version/input set')
    require(manifest['unchangedTestSha256'] == digest(REPO / 'src/sdk/package-boundaries.test.ts'), 'Test source changed')
    for doc in manifest['documents']:
        require(digest(REPO / doc['path']) == doc['sha256'], 'Original classification changed')
    for row in manifest['files']:
        safe(row['path']); safe(row['gzipPath'])
        require(row['gzipPath'] == row['path'] + '.gz', 'Wrong sidecar path')
        packed = REPO / row['gzipPath']
        regular(packed, REPO)
        require(packed.stat().st_size == row['gzipBytes'] < LIMIT and digest(packed) == row['gzipSha256'], 'Gzip identity differs')
        original = REPO / row['path']
        if original.exists():
            regular(original, REPO)
            require(original.stat().st_size == row['bytes'] and digest(original) == row['sha256'], 'Existing original differs')


def extract(manifest, destination):
    for row in manifest['files']:
        path = destination / row['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        require(not any(p.is_symlink() for p in path.parents if p == destination or destination in p.parents), 'Symlink restore parent')
        with gzip.open(REPO / row['gzipPath'], 'rb') as src, path.open('xb') as dst:
            shutil.copyfileobj(src, dst)
        require(path.stat().st_size == row['bytes'] and digest(path) == row['sha256'], 'Decoded original differs')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive', action='store_true')
    mode.add_argument('--verify', action='store_true')
    mode.add_argument('--materialize', action='store_true')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    require(not args.prune or args.verify or args.archive, '--prune requires --archive or --verify')
    require(not args.out or args.materialize, '--out requires --materialize')
    manifest = create_manifest() if args.archive else json.loads(MANIFEST.read_text())
    validate(manifest)
    with tempfile.TemporaryDirectory(prefix='art-naming-input-check-', dir='/tmp') as temp:
        decoded = Path(temp)
        extract(manifest, decoded)
        if args.materialize:
            destination = args.out.resolve() if args.out else REPO
            if args.out:
                destination.mkdir(parents=True, exist_ok=False)
            # Preflight all existing targets before copying any missing originals.
            for row in manifest['files']:
                path = destination / row['path']
                if path.exists():
                    regular(path, destination)
                    require(path.stat().st_size == row['bytes'] and digest(path) == row['sha256'], 'Refuse changed restore target')
            for row in manifest['files']:
                path = destination / row['path']
                path.parent.mkdir(parents=True, exist_ok=True)
                require(not any(p.is_symlink() for p in path.parents if p == destination or destination in p.parents), 'Symlink restore parent')
                if not path.exists():
                    with (decoded / row['path']).open('rb') as src, path.open('xb') as dst:
                        shutil.copyfileobj(src, dst)
                require(digest(path) == row['sha256'], 'Restored bytes differ')
    if args.archive:
        write_json(MANIFEST, manifest)
    deleted = 0
    if args.prune:
        validate(manifest)
        for row in manifest['files']:
            original = REPO / row['path']
            regular(original, REPO)
            require(digest(original) == row['sha256'], 'Original changed before removal')
        require(sum(row['originallyTracked'] for row in manifest['files']) == 16,
                'Original capture must retain sixteen tracked input identities')
        tracked_now = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).decode().split('\0'))
        names = [row['path'] for row in manifest['files'] if row['path'] in tracked_now]
        # After the first committed cleanup, materialized mirrors are untracked.
        # Original captured tracked status remains unchanged in the manifest.
        if names:
            subprocess.run(['git', 'rm', '--', *names], cwd=REPO, check=True)
        deleted += len(names)
        for row in manifest['files']:
            if row['path'] not in names:
                (REPO / row['path']).unlink(); deleted += 1
    summary = dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
                   verifiedInputs=len(manifest['files']),
                   originalBytes=sum(row['bytes'] for row in manifest['files']),
                   gzipBytes=sum(row['gzipBytes'] for row in manifest['files']),
                   existingTraceGzipCount=sum(row['existingGzipRetained'] for row in manifest['files']),
                   newlyCreatedGzipCount=sum(not row['existingGzipRetained'] for row in manifest['files']),
                   deletedOriginals=deleted, restoredInputs=len(manifest['files']) if args.materialize else 0,
                   testSourceUnchanged=True, allDecodedOriginalSizesAndShaVerified=True,
                   toolSha256=digest(Path(__file__)), meaning='Storage/restore proof only. Original source, SDK test, recorded names and SHA remain unchanged; no global-green claim.')
    if args.archive:
        write_json(REPORT / 'artifact-archive-create-report.json', summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    main()
