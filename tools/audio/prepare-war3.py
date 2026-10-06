#!/usr/bin/env python3
"""Build a private, curated War3 pack from the owner's extracted archive.

No recordings are committed. Core events remain readable by older clients;
extras.json supplies naval sounds, spells and menu feedback to the runtime.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess


def recipe(paths):
    def entry(path, volume=.7, **extra):
        if path not in paths:
            raise ValueError('Missing archive sound: ' + path)
        return {'sources': [path], 'volume': volume, 'pitch': .025, **extra}
    core = {
        'impact': entry('Sound/Units/Combat/MetalMediumBashFlesh1.wav', .55),
        'melee': entry('Sound/Units/Combat/MetalMediumSliceFlesh1.wav', .6),
        'arrowShot': entry('Abilities/Weapons/Arrow/ArrowAttack1.wav', .65),
        'arrowHit': entry('Abilities/Weapons/Arrow/ArrowImpact.wav', .6),
        'death': entry('Sound/Units/Combat/MetalMediumBashFlesh1.wav', .35),
        'construction': entry('Sound/Buildings/Shared/BuildingPlacement.wav', .45),
        'built': entry('Sound/Interface/GoodJob.wav', .4, max=1),
        'buildingDown': entry('Sound/Buildings/Death/BuildingDeath.wav', .65),
        'click': entry('Sound/Interface/MouseClick1.wav', .4, pitch=0),
    }
    extras = {
        'menu': entry('Sound/Interface/MouseClick2.wav', .4, pitch=0),
        'shipShot': entry('Abilities/Weapons/CannonTowerMissile/CannonTowerMissileLaunch1.wav', .8, kinds={
            'cutter': entry('Abilities/Weapons/Arrow/ArrowAttack1.wav', .65),
            'bombardShip': entry('Abilities/Weapons/Catapult/CatapultMissile1.wav', .8),
            'fireShip': entry('Units/Creeps/InfernalCannonFlame/InfernalJuggernautFire1.wav', .7)}),
        'shipHit': entry('Abilities/Weapons/CannonTowerMissile/CannonTowerMissile1.wav', .7),
        'shipSink': entry('Doodads/Northrend/Water/Battleship/BattleShipDeath1.wav', .8, max=2),
        'spell': entry('Abilities/Spells/Orc/FeralSpirit/FeralSpiritTarget1.wav', .65, kinds={
            'priest': entry('Abilities/Spells/Human/Heal/HealTarget.wav', .6),
            'pyreCaller': entry('Abilities/Spells/Human/Resurrect/ResurrectTarget.wav', .6)}),
        'board': entry('Abilities/Spells/Other/LoadUnload/Loading.wav', .5, max=2),
        'unload': entry('Abilities/Spells/Other/LoadUnload/Loading.wav', .5, max=2),
    }
    return {'core': core, 'extras': extras}

def sources(entries):
    for entry in entries.values():
        yield from entry.get('sources', [])
        yield from sources(entry.get('kinds', {}))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--select-only', action='store_true', help='write source paths as JSON for remote extraction')
    args = p.parse_args()
    with (args.archive / 'manifest.tsv').open() as f:
        paths = {row['path'] for row in csv.DictReader(f, delimiter='\t')}
    spec = recipe(paths)
    selected = sorted(set(sources(spec['core'])) | set(sources(spec['extras'])))
    if args.select_only:
        args.output.write_text(json.dumps(selected)); return
    args.output.mkdir(parents=True, exist_ok=True)
    files = {}
    for path in selected:
        file = hashlib.sha256(path.encode()).hexdigest()[:16] + '.ogg'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(args.archive / 'files' / path),
                        '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-ar', '32000', '-ac', '1',
                        '-c:a', 'libvorbis', '-q:a', '3', str(args.output / file)], check=True)
        files[path] = file
    def manifest(entries):
        output = {}
        for event, entry in entries.items():
            item = {k: v for k, v in entry.items() if k not in ('sources', 'kinds')}
            clips = entry.get('sources', [])
            if clips:
                item['file'] = files[clips[0]]
                if len(clips) > 1: item['variants'] = [files[path] for path in clips[1:]]
            if 'kinds' in entry: item['kinds'] = manifest(entry['kinds'])
            output[event] = item
        return output
    for key, filename in [('core', 'pack.json'), ('extras', 'extras.json')]:
        (args.output / filename).write_text(json.dumps({'name': 'Warcraft III', 'sounds': manifest(spec[key])}, indent=2) + '\n')
    (args.output / 'sources.json').write_text(json.dumps(files, indent=2) + '\n')
    print(f'Prepared {len(files)} clips in {args.output}')

if __name__ == '__main__': main()
