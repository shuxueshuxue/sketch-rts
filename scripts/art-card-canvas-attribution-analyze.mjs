/** Offline integrity and attribution analysis. Does not paint or start a browser. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const arg = key => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const input = resolve(arg('--input') ?? 'docs/art/refactor/followup/card-streaming/latency-investigation/canvas-attribution/proof.json');
const folder = dirname(input), output = resolve(arg('--out') ?? resolve(folder, 'analysis.json'));
const report = resolve(arg('--report') ?? resolve(folder, 'report.md'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proofBytes = await readFile(input), manifestFile = resolve(folder, 'corpus-manifest.json'), manifestBytes = await readFile(manifestFile);
const proof = JSON.parse(proofBytes), manifest = JSON.parse(manifestBytes), violations = [];
let traceComparison;
try {
  const traceFile = resolve(folder, '../trace-analysis/compact.json'), traceBytes = await readFile(traceFile), trace = JSON.parse(traceBytes);
  traceComparison = { file: traceFile, sha256: hash(traceBytes), sameSource: trace.sourceCommit === proof.sourceCommit,
    sourceCommit: trace.sourceCommit, originalTraceSha256: trace.input.traceSha256,
    longCpuGets: trace.coverage.allLongCpuGet, largestGet: trace.largestGet, largestCopy: trace.largestCopy };
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const check = (condition, message) => { if (!condition) violations.push(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tolerance = 1e-5;
const distribution = values => {
  if (!values.length) return { samples: 0 };
  const sorted = [...values].sort((a, b) => a - b), percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { samples: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1) };
};
const timings = ['paintSubmissionMs', 'smallReadMs', 'fullRead1Ms', 'fullRead2Ms', 'allReadWallMs', 'paintAndAllReadsWallMs'];
const summarize = rows => Object.fromEntries(timings.map(key => [key, distribution(rows.map(row => row[key]))]));
check(proof.completed && proof.validation?.passed, 'Original run did not pass');
check(proof.errors.length === 0 && proof.failed.length === 0, 'Original run has browser/network errors');
check(proof.world.disposed && proof.world.glError === 0, 'World disposal/GL check failed');
check(proof.finalState.sealed && !proof.finalState.capturing && proof.finalState.liveWorldLayers === 0
  && proof.finalState.ownedOriginalRgbaBytes === 0 && proof.finalState.replayBaselineBytes === 0, 'Replay lifetime or baseline release invalid');
check(proof.originalCaptureOwnedBytesExcludedFromReplay === true, 'Original RGBA not released before replay');
check(proof.validation.changedSourceFiles.length === 0, 'Original run reports changing client source');
check(same(proof.allClientSourceSha256, manifest.allClientSourceSha256), 'Proof/manifest client source SHA mismatch');
check(same(proof.supportSha256, manifest.supportSha256), 'Proof/manifest helper SHA mismatch');
check(proof.sourceCommit === manifest.sourceCommit, 'Proof/manifest commit mismatch');

const helperChecks = [];
for (const [file, expectedSha256] of Object.entries(proof.supportSha256)) {
  // Use the archived files actually used by this run. Current scripts/source
  // can legitimately change after a completed capture and are not an oracle.
  const archivedFile = resolve(folder, file.split('/').at(-1)), sha256 = hash(await readFile(archivedFile));
  helperChecks.push({ file, archivedFile, expectedSha256, sha256, passed: sha256 === expectedSha256 });
  check(sha256 === expectedSha256, `Archived helper SHA differs: ${file}`);
}
let currentSourceChecks;
if (process.argv.includes('--verify-current-source')) {
  currentSourceChecks = [];
  for (const [file, expectedSha256] of Object.entries(proof.allClientSourceSha256)) {
    const sha256 = hash(await readFile(resolve(proof.sourceRoot, file)));
    currentSourceChecks.push({ file, sha256, passed: sha256 === expectedSha256 });
  }
  check(currentSourceChecks.every(row => row.passed), 'Optional current client source differs from captured source');
}
const corpusChecks = [], sampleByIndex = new Map(), facts = [];
let totalCorpusBytes = 0, alphaZeroNonzeroRgbPixels = 0;
for (const sample of manifest.samples) {
  const image = manifest.images.find(row => row.key === sample.key), captured = proof.corpus.find(row => row.index === sample.index);
  const bytes = await readFile(resolve(folder, sample.file)), sha256 = hash(bytes), expectedBytes = sample.width * sample.height * 4;
  const callbackSourceSha256 = hash(sample.callbackSource);
  check(!sampleByIndex.has(sample.index), `Duplicate sample index${sample.index}`); sampleByIndex.set(sample.index, sample);
  check(image && captured, `Missing image/proof sample${sample.index}`);
  check(image && image.file === sample.file && image.width === sample.width && image.height === sample.height
    && image.sourceSize === sample.width && image.sha256 === sha256 && image.byteLength === expectedBytes, `Image metadata mismatch${sample.index}`);
  check(captured && same(captured, sample), `Proof/manifest actual sample facts differ${sample.index}`);
  check(bytes.length === expectedBytes && bytes.length === sample.byteLength && sha256 === sample.sha256
    && sha256 === sample.originalSha256, `Original full RGBA SHA/size mismatch${sample.index}`);
  check(callbackSourceSha256 === sample.callbackSourceSha256, `Callback source SHA mismatch${sample.index}`);
  check(sample.size === sample.width && sample.width === sample.height && sample.width === sample.density * sample.tileSize
    && sample.rowOrientation === 'top-down' && sample.maskFlipYForCanvasMiss === true, `Source domain/orientation mismatch${sample.index}`);
  check(sample.actual.actualCanvasMiss && sample.actual.cacheMisses === 1 && sample.actual.cacheHits === 0
    && sample.actual.uploadedLayers === 1 && sample.actual.noExtraReadback && sample.actual.rgbaCopiedBeforeProductionRowFlip,
    `Sample is not an unchanged actual Canvas-miss read${sample.index}`);
  check(sample.contextAttributes?.willReadFrequently === true, `Canvas context hint changed${sample.index}`);
  check(Math.abs(sample.rawN - sample.n) < tolerance && Math.abs(sample.now * 60 / 1000 - sample.n) < tolerance
    && sample.tick === Math.floor(sample.n / 3), `Actual original n/now/tick mismatch${sample.index}`);
  check(sample.unit?.id === sample.id && sample.key.startsWith(`${sample.unit.kind}:`), `Unit/key facts mismatch${sample.index}`);
  check(sample.actual.firstActualCanvasPaintForKey === (sample.before.priorActualCanvasPaintsForKey === 0), `First-paint history mismatch${sample.index}`);
  const pixel = point => bytes.subarray((point.y * sample.width + point.x) * 4, (point.y * sample.width + point.x) * 4 + 4);
  for (const [label, point] of Object.entries({ interior: sample.points.interior, corner: sample.points.transparentCorner })) {
    if (!point) continue;
    check(Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0
      && point.x < sample.width && point.y < sample.height && same(Array.from(pixel(point)), point.rgba), `Invalid small-read point${sample.index}/${label}`);
    check(label === 'interior' ? point.rgba[3] > 0 : point.rgba.every(value => value === 0), `Small-read point semantics mismatch${sample.index}/${label}`);
  }
  let alphaPositive = 0, transparentRgb = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset + 3]) alphaPositive++;
    else if (bytes[offset] || bytes[offset + 1] || bytes[offset + 2]) transparentRgb++;
  }
  totalCorpusBytes += bytes.length; alphaZeroNonzeroRgbPixels += transparentRgb;
  corpusChecks.push({ index: sample.index, key: sample.key, kind: sample.unit.kind, n: sample.n,
    width: sample.width, bytes: bytes.length, sha256, callbackSourceSha256,
    alphaPositivePixels: alphaPositive, alphaCoverage: alphaPositive / (sample.width * sample.height), alphaZeroNonzeroRgbPixels: transparentRgb });
  facts.push({ index: sample.index, key: sample.key, id: sample.id, n: sample.n, now: sample.now, tick: sample.tick,
    density: sample.density, tileSize: sample.tileSize, matrix: sample.matrix, unit: sample.unit,
    before: sample.before, actual: sample.actual, callbackSourceSha256 });
}
check(new Set(manifest.samples.map(sample => sample.key)).size === manifest.samples.length, 'Duplicate captured pose key');
const byN = Object.fromEntries(proof.capture.captureNs.map(n => [n, manifest.samples.filter(sample => sample.n === n).length]));
check(same(byN, proof.captureResult.byN), 'Capture quotas/actual n differ');
check(manifest.samples.length === proof.captureResult.samples && totalCorpusBytes === proof.captureResult.ownedOriginalRgbaBytes, 'Capture sample count/buffer census mismatch');

const allRows = proof.experiments.flatMap(experiment => experiment.rows), initialRows = allRows.filter(row => row.phase === 'initial-replay');
const balancedRows = allRows.filter(row => row.phase === 'balanced-round' && row.status === 'measured');
const expectedOrders = [['A', 'B', 'D', 'C'], ['C', 'D', 'B', 'A'], ['B', 'C', 'A', 'D'], ['D', 'A', 'C', 'B']];
const positions = {}, perSample = [];
for (const experiment of proof.experiments) {
  const sample = sampleByIndex.get(experiment.index);
  check(sample && experiment.passed, `Missing/failed experiment${experiment.index}/${experiment.round}`);
  const expected = experiment.phase === 'initial-replay' ? ['A'] : expectedOrders[experiment.round % 4];
  check(same(experiment.rows.map(row => row.arm), expected), `Mode order differs${experiment.index}/${experiment.round}`);
  for (let position = 0; position < experiment.rows.length; position++) {
    const row = experiment.rows[position];
    check(row.status === 'measured' && row.passed && row.key === sample.key && row.index === sample.index, `Row identity/proof mismatch${row.index}/${row.round}/${row.arm}`);
    check(Math.abs(row.allReadWallMs - row.smallReadMs - row.fullRead1Ms - row.fullRead2Ms) < tolerance
      && Math.abs(row.paintAndAllReadsWallMs - row.paintSubmissionMs - row.allReadWallMs) < tolerance,
      `Read total loses/multiplies work${row.index}/${row.round}/${row.arm}`);
    const d = row.arm === 'D', small = row.arm === 'B' || row.arm === 'C';
    check(row.fullReadCount === (d ? 2 : 1) && row.smallReadCount === (small ? 1 : 0)
      && row.fullReadAllocatedBytes === sample.byteLength * (d ? 2 : 1)
      && row.smallReadAllocatedBytes === (small ? 4 : 0) && row.firstReadHeldUntilFinalRead === d,
      `Read/allocation contract differs${row.index}/${row.round}/${row.arm}`);
    check(row.firstSha256 === sample.sha256 && row.finalSha256 === sample.sha256
      && row.firstRgbaComparison.passed && row.firstRgbaComparison.changedChannels === 0 && row.firstRgbaComparison.maximum === 0
      && row.finalRgbaComparison.passed && row.finalRgbaComparison.changedChannels === 0 && row.finalRgbaComparison.maximum === 0,
      `Actual original full RGBA differs${row.index}/${row.round}/${row.arm}`);
    if (small) check(row.smallRgbaComparison.passed && row.smallRgbaComparison.changedChannels === 0
      && same(row.point, row.arm === 'B' ? sample.points.interior : sample.points.transparentCorner), `Small region differs${row.index}/${row.round}/${row.arm}`);
    if (experiment.phase === 'balanced-round') {
      const key = `${row.index}:${row.arm}`; positions[key] ??= [0, 0, 0, 0]; positions[key][position]++;
    }
  }
}
const indices = manifest.samples.map(sample => sample.index);
check(same(proof.experiments.filter(experiment => experiment.phase === 'initial-replay').map(experiment => experiment.index), indices), 'Initial replay case order differs');
for (let round = 0; round < proof.rounds; round++) {
  const sequence = proof.experiments.filter(experiment => experiment.round === round).map(experiment => experiment.index);
  check(same(sequence, round % 2 ? [...indices].reverse() : indices), `Case direction differs round${round}`);
}
for (const counts of Object.values(positions)) check(counts.every(count => count === proof.rounds / 4), 'Mode positions are not balanced per asset');
for (const sample of manifest.samples) {
  const rows = balancedRows.filter(row => row.index === sample.index), arms = {};
  for (const arm of ['A', 'B', 'C', 'D']) {
    const selected = rows.filter(row => row.arm === arm); check(selected.length === proof.rounds, `Unfair sample arm count${sample.index}/${arm}`);
    arms[arm] = summarize(selected);
  }
  perSample.push({ index: sample.index, key: sample.key, kind: sample.unit.kind, n: sample.n, width: sample.width, arms });
}
const arms = Object.fromEntries(['A', 'B', 'C', 'D'].map(arm => [arm, summarize(balancedRows.filter(row => row.arm === arm))]));
const paired = Object.fromEntries(['B', 'C', 'D'].map(arm => {
  const read = [], total = [];
  for (const experiment of proof.experiments.filter(experiment => experiment.phase === 'balanced-round')) {
    const a = experiment.rows.find(row => row.arm === 'A'), b = experiment.rows.find(row => row.arm === arm);
    read.push(b.allReadWallMs - a.allReadWallMs); total.push(b.paintAndAllReadsWallMs - a.paintAndAllReadsWallMs);
  }
  return [arm, { readMinusA: distribution(read), paintAndReadMinusA: distribution(total) }];
}));
function group(field) {
  return [...new Set(manifest.samples.map(sample => field === 'width' ? sample.width : sample.unit.kind))].map(value => {
    const selected = manifest.samples.filter(sample => (field === 'width' ? sample.width : sample.unit.kind) === value), selectedIndices = new Set(selected.map(sample => sample.index));
    return { [field]: value, cases: selected.length,
      arms: Object.fromEntries(['A', 'B', 'C', 'D'].map(arm => [arm, summarize(balancedRows.filter(row => selectedIndices.has(row.index) && row.arm === arm))])) };
  });
}
const domains = group('width'), assets = group('kind');
const controls = proof.allocationControls.flatMap(control => control.rows);
check(controls.length === manifest.samples.length * proof.rounds && proof.allocationControls.every(control => control.passed)
  && controls.every(row => row.comparison.passed && row.comparison.changedChannels === 0), 'Allocation control verification failed');
const initial = { all: summarize(initialRows), rows: initialRows, firstCanvasDomains: initialRows.filter(row => row.firstCanvasDraw) };
const expectedKinds = proof.world.assetCoverage.authoredKinds, observedKinds = assets.map(asset => asset.kind), missingKinds = expectedKinds.filter(kind => !observedKinds.includes(kind));
const result = { schema: 1, input: { proof: input, sha256: hash(proofBytes), manifest: manifestFile, manifestSha256: hash(manifestBytes),
  sourceCommit: proof.sourceCommit, sourceClientDiffSha256: proof.sourceClientDiffSha256, clientSourceFiles: Object.keys(proof.allClientSourceSha256).length,
  capturedFactsSha256: hash(JSON.stringify(facts)), helperChecks }, validation: { passed: violations.length === 0, violations },
  traceComparison,
  currentSourceChecks, coverage: { samples: manifest.samples.length, rows: allRows.length, balancedRows: balancedRows.length,
    initialRows: initialRows.length, byN, observedKinds, missingKinds, domains: domains.map(domain => ({ width: domain.width, cases: domain.cases })),
    totalCorpusBytes, corpusMiB: totalCorpusBytes / 1024 ** 2, alphaZeroNonzeroRgbPixels,
    firstActualPaintCases: manifest.samples.filter(sample => sample.actual.firstActualCanvasPaintForKey).length,
    repeatedActualPaintCases: manifest.samples.filter(sample => !sample.actual.firstActualCanvasPaintForKey).length,
    uniqueCallbackSources: new Set(corpusChecks.map(row => row.callbackSourceSha256)).size,
    allStockUnitVariants: manifest.samples.every(sample => sample.unit.variant === null) },
  arms, paired, domains, assets, perSample, modePositions: positions, initial,
  allocationControls: { allocateMs: distribution(controls.map(row => row.allocateMs)),
    copyAndTouchMs: distribution(controls.map(row => row.copyAndTouchMs)),
    allocationAndCopyWallMs: distribution(controls.map(row => row.allocationAndCopyWallMs)) }, corpusChecks,
  actualOriginalBuffersReleasedBeforeReplay: proof.finalState.ownedOriginalRgbaBytes === 0,
  replayBaselinePeakBytes: proof.finalState.peakReplayBaselineBytes };
const f = value => value.toFixed(3), table = [];
for (const arm of ['A', 'B', 'C', 'D']) {
  const data = arms[arm]; table.push(`| ${arm} | ${f(data.paintSubmissionMs.meanMs)} | ${f(data.smallReadMs.meanMs)} | ${f(data.fullRead1Ms.meanMs)} | ${f(data.fullRead2Ms.meanMs)} | ${f(data.allReadWallMs.meanMs)} | ${f(data.paintAndAllReadsWallMs.meanMs)} | ${f(data.paintAndAllReadsWallMs.p95Ms)} |`);
}
const domainTable = domains.map(domain => `| ${domain.width} | ${domain.cases} | ${f(domain.arms.A.fullRead1Ms.meanMs)} | ${f(domain.arms.B.smallReadMs.meanMs)} + ${f(domain.arms.B.fullRead1Ms.meanMs)} | ${f(domain.arms.C.smallReadMs.meanMs)} + ${f(domain.arms.C.fullRead1Ms.meanMs)} | ${f(domain.arms.D.fullRead2Ms.meanMs)} |`).join('\n');
const assetTable = assets.map(asset => `| ${asset.kind} | ${asset.cases} | ${['A','B','C','D'].map(arm => f(asset.arms[arm].paintAndAllReadsWallMs.meanMs)).join(' | ')} |`).join('\n');
const reportText = `# 实际原像素的 Canvas 读取归因\n\n` +
`结果支持：这些实际姿态的完整读取主要承接 deferred Canvas 绘制/flush。先读一个内点或透明角点，会把约2.3ms工作移到1px读取，随后完整读取约0.4ms；总成本与原完整读取接近。小读取没有提供优化。此实验在 GPU 世界已销毁后执行，因此这批姿态的常规读取不需要活跃 GPU 队列即可出现；它没有复现或排除原游戏100–500ms长尾的 GC、同步等待或资源竞争。\n\n` +
`输入冻结为 \`${proof.sourceCommit}\`，[原始结果](proof.json)和[实际像素 manifest](corpus-manifest.json)不修改。[analysis.json](analysis.json)保存逐case/asset/domain配对及完整核验，[离线分析器](../../../../../../../scripts/art-card-canvas-attribution-analyze.mjs)可重新生成本报告。此次${violations.length === 0 ? '核验通过' : '核验失败'}：${manifest.samples.length}个唯一实际 Canvas miss，n116/135/158=${Object.values(byN).join('/')}，${allRows.length}模式记录；每个case每arm四轮、位置各一次、case顺序每轮正反交替。${Object.keys(proof.allClientSourceSha256).length}份client source SHA在proof/manifest一致，原run声明无client修改；${helperChecks.length}份实际使用并归档的helper按保存SHA重新核验，${corpusChecks.length}张完整原.bin与callback source SHA逐个通过。可选当前源校验${currentSourceChecks ? `检查${currentSourceChecks.length}个文件，差异${currentSourceChecks.filter(row => !row.passed).length}` : '未执行；历史核验不依赖后来修改的源代码'}。\n\n` +
`## 平衡轮：毫秒/一次真实姿态绘制\n\n` +
`每arm144个样本，以下均包含慢样本。full2无新增绘制，是实际测得的暖完整读取成本参考，不是理论或跨硬件下限。\n\n` +
`| 模式 | paint | 1px | full1 | full2 | 所有读取 | paint+所有读取 | 总p95 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${table.join('\n')}\n\n` +
`B/C的full下降没有减少工作：配对所有读取相对A均值分别${f(paired.B.readMinusA.meanMs)}/${f(paired.C.readMinusA.meanMs)}ms，总绘制+读取差${f(paired.B.paintAndReadMinusA.meanMs)}/${f(paired.C.paintAndReadMinusA.meanMs)}ms。D两次读取相加比A增加${f(paired.D.readMinusA.meanMs)}ms，不能将full2单独当生产成本。一次透明角1px同样承接大部分工作；只能说明当前实现与这些样本的行为，不能保证所有Canvas都整图flush。\n\n` +
`| 完整源域 | case数 | A full | B 1px+full | C 1px+full | D full2 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${domainTable}\n\n` +
`## 冷首样本与完整性\n\n` +
`初始复画${initialRows.length}条单列，未混入上述平衡统计；均值paint+read=${f(initial.all.paintAndAllReadsWallMs.meanMs)}ms。每个尺寸新建Canvas的首条分别为${initial.firstCanvasDomains.map(row => `case${row.index}（${sampleByIndex.get(row.index).width}px，paint ${f(row.paintSubmissionMs)}ms、read ${f(row.allReadWallMs)}ms、total ${f(row.paintAndAllReadsWallMs)}ms、canvasAcquire ${f(row.canvasAcquireMs)}ms）`).join('；')}。仅此首条是新Canvas域，不可把之后的initial case或平衡轮称为冷游戏测量。\n\n` +
`所有完整读取逐字节与实际游戏原getImageData的SHA相符，D的两个输出各核验；1px与实际原基线对应像素相符。基线取自生产翻行之前，top-down、density4、原512/704域，适用于Canvas miss的mask flipY=true。n/now/tick、unit id/kind/key及proof/manifest中的来源事实一致，回放RGBA未发生闭包漂移。${result.coverage.firstActualPaintCases}个key是该生命周期首次实际Canvas paint，${result.coverage.repeatedActualPaintCases}个已经画过。原数据中alpha0且非零RGB像素数${alphaZeroNonzeroRgbPixels}；比较仍覆盖全部RGBA分量，不能据这批Canvas输出声称额外覆盖了合成的透明彩色像素。\n\n` +
`完整corpus ${totalCorpusBytes}bytes（${f(totalCorpusBytes / 1024 ** 2)}MiB），实际捕获阶段持有这些原buffer，所以其world时间不是正式结果；实验前全部导出并释放，回放每次最多一张${proof.finalState.peakReplayBaselineBytes}bytes基线。D额外持有full1至full2返回，返回数组分配没有隐藏。独立allocate+copy/touch控制144次，均值allocate=${f(result.allocationControls.allocateMs.meanMs)}ms、copy/touch=${f(result.allocationControls.copyAndTouchMs.meanMs)}ms、总${f(result.allocationControls.allocationAndCopyWallMs.meanMs)}ms；这些在所有Canvas轮之后，未扣减getImageData成本。惰性零页、颜色转换和浏览器内部存储使该控制不能成为纯readback时间公式。\n\n` +
`## 资产覆盖和下一步\n\n` +
`本次实际采到${observedKinds.length}/20种，缺少${missingKinds.join('、')}。各case各arm数量、位置完全相同，所以这批样本内可公平配对；它不代表所有游戏美术或按战场人口加权。以下资产均值按其实际case等权，完整原始case统计见analysis。\n\n` +
`| 资产 | case数 | A总 | B总 | C总 | D总 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${assetTable}\n\n` +
`下一步优先寻找可证明的重绘/光栅化重复：原尺寸、颜色、pose与完整RGBA不变的复用才可能省掉这里的主要工作。仅插入1px flush不会提速。原大长尾另用现有trace对齐Canvas长call的主线程GC、Skia工作和通道等待；本工具已经移除GPU提交，没有队列对照，不足以替代该判断。mask微基准可以消费这份真实.bin，须验证两种flip与所有样本，不把Node时间等同浏览器或游戏帧收益。\n` +
(traceComparison?.sameSource ? `\n独立[同源trace摘要](../trace-analysis/compact.json)与常规Canvas归因方向一致：${traceComparison.longCpuGets.calls}个大于1ms的CPU get spans合计${f(traceComparison.longCpuGets.unionMs)}ms，已标记主线程Skia overlap ${f(traceComparison.longCpuGets.groups.mainSkia.unionMs)}ms；这些overlap不是额外可相加阶段，也不能将所有GPU进程活动判为Canvas等待。该trace最大get仅${f(traceComparison.largestGet.ms)}ms，未复现旧100ms以上read。另一个n${traceComparison.largestCopy.n}公开copy耗时${f(traceComparison.largestCopy.ms)}ms，其中主线程WaitForToken overlap ${f(traceComparison.largestCopy.mainWait.unionMs)}ms；这是需要分别调查的通道等待，不能用本工具约2.3ms平均flush归因覆盖。trace和本微实验的样本、observer与运行阶段不同，不直接合并百分比。\n` : '');
await writeFile(report, reportText);
check(hash(await readFile(input)) === hash(proofBytes) && hash(await readFile(manifestFile)) === hash(manifestBytes), 'Original raw input changed during offline analysis');
result.validation = { passed: violations.length === 0, violations };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, report, validation: result.validation, coverage: result.coverage,
  arms: Object.fromEntries(Object.entries(arms).map(([arm, data]) => [arm, {
    small: data.smallReadMs.meanMs, full1: data.fullRead1Ms.meanMs, full2: data.fullRead2Ms.meanMs,
    readTotal: data.allReadWallMs.meanMs, total: data.paintAndAllReadsWallMs.meanMs }])),
  domains: domains.map(domain => ({ width: domain.width, cases: domain.cases, A: domain.arms.A.allReadWallMs.meanMs,
    B: domain.arms.B.allReadWallMs.meanMs, C: domain.arms.C.allReadWallMs.meanMs, D2: domain.arms.D.fullRead2Ms.meanMs })) }));
if (violations.length) process.exitCode = 1;
