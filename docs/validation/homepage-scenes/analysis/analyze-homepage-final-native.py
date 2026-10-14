#!/usr/bin/env python3
"""Read closed native browser captures; write analysis only, never run a browser."""
import gzip, hashlib, json, math
from pathlib import Path

BASE = Path('/workspace')
SETS = [
    ('same_art_age7', 'homepage-pirate-prewarm-abba'),
    ('fleet_cycle', 'homepage-pirate-prewarm-fleet-cycle'),
    ('woods_phase20', 'homepage-forest-prewarm-phase20-abba'),
]
METRICS = {'paintDrawSubmitMs': ('draw', True), 'renderSubmitMs': ('render', False), 'rafIntervalMs': ('raf', False), 'scriptMs': ('script', True)}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def summary(values):
    values = list(values)
    ordered = sorted(values)
    def q(p):
        return ordered[max(0, math.ceil(len(ordered) * p) - 1)] if ordered else None
    return dict(n=len(values), mean=sum(values) / len(values) if values else None,
                p50=q(.5), p95=q(.95), p99=q(.99), max=ordered[-1] if ordered else None,
                over50=sum(v > 50 for v in values), over100=sum(v > 100 for v in values))

def arrays(raw):
    return {name: [v['ms'] if keyed else v for v in raw[field]] for name, (field, keyed) in METRICS.items()}

def compact_remains(stats):
    return dict(compressedCacheBytes=stats['rasterCache']['bytes'], compressedCacheEntries=stats['rasterCache']['entries'],
                ownedCpuBytes=stats['ownedCpuBytes'], canvasBackingBytes=stats['canvasBackingBytes'],
                ownedGpuBytes=stats['ownedGpuBytes'], cards=stats['cards'], rasterizations=stats['rasterizations'])

inputs, datasets, windows, records = [], [], [], {}
for group, directory in SETS:
    root = BASE / directory
    proof_bytes = (root / 'proof.json').read_bytes()
    proof = json.loads(proof_bytes)
    inputs.append(dict(path=str(root / 'proof.json'), sha256=sha(proof_bytes), bytes=len(proof_bytes)))
    datasets.append(dict(group=group, root=str(root), sourceUnchanged=proof['unchanged'], sources=proof['sources'],
                         end=proof['end'], harnessSha256=proof['harnessSha256'], bootstrapSha256=proof['bootstrapSha256'],
                         executedTransformHashes=proof['transforms'], limits=proof['limits']))
    for item in proof['results']:
        raw_path = root / item['raw']['file']
        compressed = raw_path.read_bytes()
        unpacked = gzip.decompress(compressed)
        record = json.loads(unpacked)
        raw = record['raw']
        input_info = dict(path=str(raw_path), compressedSha256=sha(compressed), uncompressedSha256=sha(unpacked),
                          compressedBytes=len(compressed), uncompressedBytes=len(unpacked))
        inputs.append(input_info)
        ident = group + '/' + record['id']
        records[ident] = record
        samples = arrays(raw)
        calculated = {metric: summary(values) for metric, values in samples.items()}
        # Check the saved summaries against original raw values, not another summary.
        discrepancies = []
        for metric, values in calculated.items():
            for key, value in values.items():
                saved = item['summary'][metric][key]
                if value is None or saved is None:
                    equal = value == saved
                else:
                    equal = math.isclose(value, saved, rel_tol=1e-12, abs_tol=1e-8)
                if not equal:
                    discrepancies.append(dict(metric=metric, key=key, raw=value, saved=saved))
        startup = record['startup']
        early_indices = [i for i, draw in enumerate(startup['draw']) if 0 <= draw['age'] < 7]
        early_draw = [startup['draw'][i] for i in early_indices]
        early_render = [startup['render'][i] for i in early_indices] if len(startup['render']) == len(startup['draw']) else None
        prepares = [dict(wallMs=p['ms'], pageStartMs=p['start'], pageEndMs=p['end'],
                         remains=compact_remains(p['remains']),
                         preparedKeys=p.get('preparedRemainsKeys'),
                         preparedKeyCountFromCache=p['remains']['rasterCache']['entries']) for p in startup['prepare']]
        excluded = group == 'same_art_age7' and record['scene'] == 'woods'
        visible_markers = ['resourceHidden' in d and d['resourceHidden'] is True for d in early_draw]
        before_heap, after_heap = record['memoryBefore'], record['memoryAfter']
        windows.append(dict(
            key=ident, group=group, id=record['id'], label=record['label'], scene=record['scene'],
            comparisonEligible=not excluded and group != 'fleet_cycle',
            exclusionReason='Four woods windows did not start at comparable authored phases; preserve only as diagnostic observations.' if excluded else None,
            requestedStartAge=record.get('requestedStartAge', 7), phaseWindowMatched=record.get('phaseWindowMatched'),
            beforeAge=record['before']['age'], beforeSubmittedAge=record['before']['submittedAge'], beforeTick=record['before']['submittedTick'],
            afterAge=record['after']['age'], afterSubmittedAge=record['after']['submittedAge'], afterTick=record['after']['submittedTick'],
            firstDraw=raw['draw'][0] if raw['draw'] else None, lastDraw=raw['draw'][-1] if raw['draw'] else None,
            observedMs=raw.get('observedMs', record['observedMs']), summaries=calculated,
            savedSummaryDiscrepancies=discrepancies, rawInput=input_info, browser=record['browser'],
            errors=record['errors'], failures=record['failures'],
            startup=dict(prepare=prepares, navigationReadyPageMs=startup['navigationReadyMs'],
                         earlyAgeDefinition='Recorded draw-start age in [0,7); a draw may itself extend past 7 seconds.',
                         earlyDrawSummary=summary(d['ms'] for d in early_draw),
                         earlyRenderSummary=summary(early_render) if early_render is not None else None,
                         earlyDraws=early_draw, allStartupDraws=startup['draw'],
                         visibilityEvidence='Direct resourceHidden=true markers for every listed early draw.' if early_draw and all(visible_markers) else 'This capture did not save direct resource visibility/page timestamps; visibility is inferred from main.draw visualsReady gating after prepareHome awaits the resource panel.',
                         beforeMeasurementRemains=compact_remains(startup['remains'])),
            heap=dict(before=before_heap, after=after_heap,
                      usedDeltaBytes=after_heap['usedJSHeapSize']-before_heap['usedJSHeapSize'],
                      interpretation='Browser JS heap observation only; not allocated bytes, leak evidence, native memory or GPU memory.'),
        ))

pooled = []
for group, scene in [('same_art_age7', 'fleet'), ('same_art_age7', 'capital'), ('woods_phase20', 'woods')]:
    for label in ['baseline', 'candidate']:
        selected = [w for w in windows if w['group']==group and w['scene']==scene and w['label']==label]
        combined = {metric: [] for metric in METRICS}
        for window in selected:
            for metric, values in arrays(records[window['key']]['raw']).items():
                combined[metric].extend(values)
        pooled.append(dict(group=group, scene=scene, label=label, windowKeys=[w['key'] for w in selected],
                           summaries={metric: summary(values) for metric, values in combined.items()},
                           method='Concatenate original raw samples from the two windows, then compute nearest-rank quantiles; never average run p99.'))

comparisons = []
for group, scene in [('same_art_age7', 'fleet'), ('same_art_age7', 'capital'), ('woods_phase20', 'woods')]:
    a, b = [next(p for p in pooled if p['group']==group and p['scene']==scene and p['label']==label) for label in ['baseline','candidate']]
    delta = {}
    for metric in METRICS:
        old, new = a['summaries'][metric]['mean'], b['summaries'][metric]['mean']
        delta[metric] = dict(bMinusAMeanMs=new-old, observedMeanReductionPercent=100*(old-new)/old if old else None)
    comparisons.append(dict(group=group, scene=scene, pooledMeanDifferences=delta,
                            causalAndGeneralityLimit='Two A and two B windows, varying naturally sampled ticks; no confidence/significance or hardware FPS claim.'))

cycle = next(w for w in windows if w['group']=='fleet_cycle')
cycle_raw = records[cycle['key']]['raw']
cycle_peaks = sorted(cycle_raw['draw'], key=lambda d: d['ms'], reverse=True)[:10]
forest_visible_peaks = sorted([dict(windowKey=w['key'], **d) for w in windows if w['group']=='woods_phase20' for d in w['startup']['allStartupDraws']], key=lambda d:d['ms'], reverse=True)[:10]
report = dict(
    schemaVersion=1, analysisScript=dict(path=str(Path(__file__).resolve()), sha256=sha(Path(__file__).read_bytes())),
    inputFiles=inputs, datasets=datasets, windows=windows, pooled=pooled, comparisons=comparisons,
    method=dict(quantiles='nearest rank: sorted[ceil(n*p)-1]', units='milliseconds except storage bytes/ages seconds',
                gpuTimingMeasured=False, forcedGc=False, rawFilesModified=False, browserRerun=False,
                note='DrawSubmit is inclusive of renderer submission and bounded script work; renderSubmit is nested, not additive. Native rAF is a separate observed schedule.'),
    exclusions=[w['key'] for w in windows if w['exclusionReason']],
    remainsStorageInterpretation='A/B storage below is before/after optimization at two defined checkpoints (prepare completion, measurement start). No end-of-window remains stats were captured, and compressedCacheBytes is already included in ownedCpuBytes; do not add them again. CanvasBacking and ownedGPU are card-subsystem counters, not process RSS or total GPU memory.',
    fleetPrewarm=dict(futureCorpses=7, uniquePreparedRasterEntries=12, otherScenesFutureRemainsPrepared=False,
                      evidence='Candidate fleet prepare-end cache has 12 entries, 304640 compressed bytes, zero visible remains cards and zero remains GPU bytes; city/woods prepare-end remains caches are zero.'),
    fullCycle=dict(windowKey=cycle['key'], topDraws=cycle_peaks,
                   bridgeAlignedPeak=next(d for d in cycle_raw['draw'] if abs(d['age']-24.2475)<1e-4),
                   loopZeroPeak=next(d for d in cycle_raw['draw'] if d['age']==0),
                   attribution='Temporal alignment only. No per-layer evidence here establishes a shader, GC or scheduler cause.'),
    forestInitialVisiblePeaks=forest_visible_peaks,
    conclusions=[
        'Fleet same-art age7 pooled draw CPU submission improves, but 115.8/165.9ms maxima remain; preparation/startup costs are separately retained.',
        'Fleet pooled native rAF does not improve with draw CPU submission; do not claim delivered FPS gains.',
        'The first four woods windows are excluded from benefit comparisons because their authored phase starts differ.',
        'Woods phase20 four windows are phase-matched; mean differences are small and mixed across pairs, not a demonstrated general speedup.',
        'Forest has an initial visible 13664.6ms draw at age2.289 with resourceHidden=true; this is not pure loading and its cause is not established.',
        'Fleet full cycle still contains a 582.2ms bridge-aligned draw and a 150.8ms loop-start draw.',
    ],
)
(BASE/'homepage-final-native-analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')

fmt=lambda x: '—' if x is None else f'{x:.3f}'
def stats_row(label, stats):
    return '| '+label+' | '+str(stats['n'])+' | '+' | '.join(fmt(stats[k]) for k in ['mean','p50','p95','p99','max'])+' | '+str(stats['over50'])+' |'
header='| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
lines=['# 首页最终原生窗口分析', '',
       '仅重算闭合捕获的原始 gzip 数据，没有运行浏览器、测试或改变源码/HEAD。数字为毫秒，nearest-rank 分位数；pooled 分布拼接原始样本后重算，未平均 p99。完整精度、来源 SHA、原始样本位置和准备/内存检查点见同名 JSON。', '',
       '环境：Headless Chromium 151.0.7922.173、SwiftShader、1440×900、deviceScaleFactor=1。draw/render 是 CPU 墙钟通过提交，render 包含在 draw 中，不可相加；rAF 为原生调度间隔。未测 GPU 计时器，未强制 GC，不将这些数字泛化为硬件 FPS。', '',
       '## 有效对照及排除', '',
       '船队与王城 A/B 使用同一演出内容，各两 A、两 B，原生自然等待约 7 秒后观测 15 秒；小幅起点与采样抖动逐窗保留。森林原四窗起点不匹配，全部排除收益比较；新森林自然等待第 20 秒的四窗 phaseWindowMatched 均为 true。', '',
       '| 分组/窗口 | 实际 before age | submitted age | after age | submitted after | 比较用途 |', '| --- | ---: | ---: | ---: | ---: | --- |']
for w in windows:
    use='排除：相位误配' if w['exclusionReason'] else '完整周期观察' if w['group']=='fleet_cycle' else '有效 A/B'
    lines.append('| '+w['key']+' | '+' | '.join(fmt(w[k]) for k in ['beforeAge','beforeSubmittedAge','afterAge','afterSubmittedAge'])+' | '+use+' |')
for metric, title in [('paintDrawSubmitMs','逐窗口绘制 CPU 提交'),('renderSubmitMs','逐窗口 WorldPresentation CPU 提交'),('rafIntervalMs','逐窗口原生 rAF 间隔'),('scriptMs','逐窗口有限演出脚本成本')]:
    lines += ['', '## '+title, '', header]
    for w in windows: lines.append(stats_row(w['key'],w['summaries'][metric]))
lines += ['', '## 两 A / 两 B 原始样本 pooled', '', '各项 n 独立计数。森林仅拼接 phase20 的四窗；原误配四窗没有进入 pooled。', '']
for metric in METRICS:
    lines += ['', '**'+metric+'**', '', header]
    for p in pooled: lines.append(stats_row(p['group']+'/'+p['scene']+'/'+p['label'], p['summaries'][metric]))
lines += ['', '## 准备墙钟和准备后初次可见绘制分列', '',
          'prepare 是 WorldPresentation.prepare 的等待墙钟，包含当前场景的模型/资源与任何预热，不是单独预热函数的自耗时。下表初可见统计按记录的 draw-start 演出年龄 [0,7) 取样，一次绘制本身可能结束在 7 秒之后。旧捕获未直接保存 pageNow/resourceHidden；“可见”依据 main.draw 在 prepareHome/resourcePanel 完成后才开放的 visualsReady 门禁推断。phase20 新记录有直接 resourceHidden=true 标记。初可见的大尖峰不能藏进纯加载成本。', '',
          '| 窗口 | prepare wall ms | 初可见 draw n | mean | p50 | p95 | p99 | max | >50 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
for w in windows:
    s=w['startup']['earlyDrawSummary'];pre='/'.join(fmt(p['wallMs']) for p in w['startup']['prepare'])
    lines.append('| '+w['key']+' | '+pre+' | '+str(s['n'])+' | '+' | '.join(fmt(s[k]) for k in ['mean','p50','p95','p99','max'])+' | '+str(s['over50'])+' |')
lines += ['', '## 尸体卡片存储：优化前后与检查点', '',
          '下表为 A/B 源在 prepare 结束、正式窗口开始时的 remains 子系统计数，不是窗口结束值。原数据没有保存窗口结束 remains 统计。compressed 已包含在 ownedCPU，不能重复相加；CanvasBacking 是画布字节计数，ownedGPU 是本卡片子系统存储估计，不代表 RSS/总 GPU 内存。', '',
          '| 窗口/检查点 | prepared/cache entries | compressed bytes | ownedCPU bytes | CanvasBacking bytes | ownedGPU bytes | 可见卡片 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
for w in windows:
    if w['scene']!='fleet': continue
    rows=[('prepare-end',p['remains']) for p in w['startup']['prepare']]+[('window-start',w['startup']['beforeMeasurementRemains'])]
    for checkpoint,s in rows:
        lines.append('| '+w['key']+'/'+checkpoint+' | '+' | '.join(str(s[k]) for k in ['compressedCacheEntries','compressedCacheBytes','ownedCpuBytes','canvasBackingBytes','ownedGpuBytes','cards'])+' |')
lines += ['', '海战候选准备七具已知未来尸体配方，去重后 12 个密度卡片缓存项；prepare 结束压缩缓存 304,640 bytes、ownedCPU 437,760 bytes、CanvasBacking 1,310,720 bytes，尸体可见卡片/GPU 为零。王城和森林的 prepare-end remains cache entries 均为零，没有预热其他场景的未来尸体。候选海战窗口前约 7 秒，ownedCPU 699,904 / CanvasBacking 1,310,720 / ownedGPU 1,048,572 bytes；A 同检查点为 321,728 / 262,144 / 1,048,572 bytes，不能只报告移走后的帧成本而略去新增存储。', '',
          '## 浏览器 JS heap 原始变化', '', 'heap before/after 不是累计分配量，不作为泄漏证据，也不含原生/GPU 全部存储。', '',
          '| 窗口 | before used bytes | after used bytes | delta bytes |', '| --- | ---: | ---: | ---: |']
for w in windows:
    h=w['heap'];lines.append(f"| {w['key']} | {h['before']['usedJSHeapSize']} | {h['after']['usedJSHeapSize']} | {h['usedDeltaBytes']} |")
lines += ['', '## 未解决的可见尖峰与结论边界', '',
          '森林 phase20 基线首轮在演出年龄 2.289 秒有 **13,664.600 ms** 的绘制提交，resourceHidden=true；它发生在 prepare 完成、画面可见后。对应 prepare wall 为 1,495.400 ms。其他初可见样本与每窗完整列表在 JSON 中保留；原因没有逐层闭合，不能归因为 GC、shader 或调度。', '',
          '海战候选完整 60 秒原生观察仍含 **age24.2475 / tick484 / 582.200 ms**（与接舷桥开始出现的时点对齐），以及下一循环 **age0 / tick0 / 150.800 ms**。这是时间对应，不是桥 shader/GC 原因证明。该周期脚本计数 118、绘制计数 119，重建循环的首帧脚本没有单独计入，未补造样本。', '',
          '船队 pooled 两 A 与两 B 都有 63 次绘制，CPU 提交分布改善，但候选仍有 115.800 / 165.900 ms 尖峰，且 pooled 原生 rAF 并未改善。王城只报告该组观察趋势，不把差异归因为海战尸体预热。公平的森林 phase20 平均差异小且两对方向混合，不足以支持通用提速。未给置信/显著性或全程流畅结论。', '',
          '## 可复现来源', '',
          '- 分析工具：`/workspace/analyze-homepage-final-native.py`；运行 `python3 /workspace/analyze-homepage-final-native.py` 只重算外部文件。',
          '- 原数据：`/workspace/homepage-pirate-prewarm-abba/`、`/workspace/homepage-pirate-prewarm-fleet-cycle/`、`/workspace/homepage-forest-prewarm-phase20-abba/`。所有 proof/raw 压缩及解压 SHA 已在 JSON 记录。',
          '- 原 ABBA/周期 harness：`verify-startup.mjs`，SHA256 `a1b249c91921b21d18ec21ff16a33754698c9ae4ff8475f740c21e38e9ceb741`。',
          '- 公平森林 harness：`verify-startup-phase-v2.mjs`，SHA256 `838852a01886e8e25a3c7ca168cf0dca8d03a161dc2461b595ed518297d78205`。',
          '- 工具 bootstrap、执行过的源码变换、A/B 全体逐文件 source SHA 和采集前后清单均来自各 proof，完整保存在 JSON；sourceUnchanged 为 true。A/B HEAD 都是 `a13878465d7de94311476c7c591b18fc3a39bcc4`，候选以未提交字节区别，不能只凭 HEAD 判为同源。',
          '- 本分析没有改写任何 raw、生产源码或 HEAD；不运行新增测试/浏览器，不归档全目录。最终 manifest 与 PR 由 root 闭合。', '']
(BASE/'homepage-final-native-analysis.md').write_text('\n'.join(lines))
print(json.dumps({'windows':len(windows),'excludedWoods':len(report['exclusions']),'pooledFleetDrawN':[p['summaries']['paintDrawSubmitMs']['n'] for p in pooled if p['scene']=='fleet'], 'summaryDiscrepancies':sum(len(w['savedSummaryDiscrepancies']) for w in windows), 'output':['/workspace/homepage-final-native-analysis.json','/workspace/homepage-final-native-analysis.md']},ensure_ascii=False))
