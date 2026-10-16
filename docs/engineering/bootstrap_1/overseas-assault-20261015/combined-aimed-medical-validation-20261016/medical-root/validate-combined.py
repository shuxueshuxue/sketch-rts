import datetime
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import time

D = Path(__file__).parent
M = json.loads((D / 'SOURCE-EQUIVALENCE.json').read_text())
ROOT = Path(M['control'])
CG = Path('/sys/fs/cgroup')

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def memory():
    return {'max': int((CG / 'memory.max').read_text()),
            'current': int((CG / 'memory.current').read_text()),
            'events': (CG / 'memory.events').read_text()}

def exact():
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == M['head']
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True) == ''
    for item in M['files']:
        assert hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']

common = ['node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--maxWorkers=1',
          '--minWorkers=1', '--no-file-parallelism', '--reporter=default', '--reporter=json']
checks = [
    ('medical-prefix-and-landed-19', 768, 2 * 1024**3,
     common + ['--outputFile=' + str(D / 'medical-prefix-and-landed-19.json'),
       'src/ai/bootstrap_1/medical-safe-prefix.test.ts', 'src/ai/bootstrap_1/landed-combat.test.ts']),
    ('aimed-two-actual', 512, 1024**3,
     common + ['--outputFile=' + str(D / 'aimed-two-actual.json'),
       'src/ai/policy/script-runner-aimed-cast.test.ts', '--testNamePattern', 'actual374']),
    ('combined-tsc', 1024, 2 * 1024**3, ['node_modules/typescript/bin/tsc', '--noEmit']),
]
receipts = []
for name, heap, required, args in checks:
    output = D / (name + '-receipt.json')
    if output.exists():
        prior = json.loads(output.read_text())
        assert prior['exit'] == 0 and prior['head'] == M['head']
        assert hashlib.sha256((D / (name + '.log')).read_bytes()).hexdigest() == prior['logSHA256']
        exact()
        receipts.append(prior)
        print(json.dumps({'reusedExactCompletedCheck': name}), flush=True)
        continue
    before = memory()
    if before['max'] - before['current'] < required:
        gate = {'atUTC': now(), 'name': name, 'state': 'guard-not-spawned',
                'memory': before, 'requiredRawHeadroom': required, 'noNewNodeOrGame': True}
        (D / (name + '-gate-' + str(time.time_ns()) + '.json')).write_text(json.dumps(gate, indent=2) + '\n')
        print(json.dumps(gate), flush=True)
        sys.exit(75)
    exact()
    started = now()
    t = time.monotonic()
    cmd = ['node', '--max-old-space-size=' + str(heap)] + args
    print(json.dumps({'starting': name, 'atUTC': started, 'rawHeadroom': before['max'] - before['current']}), flush=True)
    with (D / (name + '.log')).open('xb') as log:
        code = subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT).returncode
    exact()
    receipt = {'head': M['head'], 'name': name, 'command': cmd, 'heapMiB': heap,
        'startedAtUTC': started, 'endedAtUTC': now(), 'elapsedSeconds': time.monotonic() - t,
        'exit': code, 'before': before, 'after': memory(), 'all1507SelectedSourcePrePostExact': True,
        'childrenPeakRSSKiB': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
        'logSHA256': hashlib.sha256((D / (name + '.log')).read_bytes()).hexdigest()}
    output.write_text(json.dumps(receipt, indent=2) + '\n')
    receipts.append(receipt)
    print(json.dumps(receipt), flush=True)
    if code:
        sys.exit(code)

summary = {'atUTC': now(), 'head': M['head'], 'sequential': receipts,
    'currentHeadActualRelevantContracts': 21,
    'sameEarlierRootCaseIDsRetested': 14,
    'newMedicalPrefixCaseIDs': 7,
    'uniqueRootCoverageIncludingPrior48UnchangedContracts': 55,
    'counting': 'Current19=7prefix+12landed, then2actualaimed; retained earlier root48 coverage supplies34 other unchanged contracts. Repeated runs are not additional distinct cases.',
    'component61And600BelongTo641bSource': True,
    'completeMatchForThisCombinedSourceNotYetRun': True}
(D / 'COMBINED-VALIDATION.json').write_text(json.dumps(summary, indent=2) + '\n')
