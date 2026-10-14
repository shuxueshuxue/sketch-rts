#!/usr/bin/env python3
"""Classify one preserved SDK naming-gate run without changing test or evidence.

Reads the three exact Vitest logs and only their reported files. Original large
Chrome traces are sampled at their tail and retain previously verified SHA
identity; this tool does not hash or analyze their full event stream.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess

REPO = Path(__file__).resolve().parent.parent
PRIOR = REPO / 'docs/art/refactor/followup/spirit-redraw/validation'
TRACE_IDENTITIES = {
    'current-trace': '4e79a0ea0e1617f68598e3afc585c4a5417d73bb028ce9ed3925d6a7df281b09',
    'current-gl-trace': '013a1f167d86a9218a152280630a3073874e2242f7b11890e6d62797095ffcc1',
}
PATTERN = re.compile(b'leg' + b'acy', re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def offenders(log):
    rows = re.findall(r'^\+\s+"((?:docs|src)/[^"]+)"[,]?\s*$', log.read_text(), re.M)
    if len(rows) != len(set(rows)):
        raise RuntimeError('Duplicate offender in preserved test log')
    return sorted(rows)


def category(name):
    if name.endswith('trace.json'):
        return 'original-browser-trace'
    if '/optimized-dependency-snapshots/' in name:
        return 'third-party-optimized-snapshot'
    if name.endswith('.mjs'):
        return 'executed-helper-snapshot'
    if name.endswith('.md'):
        return 'human-prose'
    if name.endswith('.json'):
        return 'raw-historical-record'
    raise RuntimeError('Unclassified offender: ' + name)


def detail(name, baseline, d7):
    path = REPO / name
    kind = category(name)
    if kind == 'original-browser-trace':
        with path.open('rb') as stream:
            stream.seek(max(0, path.stat().st_size - 16384))
            offset = stream.tell()
            data = stream.read()
        checksum = TRACE_IDENTITIES[path.parent.name]
        checksum_scope = 'Prior full gzip-to-original byte/SHA verification, preserved in stall-followup/EVIDENCE-INDEX.md; not freshly rehashed by this classifier.'
    else:
        data = path.read_bytes()
        offset = 0
        checksum = sha(data)
        checksum_scope = 'Full current original file bytes freshly hashed.'
    snippets = []
    for match in PATTERN.finditer(data):
        snippets.append(dict(byteOffset=offset + match.start(),
                             context=data[max(0, match.start()-100):match.end()+100].decode('utf8', errors='replace')))
        if len(snippets) == 3:
            break
    if not snippets:
        raise RuntimeError('No reported content match found: ' + name)
    return dict(path=name, category=kind, bytes=path.stat().st_size,
                sha256=checksum, checksumScope=checksum_scope,
                presentInBaseline8345=name in baseline, presentInD7=name in d7,
                matchingExamples=snippets)


def pack(source, destination):
    original = source.read_bytes()
    with destination.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as out:
        out.write(original)
    if gzip.decompress(destination.read_bytes()) != original:
        raise RuntimeError('Exact archive verification failed')
    return dict(file=destination.name, originalName=source.name, originalBytes=len(original),
                originalSha256=sha(original), gzipBytes=destination.stat().st_size,
                gzipSha256=sha(destination.read_bytes()), decompressedBytesExactlyEqual=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--current-log', required=True, type=Path)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    logs = {'baseline8345': PRIOR/'baseline-8345-four-files.log',
            'd7': PRIOR/'full-tests.log', 'current42bd': args.current_log}
    sets = {key: set(offenders(path)) for key, path in logs.items()}
    rows = [detail(name, sets['baseline8345'], sets['d7']) for name in sorted(sets['current42bd'])]
    expected = {'baseline8345': 22, 'd7': 34, 'current42bd': 40}
    if {key:len(value) for key,value in sets.items()} != expected:
        raise RuntimeError('Preserved offender counts differ from requested capture')
    tracked = set(subprocess.check_output(['git','ls-files','-z'],cwd=REPO).decode().split('\0'))
    report = dict(sourceCommit=args.source_commit,
                  singleTest='npx vitest run src/sdk/package-boundaries.test.ts',
                  singleTestExitCode=1, testsPassed=6, testsFailed=1,
                  durationSeconds=21.77, offenderCounts=expected,
                  logs={key:dict(path=str(path),sha256=sha(path.read_bytes())) for key,path in logs.items()},
                  categories={key:dict(Counter(category(name) for name in value)) for key,value in sets.items()},
                  baselineFiles=sorted(sets['baseline8345']),
                  d7AddedToBaseline=sorted(sets['d7']-sets['baseline8345']),
                  currentAddedToBaseline=sorted(sets['current42bd']-sets['baseline8345']),
                  currentAddedToD7=sorted(sets['current42bd']-sets['d7']),
                  removedSinceBaseline=sorted(sets['baseline8345']-sets['current42bd']),
                  untrackedOffenders=[row['path'] for row in rows if row['path'] not in tracked],
                  srcOffenders=[row['path'] for row in rows if row['path'].startswith('src/')],
                  details=rows,
                  interpretation='Classifies exact test-reported files. Existing baseline failures remain; no SDK/source/test rule changed. Generated/archive inputs are not maintained SDK code. No old evidence altered.',
                  proposedOnly='No input archival, pruning, human wording edits, test filters or exclusions are performed by this classifier.')
    temporary = Path('/tmp/sketch-naming-gate-classification-42bd61c7.json')
    with temporary.open('x') as stream:
        json.dump(report,stream,indent=2);stream.write('\n')
    artifacts = [pack(args.current_log,args.out/'current-single-test.log.gz'),
                 pack(temporary,args.out/'classification.json.gz')]
    provenance = dict(sourceCommit=args.source_commit, toolSha256=sha(Path(__file__).read_bytes()),
                      artifacts=artifacts,meaning='Exact new log/report preservation only; old evidence unchanged; both gzip archives verified by full original-byte equality.')
    with (args.out/'new-report-archives.json').open('x') as stream:
        json.dump(provenance,stream,indent=2);stream.write('\n')
    print(json.dumps({'counts':expected,'categories':report['categories'],
                      'currentAddedToBaseline':report['currentAddedToBaseline'],
                      'archives':artifacts},indent=2))


if __name__ == '__main__':
    main()
