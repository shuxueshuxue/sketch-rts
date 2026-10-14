#!/usr/bin/env python3
"""Lossless storage for exactly twenty historical captured art-lane inputs.

No test, source, historical manifest or Markdown is changed. Original bytes are
anchored to the recorded Git commit; in-place restore retains original paths.
Prune requires a separately verified complete independent restoration proof.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import zlib

REPO = Path(__file__).resolve().parent.parent
STORE = REPO / 'docs/art/refactor/followup/release-readiness'
MANIFEST = STORE / 'captured-inputs.json'
COMMIT = '386e530de3a289e2f9e7aab5978f23e70a2953e2'
SELECTOR = 'docs/art/refactor/followup/naming-gate/after-validation.json'
CARD = 'docs/art/refactor/followup/card-streaming/'
TARGETS = tuple(sorted(CARD + p for p in (
    'bank-order/battle-comparison.json',
    'bank-order/camera-after/camera-harness.mjs',
    'bank-order/camera-after/proof.json',
    'bank-order/camera-before/camera-harness.mjs',
    'bank-order/camera-before/proof.json',
    'bank-order/canonical-comparison.json',
    'bank-order/canonical-four-native-comparison.json',
    'bank-order/canonical-one-native-comparison.json',
    'bank-order/canonical-two-native-comparison.json',
    'bank-order/final/battle-comparison.json',
    'bank-order/final/camera-candidate/camera-harness.mjs',
    'bank-order/final/camera-candidate/proof.json',
    'bank-order/final/camera-reference/camera-harness.mjs',
    'bank-order/final/camera-reference/proof.json',
    'bank-order/final/canonical-comparison.json',
    'bank-order/final/mixed-comparison.json',
    'bank-order/mixed-comparison.json',
    'idle-identity/trace-analysis.json',
    'latency-investigation/current-correctness/camera/camera-harness.mjs',
    'latency-investigation/current-correctness/camera/proof.json',
)))
EXCLUDED = (CARD + 'README.md', 'docs/art/refactor/followup/png-archives/README.md')

def require(ok, why):
    if not ok:
        raise RuntimeError(why)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=REPO)

def safe(name):
    p = PurePosixPath(name)
    require(isinstance(name, str) and name and '\\' not in name and not p.is_absolute()
            and not any(v in ('.', '..') for v in p.parts) and p.as_posix() == name,
            'Unsafe relative filename')
    return name

def no_links(path):
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink path refused')

def read(path):
    no_links(path)
    require(path.is_file(), 'Missing original or archive: ' + str(path))
    return path.read_bytes()

def save(path, value):
    no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')

def tree(ref, names):
    result = {}
    for row in git('ls-tree', '-rz', ref, '--', *names).split(b'\0'):
        if row:
            head, name = row.decode().split('\t', 1)
            mode, kind, identity = head.split()
            require(kind == 'blob' and mode in ('100644', '100755'), 'Unsupported Git entry')
            result[safe(name)] = identity
    return result

def anchors():
    selector = git('show', COMMIT + ':' + SELECTOR)
    old = json.loads(selector)['remainingBaselineFiles']
    require(tuple(sorted(p for p in old if p not in EXCLUDED)) == TARGETS
            and len(old) == 22 and len(TARGETS) == 20, 'Fixed twenty-file selector differs')
    identities = tree(COMMIT, TARGETS)
    require(tuple(sorted(identities)) == TARGETS, 'Pinned Git input inventory differs')
    return selector, identities

def packed(data):
    out = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=out, mtime=0, compresslevel=9) as stream:
        stream.write(data)
    return out.getvalue()

def verify(manifest, identities):
    require(manifest['version'] == 1 and manifest['originalGitCommit'] == COMMIT,
            'Manifest source identity differs')
    require(tuple(r['path'] for r in manifest['files']) == TARGETS, 'Manifest scope/order differs')
    decoded = {}
    for row in manifest['files']:
        name = safe(row['path'])
        require(row['gzipPath'] == name + '.gz', 'Archive filename differs')
        stored = read(REPO / row['gzipPath'])
        require(len(stored) == row['gzipBytes'] and sha(stored) == row['gzipSha256'],
                'Stored archive identity differs: ' + name)
        data = gzip.decompress(stored)
        require(len(data) == row['bytes'] and sha(data) == row['sha256']
                and blob(data) == row['gitBlobSha1'] == identities[name],
                'Decoded original size/SHA/Git blob differs: ' + name)
        original = REPO / name
        if original.exists():
            require(read(original) == data, 'Existing original changed: ' + name)
        decoded[name] = data
    return decoded

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--archive', action='store_true')
    group.add_argument('--verify', action='store_true')
    group.add_argument('--materialize', action='store_true')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--restore-proof', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    require(not args.out or args.materialize, '--out requires --materialize')
    require(not args.prune or args.verify, '--prune requires independent --verify')
    require(not args.restore_proof or args.prune, '--restore-proof applies to prune')
    if args.report:
        no_links(args.report.absolute())
        require(not args.report.exists(), 'Exclusive operation report already exists')
    selector, identities = anchors()
    if args.archive:
        require(not MANIFEST.exists(), 'Archive manifest exists; use --verify')
        originals = {}
        for name in TARGETS:
            data = read(REPO / name)
            require(blob(data) == identities[name], 'Original differs from pinned Git: ' + name)
            require(not (REPO / (name + '.gz')).exists(), 'Exclusive gzip already exists: ' + name)
            originals[name] = data
        rows = []
        for name, data in originals.items():
            stored = packed(data)
            require(gzip.decompress(stored) == data and packed(data) == stored,
                    'Independent gzip roundtrip/determinism failed')
            with (REPO / (name + '.gz')).open('xb') as out:
                out.write(stored)
            rows.append(dict(path=name, bytes=len(data), sha256=sha(data), gitBlobSha1=identities[name],
                             gzipPath=name + '.gz', gzipBytes=len(stored), gzipSha256=sha(stored)))
        main_ref = git('rev-parse', '46cb95a^{commit}').decode().strip()
        manifest = dict(version=1, originalGitCommit=COMMIT, originalSelector=SELECTOR,
            originalSelectorSha256=sha(selector), files=rows, excludedHumanMarkdown=list(EXCLUDED),
            compression=dict(format='gzip', level=9, mtime=0, filename='', zlibVersion=zlib.ZLIB_VERSION),
            mainReference=main_ref, capturedPathsPresentAtMainReference=sorted(tree(main_ref, TARGETS)),
            attribution='Earlier baseline meant the art lane historical evidence set, not origin/main. Parent independently reports zero naming findings on main46cb95a; this operation only records targeted Git path presence.',
            meaning='Exact captured inputs, not SDK implementation. No original capture bytes, historical metadata, human Markdown, source or test rules are rewritten.')
        save(MANIFEST, manifest)
    else:
        manifest = json.loads(read(MANIFEST))
        require(manifest['originalSelectorSha256'] == sha(selector), 'Selector Git identity changed')
    decoded = verify(manifest, identities)
    restored = 0
    if args.materialize:
        destination = args.out.absolute() if args.out else REPO
        no_links(destination)
        if args.out:
            destination.mkdir(parents=True, exist_ok=False)
        for name, data in decoded.items():
            target = destination / name
            no_links(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                with target.open('xb') as stream:
                    stream.write(data)
            require(read(target) == data, 'Restored bytes differ: ' + name)
            restored += 1
    deleted = 0
    if args.prune:
        proof_path = args.restore_proof or STORE / 'captured-input-restore-proof.json'
        proof = json.loads(read(proof_path.absolute()))
        require(proof['operation'] == 'materialize' and proof['verifiedFiles'] == 20
                and proof['restoredFiles'] == 20 and proof['allOriginalSizeShaAndGitBlobExact'] is True
                and proof['manifestSha256'] == sha(read(MANIFEST)), 'Restore proof identity differs')
        destination = Path(proof['restoredRoot'])
        require(destination.is_absolute() and destination != REPO
                and str(destination).startswith('/tmp/'), 'Independent restore must be beneath /tmp')
        require(destination.is_dir(), 'Required independent restore directory is missing')
        no_links(destination)
        for name, data in decoded.items():
            require(read(destination / name) == data,
                    'Independent restored bytes differ: ' + name)
            require(read(REPO / name) == data, 'Original full preflight differs: ' + name)
        for name in TARGETS:
            require(read(REPO / name) == decoded[name], 'Original changed immediately before prune')
            (REPO / name).unlink()
            deleted += 1
    report = dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
        verifiedFiles=20, originalBytes=sum(r['bytes'] for r in manifest['files']),
        gzipBytes=sum(r['gzipBytes'] for r in manifest['files']),
        originalGitCommit=COMMIT, manifest='docs/art/refactor/followup/release-readiness/captured-inputs.json',
        manifestSha256=sha(read(MANIFEST)), allOriginalSizeShaAndGitBlobExact=True,
        restoredFiles=restored, restoredRoot=str(destination) if args.materialize else None,
        deletedOriginalFiles=deleted, excludedHumanMarkdown=list(EXCLUDED),
        maintainedToolSha256=sha(read(Path(__file__))), noGitIndexSourceTestOrHistoricalMetadataChanges=True)
    if args.report:
        save(args.report.absolute(), report)
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
