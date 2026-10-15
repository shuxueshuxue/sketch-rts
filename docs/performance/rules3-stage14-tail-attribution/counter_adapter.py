"""Archive-only Stage14 original bucket counter verification.

No filesystem, subprocess, game, network, or module execution is performed.
raw(absolute_original_path) returns archived bytes.
source_oid(head, relative_source_path) returns authenticated portable Git blob OID.
The original live source claims are authenticated against captured source bytes
and Git; the present machine's live checkout is deliberately never consulted.
"""
import collections
import datetime
import gzip
import hashlib
import json
import math
import struct


def read_counter(raw, source_oid):
    T = '/tmp/terrain-bucket-allocation-count-v1-tools'
    O = '/tmp/terrain-bucket-allocation-count-v1'
    R = '/tmp/terrain-bucket-allocation-count-v1-independent-readback-v1'
    P = '/tmp/terrain-bucket-allocation-count-v1-preflight/tool-source-before'
    S = '/tmp/sketch-rts-cached-connectivity'
    N = '/tmp/whole-performance-abba-0ea-lazy-fields-r1/A1'
    H = '/workspace/whole-performance-abba-31-48e3d4/A1'
    HEAD = '0ea5beaee063c8443d66f7654333032b070d51ad'
    CMD = '771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997'
    INITIAL = '5375d4a54cf3e0cc1d4c614c4442b07118c1f1e0dd47b6ea96c73206c2b882c7'
    MANIFEST = '1e7fd434649c758e9ff720d42f2e789858d0197972e0ca6e2150e57e209731c1'
    cache = {}

    def need(ok, detail):
        if not ok:
            raise AssertionError(detail)

    def sha(data):
        return hashlib.sha256(data).hexdigest()

    def b(path):
        need(isinstance(path, str) and path.startswith('/'), ('absolute archive path', path))
        if path not in cache:
            value = raw(path)
            need(isinstance(value, bytes), ('raw returns bytes', path))
            cache[path] = value
        return cache[path]

    def doc(path):
        return json.loads(b(path))

    def gz(path):
        return json.loads(gzip.decompress(b(path)))

    def pin(data, row, label):
        need(len(data) == row['bytes'] and sha(data) == row['sha256'], label)

    def relative(path):
        return isinstance(path, str) and path and not path.startswith('/') and all(
            part not in ('', '.', '..') for part in path.split('/'))

    seal = doc(R + '/SOURCE-SEAL-01.json')
    need(seal['status'] == 'SOURCE_BEFORE_ANY_READER_ATTEMPT' and
         seal['readerExecuted'] is False and
         seal['priorGeneratorFailureRetainedWithoutSourceRewrites'] is True,
         'original reader pre-execution source seal')
    need(len(seal['files']) == len({r['path'] for r in seal['files']}) == 5,
         'five unique reader source files')
    for row in seal['files']:
        need(relative(row['path']), ('reader source path', row['path']))
        original = b(R + '/' + row['path'])
        pin(original, row, ('reader source seal', row['path']))
        for stage in ('source-before', 'source-after'):
            need(original == b(R + '/attempt-01/' + stage + '/' + row['path']),
                 ('reader source snapshot', stage, row['path']))

    pins = doc(T + '/tool-pins.json')
    need(b(T + '/tool-pins.json') == b(P + '/tool-pins.json') ==
         b(R + '/frozen-tool-pins.reference.json'), 'original frozen pins bytes')
    need(len(pins['files']) == len({r['path'] for r in pins['files']}) == 22,
         '22 unique frozen tool payloads')
    for row in pins['files']:
        need(relative(row['path']), ('tool relative path', row['path']))
        data = b(T + '/' + row['path'])
        need(data == b(P + '/' + row['path']), ('tool/preflight full bytes', row['path']))
        pin(data, row, ('tool frozen pin', row['path']))

    env = doc(O + '/environment.json')
    stats = doc(O + '/summary.json')
    closure = doc(T + '/oracle-source-closure.json')
    claimed = doc(T + '/bucket-allocation-analysis.json')
    report = doc(R + '/report.json')
    expected = {'ticks': 14400, 'finalTick': 14400, 'rulesVersion': 3,
                'checksumVersion': 18, 'finalChecksum': '7d94a5e8',
                'commandLogBytes': 618189, 'frames': 14400,
                'nonEmptyFrames': 612, 'winner': None, 'commandLogSha256': CMD}
    for key, value in expected.items():
        need(stats[key] == value, ('actual final/semantic', key))
    need(closure['complete'] is True and closure['expected'] == expected and
         closure['commandSha256'] == CMD and closure['sourceCount'] == 241,
         'producer semantic closure')
    need(stats['final'] == {'units': 109, 'buildings': 51}, 'final entities')
    need(stats['planningTicks']['count'] == 960 and
         stats['planningTicks']['allOnMod15Zero'] is True and
         stats['planningTicks']['allFiveOwners'] is True, 'owner phase summary')
    need(env['gitHead'] == HEAD and env['gitStatus'] == '' and
         env['options'] == {'source': S, 'ticks': 14400, 'out': O},
         'actual diagnostic source/options')
    need(doc(N + '/environment.json')['gitHead'] == HEAD and
         doc(H + '/environment.json')['gitHead'] ==
         '31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8', 'reference epochs')

    commands = gzip.decompress(b(O + '/command-frames.jsonl.gz'))
    initial = gzip.decompress(b(O + '/initial-snapshot.json.gz'))
    need(len(commands) == 618189 and sha(commands) == CMD and
         commands == gzip.decompress(b(N + '/command-frames.jsonl.gz')) ==
         gzip.decompress(b(H + '/command-frames.jsonl.gz')),
         'literal complete original/native/historical commands')
    need(len(initial) == 147891 and sha(initial) == INITIAL and
         initial == gzip.decompress(b(N + '/initial-snapshot.json.gz')) ==
         gzip.decompress(b(H + '/initial-snapshot.json.gz')),
         'initial full bytes')
    frames = [json.loads(line) for line in commands.splitlines()]
    need([r['tick'] for r in frames] == list(range(14400)) and
         sum(r['frame'] is not None for r in frames) == 612,
         'all original command frame order/counts')

    sources = gz(O + '/source-inputs.json.gz')
    need(sources == gz(N + '/source-inputs.json.gz') ==
         gz(T + '/source-before-inputs.json.gz') ==
         gz(T + '/prepared-source-before-inputs.json.gz') and len(sources) == 241,
         'actual/native/before/prepared source full archive equality')
    entries = env['sourceInputs']
    need(len(entries) == len({r['path'] for r in entries}) == 241 and
         set(sources) == {r['path'] for r in entries}, 'unique source input graph')
    rows = []
    captured = {}
    authenticated = []
    closure_rows = {r['path']: r for r in closure['originalSourceRows']}
    need(len(closure_rows) == len(closure['originalSourceRows']) == 241,
         'producer source closure count')
    for entry in entries:
        path = entry['path']
        need(relative(path) and path.startswith('src/'), ('source path', path))
        data = sources[path].encode()
        pin(data, entry, ('source manifest row', path))
        row = {'path': path, 'bytes': len(data), 'sha256': sha(data)}
        rows.append(row)
        oid = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        need(source_oid(HEAD, path) == oid, ('portable Git blob authentication', path))
        producer = closure_rows[path]
        need(producer['bytes'] == len(data) and producer['sha256'] == sha(data) and
             producer['gitBlob'] == oid and
             producer['beforeActualCaptureReferenceCurrentAndFixedGitFullBytesEqual'] is True,
             ('producer source claim', path))
        captured[S + '/' + path] = data
        authenticated.append({**row, 'gitBlob': oid, 'allFullBytesEqual': True})
    manifest = sha(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode())
    need(manifest == env['sourceManifestSha256'] == closure['sourceManifestSha256'] ==
         MANIFEST and sum(r['bytes'] for r in rows) == 2811947, 'source manifest/bytes')

    # Authenticate the original reader's five retained Git receipts. This never
    # invokes Git: portable object authentication above is the independent root.
    git_rows = report['gitCommands']
    need(len(git_rows) == 5, 'five original Git receipts')
    git_expected = [(['rev-parse', 'HEAD'], b'', (HEAD + '\n').encode()),
                    (['status', '--porcelain'], b'', b''),
                    (['cat-file', '--batch'],
                     ''.join(HEAD + ':' + r['path'] + '\n' for r in rows).encode(), None),
                    (['rev-parse', 'HEAD'], b'', (HEAD + '\n').encode()),
                    (['status', '--porcelain'], b'', b'')]
    batch = None
    for index, (receipt, (args, stdin, stdout)) in enumerate(zip(git_rows, git_expected), 1):
        prefix = 'git-%02d' % index
        need(receipt == doc(R + '/' + prefix + '.execution.json') and
             receipt['argv'] == ['git', '-C', S, *args] and receipt['exitCode'] == 0,
             ('original Git command receipt', index))
        streams = {}
        for name in ('stdin', 'stdout', 'stderr'):
            info = receipt[name]
            need(relative(info['path']), ('Git stream path', index, name))
            stored = b(R + '/' + info['path'])
            need(len(stored) == info['storedBytes'] and sha(stored) == info['storedSha256'],
                 ('stored Git stream bytes', index, name))
            need(type(info['gzip']) is bool, ('Git compression marker', index, name))
            stream = gzip.decompress(stored) if info['gzip'] else stored
            pin(stream, info, ('full original Git stream', index, name))
            streams[name] = stream
        need(streams['stdin'] == stdin and streams['stderr'] == b'',
             ('Git request/stderr', index))
        if stdout is not None:
            need(streams['stdout'] == stdout, ('Git HEAD/status stdout', index))
        else:
            batch = streams['stdout']
    offset = 0
    for row in authenticated:
        end = batch.index(b'\n', offset)
        header = batch[offset:end].split()
        need(len(header) == 3 and header[1] == b'blob', 'Git batch header')
        size = int(header[2]); offset = end + 1
        data = batch[offset:offset + size]; offset += size
        need(batch[offset:offset + 1] == b'\n', 'Git batch separator'); offset += 1
        need(size == row['bytes'] and data == sources[row['path']].encode() and
             header[0].decode() == row['gitBlob'], ('Git batch source full bytes', row['path']))
    need(offset == len(batch), 'Git batch exhausted')

    pairs = [('probe-source.ts', 'bucket-allocation-tick-probe.ts'),
             ('bucket-allocation-sidecar-source.ts', 'bucket-allocation-sidecar.ts'),
             ('bucket-allocation-edits.json', 'bucket-allocation-edits.json'),
             ('original-v5-probe-source.ts', 'original-six-player-tick-probe.ts'),
             ('original-v5-focused-helper.ts', 'six-player-focused-instrumentation.ts'),
             ('tool-package.json', 'package.json'),
             ('instrumented-terrain.ts', 'instrumented-terrain.ts.draft')]
    for actual, frozen in pairs:
        need(b(O + '/' + actual) == b(T + '/' + frozen) == b(P + '/' + frozen),
             ('actual/counter/preflight frozen source', actual))
    need(env['probeSha256'] == sha(b(O + '/probe-source.ts')) and
         env['bundleSha256'] == sha(b(O + '/runtime.mjs')), 'bundle/probe hashes')
    hooks = sorted((r['path'], sorted(r['functions'])) for r in stats['method']['hooks'])
    need(hooks == [('src/ai/planner-context.ts', ['planAiOwnerCommandEntries']),
                   ('src/ai/runtime.ts', ['planPresetAiRuntimeCommands']),
                   ('src/shared/sim.ts', ['snapshotGame', 'stepGame'])],
         'original four hook boundaries')
    ticks = gz(O + '/ticks.json.gz')
    reference_ticks = gz(N + '/ticks.json.gz')
    need(len(ticks) == len(reference_ticks) == 14400, 'all ticks')
    owners_expected = [('enemy', 'v9_archer'), ('enemy2', 'v9_archer'),
                       ('player-4', 'v9_knight'), ('player-5', 'v9_summoner'),
                       ('player-6', 'v9_knight')]
    planning = 0
    for index, (actual, reference) in enumerate(zip(ticks, reference_ticks)):
        need(all(actual[k] == reference[k] for k in
                 ('tick', 'tickAfter', 'mod15', 'units', 'buildings')) and
             actual['tick'] == index and actual['tickAfter'] == index + 1 and
             actual['mod15'] == index % 15, ('tick/entities/phase', index))
        owners = [(v['owner'], v['version']) for v in actual['ownerPlans']]
        need(owners == [(v['owner'], v['version']) for v in reference['ownerPlans']],
             ('owner/version/order', index))
        need(owners == (owners_expected if index % 15 == 0 else []),
             ('five actual planning owners', index))
        planning += bool(owners)
    need(planning == 960 and ticks[-1]['units'] == 109 and
         ticks[-1]['buildings'] == 51, 'full entity/planning history')

    meta = doc(O + '/bucket-allocation-capture.json')
    need(meta['schema'] == 1 and meta['acceptance'] is False and
         meta['capacity'] == 1024 and meta['stride'] == 4 and
         meta['tickAfter'] == -1 and meta['phaseAfter'] == 3,
         'capture lifetime/capacity')
    need(meta['rowFields'] == ['ordinal', 'tick', 'phase', 'walkLength'] and
         meta['counterFields'] == ['coldBranchHits', 'overflow', 'begunTicks',
                                  'endedTicks', 'boundaryMismatch'], 'numeric layout')
    need(meta['hooks'] == [{'path': 'src/shared/terrain.ts',
                           'functions': ['grow:state.buckets-cold-initialization']}],
         'one exact allocation hook')
    need(type(meta['littleEndian']) is bool, 'record endianness')
    endian = '<' if meta['littleEndian'] else '>'
    rowraw = b(O + '/bucket-allocation-rows.i32.bin')
    countraw = b(O + '/bucket-allocation-counters.u32.bin')
    pin(rowraw, meta['files']['rows'], 'raw row pin')
    pin(countraw, meta['files']['counters'], 'raw counter pin')
    need(len(rowraw) == meta['rowCount'] * 16 and len(countraw) == 20,
         'raw numeric lengths')
    counts = list(struct.unpack(endian + '5I', countraw))
    need(counts == [meta['counters'][name] for name in meta['counterFields']],
         'raw counters/metadata')
    need(counts[1] == counts[4] == 0 and counts[2] == counts[3] == 14400 and
         counts[0] == meta['rowCount'] <= 1024, 'complete lifecycle/no overflow')
    events = [list(row) for row in struct.iter_unpack(endian + '4i', rowraw)]
    need([row[0] for row in events] == list(range(1, len(events) + 1)), 'raw ordinals')
    for ordinal, tick, phase, length in events:
        need(length > 0 and phase in (0, 1, 2, 3) and
             (0 <= tick < 14400 if phase == 2 else tick == -1), 'event fields')
    need(events == [[1, 0, 2, 103684], [2, 6990, 2, 103684]] and
         counts == [2, 0, 14400, 14400, 0], 'actual two cold initialization groups')
    need(rowraw == b(R + '/actual-rows.i32.bin') and
         countraw == b(R + '/actual-counters.u32.bin'), 'independent raw copies')
    records = [{'ordinal': i, 'tick': tick, 'phase': phase, 'walkLength': length,
                'mover': None, 'originalTypedArraysPerSuccessfulInitialization': 8,
                'originalTypedArrayPayloadBytes': 8 * length * 4}
               for i, tick, phase, length in events]
    groups = len(events)
    arrays = 8 * groups
    payload = sum(r['originalTypedArrayPayloadBytes'] for r in records)
    lengths = dict(collections.Counter(str(row[3]) for row in events))
    phases = dict(collections.Counter(str(row[2]) for row in events))
    need(claimed['complete'] is True and claimed['performanceAcceptance'] is False and
         claimed['records'] == records and claimed['observedColdInitializations'] == groups and
         claimed['originalSuccessfulBucketArrayCount'] == arrays and
         claimed['originalCumulativeTypedPayloadBytes'] == payload and
         claimed['lengthHistogram'] == lengths and claimed['phaseHistogram'] == phases,
         'producer independent numeric accounting')

    outer = doc(T + '/execution.json')
    native_exec = doc(T + '/native-execution.json')
    analysis_exec = doc(T + '/analysis-execution.json')
    command = doc(T + '/command.json')
    ac = doc(T + '/analysis-command.json')
    need(outer['complete'] is True and
         outer['exitCode'] == native_exec['exitCode'] == analysis_exec['exitCode'] == 0 and
         outer['native'] == native_exec and outer['analysis'] == analysis_exec,
         'successful original execution receipts')
    need(command['argv'] == doc(T + '/PLANNED-COMMAND.json')['nativeArgv'] and
         command['cwd'] == T and command['source'] == S and command['sourceHead'] == HEAD and
         command['ticks'] == 14400 and command['focusTicks'] == [] and
         command['acceptance'] is False, 'native command binding')
    need(command['wrapperSha256'] == sha(b(T + '/run-diagnostic.py')) and
         command['cpuBarrier'] == doc(T + '/all-tools-paused.json'), 'wrapper/barrier')
    need(command['startedUtc'] == outer['startedUtc'] <= native_exec['startedUtc'] <
         native_exec['endedUtc'] <= analysis_exec['startedUtc'] < analysis_exec['endedUtc'] <=
         outer['endedUtc'], 'native/analyzer chronology')
    for execution in (native_exec, analysis_exec):
        wall = (datetime.datetime.fromisoformat(execution['endedUtc']) -
                datetime.datetime.fromisoformat(execution['startedUtc'])).total_seconds()
        need(math.isclose(wall, execution['wallSeconds'], abs_tol=.002), 'original UTC/wall')
    need(ac['cwd'] == T and ac['argv'][1] == T + '/analyze-bucket-allocation.py',
         'original analyzer argv')
    need(b(T + '/stderr.log') == b(T + '/analysis-stderr.log') == b'' and
         b(T + '/stdout.log') == b(O + '/report.txt') + b'\n' and
         json.loads(b(T + '/analysis-stdout.log')) == claimed,
         'original stdout/stderr full bytes')

    expected_report = {'status': 'INDEPENDENT_ACTUAL_BUCKET_READBACK_PASS',
                       'complete': True, 'sourceHead': HEAD,
                       'readOnlyOriginalInputsUnchanged': True, 'sourceCount': 241,
                       'sourceBytes': 2811947, 'sourceManifestSha256': manifest,
                       'sourceClosureRows': authenticated, 'fullCommandLogBytes': len(commands),
                       'fullCommandLogSha256': sha(commands),
                       'literalInitialNativeHistoricalEqual': True,
                       'full14400FinalAndEntityOwnerPhaseChecksEqual': True,
                       'finalChecksum': '7d94a5e8',
                       'gameOrNodeEngineBuildTestsProfileExecutedByReader': False,
                       'rawEvents': events, 'records': records, 'actualColdGroups': groups,
                       'successfulOriginalTypedArrays': arrays,
                       'cumulativeOriginalTypedPayloadBytes': payload,
                       'lengthHistogram': lengths, 'phaseHistogram': phases,
                       'mover': None, 'moverNotCaptured': True,
                       'actualNativeExecution': native_exec,
                       'originalAnalyzerExecution': analysis_exec, 'actualNativeCommand': command}
    for key, value in expected_report.items():
        need(report[key] == value, ('independent report field', key))

    # Every original reader input pin is checked. The 241 historical live paths
    # resolve to source bytes captured in the original graph, independently
    # authenticated against portable Git above, rather than a live checkout.
    input_pins = report['allInputReadPins']
    paths = [row['path'] for row in input_pins]
    need(paths == sorted(set(paths)), 'unique sorted original input pins')
    source_pin_paths = set()
    for row in input_pins:
        path = row['path']
        if path.startswith(S + '/'):
            need(path in captured, ('historical live source pin', path))
            data = captured[path]
            source_pin_paths.add(path)
        else:
            data = b(path)
        pin(data, row, ('allInputReadPins full bytes', path))
    need(source_pin_paths == set(captured), 'all 241 historical live source pins')

    reader_exec = doc(R + '/attempt-01/execution.json')
    reader_command = doc(R + '/attempt-01/command.json')
    need(all(reader_exec[key] == value for key, value in reader_command.items()),
         'reader command/execution binding')
    need(reader_exec['exitCode'] == 0 and reader_exec['allSourceBeforeAfterEqual'] is True and
         reader_exec['within2MiB'] is True and reader_exec['reservePreserved'] is True and
         reader_exec['cwd'] == R and reader_exec['argv'][1:] == ['-B', R + '/readback.py'] and
         reader_exec['sourceSealSha256'] == sha(b(R + '/SOURCE-SEAL-01.json')),
         'sole original independent reader execution')
    need(reader_exec['stdoutSha256'] == sha(b(R + '/attempt-01/stdout.log')) and
         reader_exec['stderrSha256'] == sha(b(R + '/attempt-01/stderr.log')) and
         b(R + '/attempt-01/stderr.log') == b'', 'reader original log hashes')
    reader_stdout = json.loads(b(R + '/attempt-01/stdout.log'))
    for key in ('status', 'sourceCount', 'sourceBytes', 'actualColdGroups',
                'successfulOriginalTypedArrays', 'cumulativeOriginalTypedPayloadBytes',
                'records', 'lengthHistogram', 'phaseHistogram', 'readOnlyOriginalInputsUnchanged'):
        need(reader_stdout[key] == report[key], ('reader stdout/report', key))

    return {'status': 'ARCHIVE_ONLY_COUNTER_SOURCE_AND_RAW_READBACK_PASS',
            'sourceHead': HEAD, 'sourceCount': 241, 'sourceBytes': 2811947,
            'sourceManifestSha256': manifest, 'frozenToolPayloads': 22,
            'readerSourceFiles': 5, 'originalInputPinsVerified': len(input_pins),
            'portableGitSourceBlobsAuthenticated': len(authenticated),
            'historicalLivePinsAuthenticatedFromCapturedSources': len(source_pin_paths),
            'fullCommandLogBytes': len(commands), 'fullCommandLogSha256': CMD,
            'initialBytes': len(initial), 'initialSha256': INITIAL,
            'ticks': len(ticks), 'planningTicks': planning, 'nonPlanningTicks': 14400 - planning,
            'finalChecksum': stats['finalChecksum'], 'final': stats['final'],
            'rawEvents': events, 'rawCounters': counts, 'actualColdGroups': groups,
            'successfulOriginalTypedArrays': arrays,
            'cumulativeOriginalTypedPayloadBytes': payload,
            'lengthHistogram': lengths, 'phaseHistogram': phases,
            'mover': None, 'moverNotCaptured': True,
            'nativeExitCode': native_exec['exitCode'], 'originalAnalyzerExitCode': analysis_exec['exitCode'],
            'originalIndependentReaderExitCode': reader_exec['exitCode'],
            'engineExecutedByAdapter': False, 'currentLiveCheckoutReadByAdapter': False,
            'limitations': ['Only original successful bucket cold RHS entries; not grow/runtime counts.',
                           'Two groups have no recorded mover identity; no one-land/one-sea conclusion.',
                           'Cumulative typed payload excludes overhead and other sites; not live/peak/rate/GC or CPU benefit.',
                           'Sixteen arrays do not establish sixteen system malloc operations.',
                           'Standalone third 0ea diagnostic; excluded from two-head CPU/performance pools.',
                           'Historical live claims are authenticated from captured bytes and portable Git, not re-executed.']}
