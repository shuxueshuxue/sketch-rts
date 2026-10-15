"""Fixed fresh-process contrasts; never run competing tests during this series."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

control, candidate, output = map(Path, sys.argv[1:4])
output.mkdir()  # Refuse overwrites.
(output/"series-source.py").write_bytes(Path(__file__).read_bytes())
tool = candidate / 'scripts/six-player-tick-probe.ts'
order = [('r1-A1', control, False), ('r1-B1', candidate, False),
         ('r1-B2', candidate, False), ('r1-A2', control, False),
         ('r2-B1', candidate, False), ('r2-A1', control, False),
         ('r2-A2', control, False), ('r2-B2', candidate, False),
         ('plain-A', control, True), ('plain-B', candidate, True)]
def environment():
    paths = ['/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu.stat', '/proc/loadavg']
    return {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'files': {p: Path(p).read_text() for p in paths if Path(p).exists()}}
plan = {'order': [(n, str(s), p) for n, s, p in order],
        'node': subprocess.check_output(['node', '--version'], text=True).strip(),
        'probeSha256': hashlib.sha256(tool.read_bytes()).hexdigest(),
        'heads': {str(s): subprocess.check_output(['git','-C',str(s),'rev-parse','HEAD'], text=True).strip()
                  for s in [control,candidate]},
        'method': '8 instrumented fresh-process arms; 2 plain calibration arms separate; all 14400 ticks, including cold tick 0 and outliers.'}
event_file=candidate/'docs/performance/sanity-simple-20261015/cow-events-predeclared.json'
if event_file.exists():
    plan['eventSelectionSha256']=hashlib.sha256(event_file.read_bytes()).hexdigest()
    (output/'event-selection.json').write_bytes(event_file.read_bytes())
(output/'plan.json').write_text(json.dumps(plan, indent=2))
journal = []
for name, source, plain in order:
    command = ['node', '--import', 'tsx', str(tool), '--source', str(source),
               '--ticks', '14400', '--out', str(output/name)] + (['--plain'] if plain else [])
    item = {'name': name, 'command': command, 'before': environment()}
    print('START', name, flush=True)
    started = time.monotonic()
    with (output/(name+'.log')).open('w') as log:
        process = subprocess.Popen(command, cwd=candidate, stdout=log, stderr=subprocess.STDOUT)
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
    item.update(returncode=process.returncode, wallSeconds=time.monotonic()-started, after=environment(),
                resource={'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,'maxRssKiB':usage.ru_maxrss,
                          'minorFaults':usage.ru_minflt,'majorFaults':usage.ru_majflt})
    journal.append(item)
    (output/'journal.json').write_text(json.dumps(journal, indent=2))
    if process.returncode:
        raise SystemExit(f'{name} failed; partial evidence retained')
    s = json.loads((output/name/'summary.json').read_text())
    print('DONE', name, json.dumps(s['timing']['wholeMs']), flush=True)
