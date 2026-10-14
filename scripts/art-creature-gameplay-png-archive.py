#!/usr/bin/env python3
"""Exact original PNG storage for the two finished creature gameplay captures.

--archive [--prune] compares standard tar.gz/tar.xz containers, retains the
smaller one, and independently restores every original encoded frame first.
--verify rechecks original proofs, retained assets and all 40 archive members.
--materialize --folder before|after [--out NEWDIR] restores original filenames.
No PNG decoding/re-encoding, browser work, source repacking or proof edits.
"""
import argparse
import gzip
import hashlib
import json
import lzma
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / 'docs/art/refactor/followup/creature-launch-review/gameplay'
TARGETS = ('before', 'after')
KEPT = {0, 9, 20, 29, 39}
FRAME_NAMES = [f'frame-{n:03d}.png' for n in range(40)]
XZ_DICTIONARY_BYTES = 16 * 1024 * 1024
LIMIT = 90 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def regular(path):
    require(not any(p.is_symlink() for p in (path, *path.parents)) and path.is_file(),
            'Missing/nonregular file: ' + str(path))


def digest(path):
    regular(path)
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(path):
    return dict(name=path.name, size=path.stat().st_size, sha256=digest(path))


def save(path, value):
    require(not path.exists() and not path.is_symlink(), 'Exclusive output exists: ' + str(path))
    with path.open('x') as output:
        json.dump(value, output, indent=2); output.write('\n')


def set_sha(rows):
    values = [{key: row[key] for key in ('name', 'size', 'sha256')} for row in rows]
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def safe_name(name):
    require(isinstance(name, str) and name not in ('', '.', '..')
            and Path(name).name == name and '/' not in name and '\\' not in name,
            'Unsafe member name')


def exact_present(path, row):
    regular(path)
    require(path.stat().st_size == row['size'] and digest(path) == row['sha256'],
            'Original bytes changed: ' + str(path))


def validate_sources(manifest, directory):
    sources = manifest['sources']
    require([row['name'] for row in sources] == sorted({row['name'] for row in sources}),
            'Source order/duplicates differ')
    for row in sources:
        safe_name(row['name']); exact_present(directory / row['name'], row)
    require('proof.json' in {row['name'] for row in sources}, 'Unbound original proof')
    proof = json.loads((directory / 'proof.json').read_bytes())
    require(len(proof['framePngSha256']) == 40, 'Original proof does not contain exactly 40 frames')
    require([row['sha256'] for row in manifest['files']] == proof['framePngSha256'],
            'Original encoded frame/proof SHA differs')
    by_name = {row['name']: row for row in sources}
    for portrait in proof['portraits']:
        for field in ('png', 'bodyPng'):
            item = portrait[field]; safe_name(item['file'])
            require(item['file'] in by_name and by_name[item['file']]['sha256'] == item['sha256'],
                    'Direct portrait/body proof SHA differs')
    video = proof['video']; safe_name(video['file'])
    require(video['file'] == 'gameplay.mp4' and by_name[video['file']]['sha256'] == video['sha256'],
            'Direct MP4 proof SHA differs')


def validate_manifest(manifest, label):
    require(manifest['version'] == 1 and manifest['folder'] == label, 'Manifest scope/version differs')
    files = manifest['files']
    require([row['name'] for row in files] == FRAME_NAMES, 'Exact 40-member frame set/order differs')
    require(set_sha(files) == manifest['fileSetSha256'], 'Original encoded PNG file-set SHA differs')
    for n, row in enumerate(files):
        require(row['keep'] == (n in KEPT), 'Selected-frame retention differs')
    container = manifest['archive']
    require(container['format'] in ('gz', 'xz') and container['file'] == manifest['fileSetSha256'] + '.tar.' + container['format'],
            'Archive identity/name differs')
    require(manifest['retention'] == dict(frames=[FRAME_NAMES[n] for n in sorted(KEPT)],
            allSmallPortraitAndBodyPng=True, gameplayMp4=True, existingSourceTarUnchanged=True),
            'Retention policy differs')
    validate_sources(manifest, BASE / label)


def make_container(directory, rows, file, kind):
    require(not file.exists(), 'Exclusive temporary archive exists')
    with file.open('xb') as raw:
        if kind == 'gz':
            stream = gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=9)
        else:
            stream = lzma.LZMAFile(raw, mode='w', format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64,
                filters=[dict(id=lzma.FILTER_LZMA2, preset=6, dict_size=XZ_DICTIONARY_BYTES)])
        with stream, tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for row in rows:
                exact_present(directory / row['name'], row)
                member = tarfile.TarInfo(row['name'])
                member.size = row['size']; member.mode = 0o644; member.mtime = 0
                with (directory / row['name']).open('rb') as source:
                    archive.addfile(member, source)
    return dict(format=kind, file=file.name, bytes=file.stat().st_size, sha256=digest(file))


def extract_verified(manifest, destination):
    container = manifest['archive']; file = BASE / manifest['folder'] / container['file']
    regular(file)
    require(file.stat().st_size == container['bytes'] < LIMIT and digest(file) == container['sha256'],
            'Complete container size/SHA differs')
    with tarfile.open(file, 'r:' + container['format']) as archive:
        members = archive.getmembers()
        require([member.name for member in members] == FRAME_NAMES, 'Closed tar member set/order differs')
        for member, row in zip(members, manifest['files']):
            require(member.isfile() and not member.issym() and not member.islnk()
                    and member.size == row['size'], 'Tar member type/size differs')
            source = archive.extractfile(member); require(source is not None, 'Unreadable frame member')
            with source, (destination / row['name']).open('xb') as output:
                shutil.copyfileobj(source, output)
            exact_present(destination / row['name'], row)


def check_frames(manifest, all_present=False):
    directory = BASE / manifest['folder']
    actual = {path.name for path in directory.glob('frame-*.png')}
    require(actual.issubset(set(FRAME_NAMES)), 'Unexpected gameplay frame filename')
    for row in manifest['files']:
        path = directory / row['name']
        if path.exists() or path.is_symlink():
            exact_present(path, row)
        else:
            require(not all_present and not row['keep'], 'Missing required direct frame')


def archive_folder(label, tracked):
    directory = BASE / label; manifest_file = directory / 'png-archive.json'
    require(not manifest_file.exists(), 'Already archived; use --verify: ' + label)
    require(sorted(path.name for path in directory.glob('frame-*.png')) == FRAME_NAMES,
            'Capture must initially contain all 40 original frames')
    rows = [dict(**identity(directory / name), keep=n in KEPT) for n, name in enumerate(FRAME_NAMES)]
    for row in rows:
        require((directory / row['name']).relative_to(REPO).as_posix() not in tracked,
                'Refuse pruning/storing an already tracked raw frame')
    sources = [identity(path) for path in sorted(directory.iterdir(), key=lambda p: p.name)
               if path.is_file() and path.name not in FRAME_NAMES]
    require(len([row for row in sources if row['name'].endswith('.png')]) == 6,
            'Expected all six direct portrait/body PNGs')
    manifest = dict(version=1, folder=label, fileSetSha256=set_sha(rows), files=rows, sources=sources,
        retention=dict(frames=[FRAME_NAMES[n] for n in sorted(KEPT)], allSmallPortraitAndBodyPng=True,
                       gameplayMp4=True, existingSourceTarUnchanged=True),
        meaning='All original encoded frame PNG bytes retained exactly. Compression and selected direct files change evidence storage only, not image quality, simulation or game performance.')
    validate_sources(manifest, directory)
    candidates = []
    for kind in ('gz', 'xz'):
        file = directory / (manifest['fileSetSha256'] + '.tar.' + kind + '.tmp')
        candidates.append(make_container(directory, rows, file, kind))
    chosen = min(candidates, key=lambda row: row['bytes'])
    source = directory / chosen['file']; destination = source.with_suffix('')
    require(not destination.exists(), 'Exclusive final archive exists')
    source.rename(destination)
    manifest['archive'] = dict(chosen, file=destination.name)
    manifest['compressionComparison'] = [dict(row, retained=row is chosen) for row in candidates]
    manifest['compression'] = dict(gzipLevel=9, xzPreset=6, xzDictionaryBytes=XZ_DICTIONARY_BYTES,
        originalPngEncodingUnchanged=True, sharedArchiveReuse='Only identical complete encoded file sets qualify; before/after have separate sets.')
    validate_manifest(manifest, label)
    with tempfile.TemporaryDirectory(prefix='creature-png-full-restore-', dir='/tmp') as temporary:
        extract_verified(manifest, Path(temporary))
    check_frames(manifest, all_present=True)
    save(manifest_file, manifest)
    for row in candidates:
        if row is not chosen:
            (directory / row['file']).unlink()  # Only this tool's newly created unused temporary container.
    with (directory / 'PNG-ARCHIVE.md').open('x') as instructions:
        instructions.write(f'''# Exact gameplay frame archive

All 40 original encoded PNG frames are retained in the container identified by [png-archive.json](png-archive.json). Frames 0, 9, 20, 29 and 39, every portrait/body PNG, the MP4 and the existing source archive remain directly available. Original proof and encoded image SHA values are unchanged.

Run from the repository root:

```sh
python3 scripts/art-creature-gameplay-png-archive.py --verify --folder {label}
python3 scripts/art-creature-gameplay-png-archive.py --materialize --folder {label}
python3 scripts/art-creature-gameplay-png-archive.py --materialize --folder {label} --out /tmp/creature-{label}-frames
```

The independent output directory must not exist. Existing frame files must match their original SHA and are never overwritten. Every verification extracts all 40 closed, regular tar members into a temporary directory and checks their full encoded bytes against the unchanged original proof. This is evidence-storage preservation, not an image re-encoding or a performance experiment.
''')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--archive', action='store_true'); modes.add_argument('--verify', action='store_true')
    modes.add_argument('--materialize', action='store_true')
    parser.add_argument('--folder', choices=TARGETS)
    parser.add_argument('--out', type=Path); parser.add_argument('--prune', action='store_true')
    args = parser.parse_args()
    require(not args.out or args.materialize and args.folder, '--out requires --materialize --folder')
    require(not args.prune or args.archive or args.verify, '--prune requires --archive or --verify')
    labels = (args.folder,) if args.folder else TARGETS
    tracked = {path.decode() for path in subprocess.check_output(['git', 'ls-files', '-z'], cwd=REPO).split(b'\0') if path} if args.prune or args.archive else set()
    started = time.monotonic(); manifests = []
    for label in labels:
        manifest = archive_folder(label, tracked) if args.archive else json.loads((BASE / label / 'png-archive.json').read_bytes())
        validate_manifest(manifest, label)
        with tempfile.TemporaryDirectory(prefix='creature-png-verify-', dir='/tmp') as temporary:
            extract_verified(manifest, Path(temporary))
            check_frames(manifest, all_present=args.prune)
            if args.materialize:
                destination = args.out.absolute() if args.out else BASE / label
                require(not any(p.is_symlink() for p in (destination, *destination.parents)), 'Symlink restore destination')
                if args.out:
                    destination.mkdir(exist_ok=False, parents=True)
                for row in manifest['files']:
                    path = destination / row['name']
                    if path.exists() or path.is_symlink():
                        exact_present(path, row)
                for row in manifest['files']:
                    path = destination / row['name']
                    if not path.exists():
                        with (Path(temporary) / row['name']).open('rb') as source, path.open('xb') as output:
                            shutil.copyfileobj(source, output)
                    exact_present(path, row)
        manifests.append(manifest)
        print('VERIFIED ' + label + ' full original frames=40', flush=True)
    deleted = deleted_bytes = 0
    if args.prune:
        for manifest in manifests:
            validate_manifest(manifest, manifest['folder']); check_frames(manifest, all_present=True)
            for row in manifest['files']:
                path = BASE / manifest['folder'] / row['name']
                require(path.relative_to(REPO).as_posix() not in tracked, 'Refuse tracked original frame prune')
        for manifest in manifests:
            for row in manifest['files']:
                if not row['keep']:
                    path = BASE / manifest['folder'] / row['name']; exact_present(path, row)
                    path.unlink(); deleted += 1; deleted_bytes += row['size']
    print(json.dumps(dict(operation='prune' if args.prune else 'archive' if args.archive else 'materialize' if args.materialize else 'verify',
        folders=list(labels), originalFrames=40 * len(manifests), originalFrameBytes=sum(row['size'] for manifest in manifests for row in manifest['files']),
        containerBytes=sum(manifest['archive']['bytes'] for manifest in manifests), retainedDirectFrames=5 * len(manifests),
        retainedSmallPortraitBodyPng=6 * len(manifests), directMp4=len(manifests), deletedFrames=deleted, deletedFrameBytes=deleted_bytes,
        elapsedSeconds=time.monotonic()-started, fullIndependentOriginalEncodedRestoreVerified=True,
        originalProofSourcesAndExistingSourceTarUnchanged=True, noImageReencodingOrGamePerformanceClaim=True,
        archives=[dict(folder=manifest['folder'],fileSetSha256=manifest['fileSetSha256'],**manifest['archive'],compressionComparison=manifest['compressionComparison']) for manifest in manifests]),indent=2),flush=True)


if __name__ == '__main__':
    main()
