#!/usr/bin/env python3
"""Stage the selected CC0 mortar supplement against a snapshot of the hosted War3 pack.

Run after prepare-war3.py when rebuilding the private pack. This writes a separate
staging directory; it never updates the input pack or publishes anything.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


SOURCE_URL = 'https://cdn.freesound.org/previews/184/184382_71257-hq.mp3'
SOURCE_SHA256 = '9ca9880572c1479b1ae627872dbfd3a5149b1f2d11f2e81269027fd65638c6e5'
SOURCE_KEY = SOURCE_URL + '#t=0.960,3.100'
FILE = hashlib.sha256(SOURCE_KEY.encode()).hexdigest()[:16] + '.ogg'
REVIEWED_SHA256 = '71cff5f4c148ce80b163c243d2c640251901658d8ec0cc233cd5eb0eddc5f93e'


def manifest_with_mortar(manifest):
    result = deepcopy(manifest)
    if result.get('name') != 'Warcraft III':
        raise ValueError('Expected the Warcraft III pack')
    mortar = result['sounds']['mortarShot']
    if mortar != {'file': '08767be75a63ac43.ogg', 'volume': .8, 'pitch': .025}:
        raise ValueError('mortarShot changed since review; check the pack before rebuilding')
    mortar['file'] = FILE
    return result


def prepare(source, war3, output, reviewed_clip=None):
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('Expected the reviewed Freesound 184382 high-quality MP3 preview')
    if reviewed_clip is not None and hashlib.sha256(reviewed_clip.read_bytes()).hexdigest() != REVIEWED_SHA256:
        raise ValueError('Expected the exact approved mortar Ogg')
    if output.resolve() == war3.resolve() or war3.resolve() in output.resolve().parents:
        raise ValueError('Output must be outside the input pack')
    extras = manifest_with_mortar(json.loads((war3 / 'extras.json').read_text()))
    source_map = war3 / 'sources.json'
    sources = json.loads(source_map.read_text()) if source_map.exists() else {}
    sources[SOURCE_KEY] = FILE
    output.mkdir(parents=True, exist_ok=False)
    if reviewed_clip is not None:
        # Release the bytes the owner heard, without a second encode.
        shutil.copyfile(reviewed_clip, output / FILE)
    else:
        # Same loudness target and encoding as prepare-war3.py. The first shot's
        # complete tail reaches the noise floor at 3.0 s, before the cut at 3.1 s.
        subprocess.run([
            'ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
            '-af', 'atrim=start=0.960:end=3.100,asetpts=PTS-STARTPTS,loudnorm=I=-20:TP=-2:LRA=7',
            '-ar', '32000', '-ac', '1', '-c:a', 'libvorbis', '-q:a', '3', str(output / FILE),
        ], check=True)
    (output / 'extras.json').write_text(json.dumps(extras, indent=2) + '\n')
    (output / 'sources.json').write_text(json.dumps(sources, indent=2) + '\n')
    print(f'Staged mortarShot: {output / FILE}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='184382_71257-hq.mp3 (SHA-256 checked)')
    parser.add_argument('war3', type=Path, help='snapshot containing extras.json and optional sources.json')
    parser.add_argument('output', type=Path, help='new staging directory outside the input pack')
    parser.add_argument('--reviewed-clip', type=Path, help='copy the approved Ogg byte-for-byte (SHA-256 checked), without re-encoding')
    args = parser.parse_args()
    prepare(args.source, args.war3, args.output, args.reviewed_clip)


if __name__ == '__main__':
    main()
