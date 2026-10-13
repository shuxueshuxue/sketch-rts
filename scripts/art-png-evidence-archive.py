#!/usr/bin/env python3
"""Byte-exact PNG evidence archives. Never renders or rewrites original proofs.

--archive [--prune]: archive the fixed, authorized untracked proof folders.
--verify [--folder PATH]: extract and hash all archived original PNG bytes.
--materialize [--folder PATH] [--out NEWDIR]: restore exact PNG bytes; default
is the original proof directory. Existing files must already match the manifest.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / 'docs/art/refactor/followup'
STORE = BASE / 'png-archives'
TARGETS = (
    ['card-streaming/mip-residency/camera-' + s for s in ('before', 'after', 'after-coexisting', 'after-one-source')]
    + ['card-streaming/bank-order/' + s for s in ('camera-before', 'camera-after', 'battle-before', 'battle-after')]
    + ['card-streaming/bank-order/final/' + s for s in ('camera-reference', 'camera-candidate', 'battle-reference', 'battle-candidate')]
    + ['mercenary-models/gameplay', 'mercenary-models/gameplay-final']
)
LIMIT = 90 * 1024 * 1024

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), sort_keys=True).encode()

def set_digest(files):
    return hashlib.sha256(canonical([{k: f[k] for k in ('name', 'size', 'sha256')} for f in files])).hexdigest()

def write_json(file, value):
    temporary = file.with_name(file.name + '.tmp')
    with open(temporary, 'x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    os.replace(temporary, file)

def checksums(proof):
    result = {}
    def add(name, sha):
        require(len(sha) == 64 and all(c in '0123456789abcdef' for c in sha), 'Bad proof SHA: ' + name)
        require(name not in result or result[name] == sha, 'Conflicting proof SHA: ' + name)
        result[name] = sha
    def visit(value):
        if isinstance(value, dict):
            filename = value.get('path', value.get('file'))
            checksum = value.get('pngSha256', value.get('sha256'))
            if isinstance(filename, str) and filename.endswith('.png') and isinstance(checksum, str):
                add(Path(filename).name, checksum)
            for v in value.values():
                visit(v)
        elif isinstance(value, list):
            for v in value:
                visit(v)
    visit(proof)
    for i, sha in enumerate(proof.get('framePngSha256', [])):
        add(f'frame-{i:03d}.png', sha)
    return result

def keep(target, name):
    if '/camera-' in target:
        return name in {
            'camera-battlefield-composite.png', 'camera-empty-composite.png',
            'camera-returned-first-composite.png', 'promotion-high-first-composite.png',
            'dpr-1-1280x720-zoom-0p35-composite.png', 'dpr-1-1280x720-zoom-0p75-composite.png',
            'dpr-1-1280x720-zoom-2-composite.png', 'dpr-2-1280x720-zoom-2-composite.png',
        }
    if not name.startswith('frame-'):
        return True  # Keep small UI portraits, selected proof images and legacy probes.
    number = int(name[6:-4])
    return number in ({0, 19, 20, 28, 30, 35} if target.startswith('mercenary-models/') else {0, 1, 4, 8, 20, 30, 35, 79})

def validate_manifest(manifest, target):
    require(manifest['version'] == 1 and manifest['target'] == target, 'Manifest target/version')
    files = manifest['files']
    require([f['name'] for f in files] == sorted({f['name'] for f in files}), 'File order/duplicates')
    require(set_digest(files) == manifest['fileSetSha256'], 'File-set digest')
    require(manifest['archive']['file'] == manifest['fileSetSha256'] + '.tar.gz', 'Container filename')
    for f in files:
        require(Path(f['name']).name == f['name'] and f['name'].endswith('.png'), 'Unsafe filename')
        require(f['keep'] == keep(target, f['name']), 'Keep policy mismatch')
    directory = BASE / target
    for source in manifest['sources']:
        require(Path(source['name']).name == source['name'], 'Unsafe source name')
        require(digest(directory / source['name']) == source['sha256'], 'Original source changed: ' + source['name'])
    proof = json.loads((directory / 'proof.json').read_text())
    expected = checksums(proof)
    for f in files:
        require(f['proofEncodedSha256'] == expected.get(f['name']), 'Proof checksum mapping changed')
        if f['name'] in expected:
            require(f['sha256'] == expected[f['name']], 'Proof checksum mismatch: ' + f['name'])
    require(set(expected).issubset({f['name'] for f in files}), 'Proof PNG missing from complete manifest')

def extract_verified(manifest, destination):
    archive = STORE / manifest['archive']['file']
    require(archive.stat().st_size == manifest['archive']['bytes'] < LIMIT, 'Container size limit/mismatch')
    require(digest(archive) == manifest['archive']['sha256'], 'Container SHA mismatch')
    files = manifest['files']
    # Inspect and manually copy regular members: never extract links or traversal paths.
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        require([m.name for m in members] == [f['name'] for f in files], 'Archive member set/order mismatch')
        for member, f in zip(members, files):
            require(member.isfile() and member.size == f['size'], 'Archive member type/size')
            output = destination / f['name']
            with tar.extractfile(member) as source, open(output, 'xb') as sink:
                shutil.copyfileobj(source, sink)
            require(digest(output) == f['sha256'], 'Extracted PNG SHA mismatch: ' + f['name'])

def check_present(manifest, allow_missing=True):
    directory = BASE / manifest['target']
    for f in manifest['files']:
        p = directory / f['name']
        if p.exists():
            require(not p.is_symlink() and p.stat().st_size == f['size'] and digest(p) == f['sha256'], 'Present PNG changed: ' + str(p))
        else:
            require(allow_missing and not f['keep'], 'Missing retained PNG: ' + str(p))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive', action='store_true')
    mode.add_argument('--verify', action='store_true')
    mode.add_argument('--materialize', action='store_true')
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--folder', help='One authorized path, relative to repo or followup root')
    parser.add_argument('--out', type=Path, help='New output directory; only with --materialize --folder')
    args = parser.parse_args()
    require(not args.prune or args.archive, '--prune requires --archive')
    require(not args.out or (args.materialize and args.folder), '--out requires --materialize --folder')
    require(not (args.archive and args.folder), '--archive inventories all authorized targets together')
    targets = TARGETS
    if args.folder:
        target = args.folder.removeprefix('docs/art/refactor/followup/').rstrip('/')
        require(target in TARGETS, 'Folder is not in the authorized list')
        targets = [target]
    manifests, skipped = [], []
    STORE.mkdir(exist_ok=True)
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).decode().split('\0')) if args.archive else set()
    for target in targets:
        directory = BASE / target
        if not directory.is_dir():
            skipped.append(target)
            print('SKIP missing directory: ' + target, flush=True)
            continue
        manifest_file = directory / 'png-archive.json'
        if args.archive:
            require(not manifest_file.exists(), 'Already archived; use --verify/--materialize: ' + target)
            files = []
            expected = checksums(json.loads((directory / 'proof.json').read_text()))
            for p in sorted(directory.glob('*.png')):
                require(not p.is_symlink() and str(p.relative_to(REPO)) not in tracked, 'Refuse tracked/symlink PNG: ' + str(p))
                sha = digest(p)
                require(p.name not in expected or sha == expected[p.name], 'Original PNG does not match proof: ' + str(p))
                files.append(dict(name=p.name, size=p.stat().st_size, sha256=sha, keep=keep(target, p.name), proofEncodedSha256=expected.get(p.name)))
            require(files and set(expected).issubset({f['name'] for f in files}), 'Missing source PNG: ' + target)
            set_sha = set_digest(files)
            archive = STORE / (set_sha + '.tar.gz')
            if not archive.exists():
                temporary = archive.with_suffix('.tmp')
                with open(temporary, 'xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as zipped, tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as tar:
                    for f in files:
                        info = tarfile.TarInfo(f['name']); info.size=f['size']; info.mode=0o644; info.mtime=0
                        with open(directory / f['name'], 'rb') as stream:
                            tar.addfile(info, stream)
                require(temporary.stat().st_size < LIMIT, 'Container exceeds strict 90 MiB limit; no source removed')
                os.replace(temporary, archive)
            sources = [dict(name=p.name, sha256=digest(p)) for p in sorted(directory.iterdir()) if p.is_file() and p.suffix != '.png']
            manifest = dict(version=1, target=target, fileSetSha256=set_sha,
                fileSetHashDefinition='SHA256 of UTF-8 compact sorted-key JSON array of sorted {name,size,sha256}; exact original PNG encoded bytes.',
                archive=dict(file=archive.name, bytes=archive.stat().st_size, sha256=digest(archive)), sources=sources, files=files,
                meaning='Original encoded PNG bytes preserved, not a pixel re-encoding. Proofs and negative results unchanged. Missing files restore exactly via --materialize.')
        else:
            manifest = json.loads(manifest_file.read_text())
        validate_manifest(manifest, target)
        with tempfile.TemporaryDirectory(prefix='art-png-extract-', dir='/tmp') as temp:
            extracted = Path(temp)
            extract_verified(manifest, extracted)
            check_present(manifest, allow_missing=not args.archive)
            if args.materialize:
                destination = args.out.resolve() if args.out else directory
                if args.out:
                    destination.mkdir(exist_ok=False, parents=True)
                # Preflight every existing target before copying any missing file.
                for f in manifest['files']:
                    p = destination / f['name']
                    require(not p.exists() or (not p.is_symlink() and digest(p)==f['sha256']), 'Refuse to overwrite changed target: ' + str(p))
                for f in manifest['files']:
                    p = destination / f['name']
                    if not p.exists():
                        with open(extracted / f['name'], 'rb') as src, open(p, 'xb') as dst:
                            shutil.copyfileobj(src, dst)
                    require(digest(p)==f['sha256'], 'Materialized SHA mismatch')
        if args.archive:
            write_json(manifest_file, manifest)
            readme = directory / 'PNG-ARCHIVE.md'
            require(not readme.exists(), 'Archive README already exists')
            readme.write_text(f'''# Exact PNG archive\n\nAll {len(files)} original PNGs are stored, including selected images retained here, in the shared archive identified by [png-archive.json](png-archive.json). Complete sorted filename/size/SHA sets select archive reuse; similarity alone never deduplicates. Original encoded PNG SHA values are preserved exactly. Raw proofs, source hashes, numerical results and any failed diagnostics are unchanged.\n\nRun from the repository root:\n\n```sh\npython scripts/art-png-evidence-archive.py --verify --folder {target}\npython scripts/art-png-evidence-archive.py --materialize --folder {target}\n```\n\nMaterialization defaults to this original folder so old comparison tools work unchanged. Existing retained PNGs must match their original SHA; changed files are never overwritten. Add `--out /tmp/new-directory` to restore elsewhere. Both commands verify the original source documents, full container SHA, exact member set and each extracted PNG SHA. Archive verification proves evidence preservation, not that a historical failed comparison passed.\n''')
        manifests.append(manifest)
        print('VERIFIED ' + target + ' files=' + str(len(manifest['files'])), flush=True)
    deleted_files = deleted_bytes = 0
    if args.prune:
        # All folders/containers have completed extraction verification before any deletion.
        for manifest in manifests:
            validate_manifest(manifest, manifest['target'])
            check_present(manifest, allow_missing=False)
        for manifest in manifests:
            for f in manifest['files']:
                if not f['keep']:
                    p = BASE / manifest['target'] / f['name']
                    require(digest(p)==f['sha256'], 'Source changed before pruning')
                    p.unlink(); deleted_files += 1; deleted_bytes += f['size']
    unique = {m['archive']['file']:m['archive'] for m in manifests}
    summary = dict(operation='archive' if args.archive else 'materialize' if args.materialize else 'verify', verifiedFolders=len(manifests), skippedMissingDirectories=skipped,
        originalPngFiles=sum(len(m['files']) for m in manifests), originalPngBytes=sum(sum(f['size'] for f in m['files']) for m in manifests),
        uniqueArchives=len(unique), archiveBytes=sum(a['bytes'] for a in unique.values()), largestArchiveBytes=max((a['bytes'] for a in unique.values()), default=0),
        deletedFiles=deleted_files, deletedBytes=deleted_bytes,
        retainedFiles=sum(sum(f['keep'] for f in m['files']) for m in manifests), retainedBytes=sum(sum(f['size'] for f in m['files'] if f['keep']) for m in manifests),
        archives=list(unique.values()), folders=[dict(target=m['target'], fileSetSha256=m['fileSetSha256']) for m in manifests],
        meaning='Exact encoded PNG preservation only; no rendering/performance measurements or original proof changes.')
    if args.archive:
        summary['netPngPayloadBytesSaved'] = deleted_bytes - summary['archiveBytes']
        write_json(STORE / 'archive-report.json', summary)
    print(json.dumps(summary, indent=2), flush=True)

if __name__ == '__main__':
    main()
