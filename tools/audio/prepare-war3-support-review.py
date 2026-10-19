#!/usr/bin/env python3
"""Prepare private healing/summon audition files; never writes a game pack.

Run on mac1/A100 with ffmpeg, the owner's extracted sound archive, and a
read-only snapshot of the live War3 pack. Copy the review HTML separately.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

CANDIDATES = {
    'feral-spirit': 'Abilities/Spells/Orc/FeralSpirit/FeralSpiritTarget1.wav',
    'wolf-birth': 'Units/Orc/Spiritwolf/SpiritWolfBirth1.wav',
    'unsummon': 'Abilities/Spells/Undead/Unsummon/CityscapeCrystalShield1.wav',
    'human-dissipate': 'Sound/Units/Human/HumanDissipate1.wav',
    'nightelf-dissipate': 'Sound/Units/NightElf/NightElfDissipate1.wav',
    'orc-dissipate': 'Sound/Units/Orc/OrcDissipate1.wav',
    'undead-dissipate': 'Sound/Units/Undead/Dissipate/UndeadDissipate2.wav',
    'dispel': 'Abilities/Spells/Human/DispelMagic/DispelMagicTarget.wav',
    'disenchant': 'Abilities/Spells/Orc/Disenchant/Disenchant.wav',
}


def run(*args):
    subprocess.run(args, check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='directory containing files/')
    parser.add_argument('war3', type=Path, help='read-only live pack snapshot')
    parser.add_argument('output', type=Path, help='new audition directory')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    evidence = {}

    def preview(label, source, levels):
        for suffix, volume in levels:
            filename = f'{label}-{suffix}.mp3'
            # Bake the pack volume into the file: mobile Safari ignores the
            # HTMLAudioElement volume property. The page plays these at 1.
            run('ffmpeg', '-nostdin', '-v', 'error', '-i', str(source),
                '-af', f'volume={volume}', '-c:a', 'libmp3lame', '-q:a', '2',
                str(args.output / filename))
            evidence[label].setdefault('previews', {})[suffix] = {
                'file': filename, 'volume': volume,
                'sha256': digest(args.output / filename),
            }

    for label, path in CANDIDATES.items():
        source = args.archive / 'files' / path
        filename = hashlib.sha256(path.encode()).hexdigest()[:16] + '.ogg'
        output = args.output / filename
        run('ffmpeg', '-nostdin', '-v', 'error', '-i', str(source),
            '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-ar', '32000', '-ac', '1',
            '-c:a', 'libvorbis', '-q:a', '3', str(output))
        evidence[label] = {'source': path, 'sourceSha256': digest(source),
                           'file': filename, 'sha256': digest(output)}
        preview(label, output, [('reference', .35), ('quieter', .21)])

    for label, filename, levels in [
        ('heal', '2c95dfd331f5eebf.ogg', [('approved', .6)]),
        ('summon', '282737251034bf2a.ogg', [('before', .6), ('after', .36)]),
        ('disappear', '2f218ee413d56fc4.ogg', [('before', .35), ('quieter', .21)]),
    ]:
        source = args.war3 / filename
        evidence[label] = {'liveFile': filename, 'sha256': digest(source)}
        preview(label, source, levels)
    (args.output / 'candidates.json').write_text(json.dumps(evidence, indent=2) + '\n')


if __name__ == '__main__':
    main()
