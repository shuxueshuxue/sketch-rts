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
CONTROL = Path('/workspace/sketch-rts-root-aimed-c64d-fixed-control')
MANIFEST = json.loads((D / 'ROOT-COMBINED-SOURCE-EQUIVALENCE.json').read_text())
CGROUP = Path('/sys/fs/cgroup')

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def memory():
    return {'max': int((CGROUP / 'memory.max').read_text()),
            'current': int((CGROUP / 'memory.current').read_text()),
            'events': (CGROUP / 'memory.events').read_text()}

def source_exact():
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=CONTROL, text=True).strip() == MANIFEST['head']
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=CONTROL, text=True) == ''
    for item in MANIFEST['files']:
        assert hashlib.sha256((CONTROL / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']

checks = [
    ('combined-48', 768, ['node', 'node_modules/vitest/vitest.mjs', 'run', '--pool=forks',
      '--maxWorkers=1', '--minWorkers=1', '--no-file-parallelism',
      'src/ai/policy/script-runner-aimed-cast.test.ts',
      'src/ai/bootstrap_1/ground-evacuation.test.ts',
      'src/ai/policy/naval-dock-return.test.ts',
      'src/ai/bootstrap_1/landed-combat.test.ts']),
    ('combined-tsc', 1024, ['node', 'node_modules/typescript/bin/tsc', '--noEmit']),
]

receipts = []
for name, heap, command in checks:
    saved = D / (name + '-receipt.json')
    if saved.exists():
        prior = json.loads(saved.read_text())
        assert prior['exit'] == 0 and prior['head'] == MANIFEST['head']
        assert hashlib.sha256((D / (name + '.log')).read_bytes()).hexdigest() == prior['logSHA256']
        source_exact()
        receipts.append(prior)
        print(json.dumps({'reusedExactCompletedCheck': name, 'head': prior['head']}), flush=True)
        continue
    before = memory()
    if before['max'] - before['current'] < 2 * 1024**3:
        gate = {'atUTC': now(), 'stage': name, 'state': 'guard-not-spawned', 'memory': before,
                'requiredRawHeadroomBytes': 2 * 1024**3, 'noNewNodeGameOrCompiler': True,
                'completedChecks': receipts}
        (D / (name + '-resource-gate-' + str(time.time_ns()) + '.json')).write_text(json.dumps(gate, indent=2) + '\n')
        print(json.dumps(gate), flush=True)
        sys.exit(75)
    source_exact()
    env = os.environ.copy()
    env['NODE_OPTIONS'] = '--max-old-space-size=' + str(heap)
    started = now()
    t = time.monotonic()
    with (D / (name + '.log')).open('xb') as log:
        result = subprocess.run(command, cwd=CONTROL, env=env, stdout=log, stderr=subprocess.STDOUT)
    ended = now()
    source_exact()
    receipt = {'name': name, 'head': MANIFEST['head'], 'command': command, 'heapMiB': heap, 'startedAtUTC': started,
        'endedAtUTC': ended, 'elapsedSeconds': time.monotonic() - t, 'exit': result.returncode,
        'before': before, 'after': memory(), 'all1502SelectedSourceGitBoundPrePostExact': True,
        'childrenPeakRSSKiB': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
        'logSHA256': hashlib.sha256((D / (name + '.log')).read_bytes()).hexdigest()}
    receipts.append(receipt)
    (D / (name + '-receipt.json')).write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt), flush=True)
    if result.returncode:
        sys.exit(result.returncode)

summary = {'atUTC': now(), 'head': MANIFEST['head'], 'sequential': receipts,
    'distinctContractCases': 48,
    'caseCounting': '25 aimed-order contracts plus 23 unchanged landed/dock/evacuation intersections; repeat invocations are not additional unique cases.',
    'notACompleteMatchOrAcceptance': True}
(D / 'ROOT-COMBINED-VALIDATION.json').write_text(json.dumps(summary, indent=2) + '\n')
