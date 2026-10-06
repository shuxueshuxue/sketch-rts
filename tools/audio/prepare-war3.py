#!/usr/bin/env python3
"""Build a private, curated War3 pack from the owner's extracted archive.

No recordings are committed. Core events remain readable by older clients;
extras.json supplies naval sounds, spells and voices to the new runtime.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess

VOICES = {
    'worker': 'Units/Human/Peasant/Peasant',
    'footman': 'Units/Human/Footman/Footman',
    'lancer': 'Units/Human/Footman/Footman',
    'archer': 'Units/NightElf/Archer/Archer',
    'horseArcher': 'Units/NightElf/Archer/Archer',
    'sparkArcher': 'Units/NightElf/Archer/Archer',
    'knight': 'Units/Human/Knight/Knight',
    'raider': 'Units/Orc/Wolfrider/Wolfrider',
    'priest': 'Units/Human/Priest/Priest',
    'summoner': 'Units/Orc/Shaman/Shaman',
    'pyreCaller': 'Units/Orc/Shaman/Shaman',
    'witch': 'Units/Human/Sorceress/Sorceress',
    'ashHexer': 'Units/Human/Sorceress/Sorceress',
    'siegeRam': 'Units/Human/SteamTank/SteamTank',
    'ballista': 'Units/NightElf/Ballista/Ballista',
    'catapult': 'Units/Orc/Catapult/Catapult',
    'organGun': 'Units/Human/MortarTeam/MortarTeam',
    **{k: 'Units/Creeps/HumanTransportShip/Boat' for k in
       ('cutter', 'transport', 'warship', 'bombardShip', 'fireShip', 'carrier')},
}

def recipe(paths):
    def entry(path, volume=.7, **extra):
        if path not in paths:
            raise ValueError('Missing archive sound: ' + path)
        stem = re.sub(r'\d+(?=\.wav$)', '', path)
        siblings = [p for p in sorted(paths) if p != path and re.sub(r'\d+(?=\.wav$)', '', p) == stem]
        return {'sources': [path] + siblings[:2], 'volume': volume, 'pitch': .025, **extra}
    core = {
        'impact': entry('Sound/Units/Combat/MetalMediumBashFlesh1.wav', .55),
        'melee': entry('Sound/Units/Combat/MetalMediumSliceFlesh1.wav', .6),
        'arrowShot': entry('Abilities/Weapons/Arrow/ArrowAttack1.wav', .65),
        'arrowHit': entry('Abilities/Weapons/Arrow/ArrowImpact.wav', .6),
        'death': entry('Units/Human/Footman/FootmanDeath.wav', .6),
        'construction': entry('Sound/Buildings/Shared/BuildingPlacement.wav', .45),
        'built': entry('Sound/Interface/GoodJob.wav', .4, max=1),
        'buildingDown': entry('Sound/Buildings/Death/BuildingDeath.wav', .65),
        'click': entry('Sound/Interface/MouseClick1.wav', .4),
    }
    extras = {
        'select': {'volume': .55, 'pitch': 0, 'max': 1, 'kinds':
                   {k: entry(prefix + 'What1.wav', .55, pitch=0) for k, prefix in VOICES.items()}},
        'order': {'volume': .55, 'pitch': 0, 'max': 1, 'kinds':
                  {k: entry(prefix + 'Yes1.wav', .55, pitch=0) for k, prefix in VOICES.items()}},
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
    for kind, prefix in VOICES.items():
        folder = prefix.rsplit('/', 1)[0] + '/'
        deaths = sorted(p for p in paths if p.startswith(folder) and 'Death' in p and 'Explode' not in p)
        if deaths:
            core['death'].setdefault('kinds', {})[kind] = entry(deaths[0], .6)
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
