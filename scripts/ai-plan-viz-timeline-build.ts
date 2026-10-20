import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';

const input = process.argv[2] ?? '/tmp/ai-plan-viz-timeline/capture.json';
const out = process.argv[3] ?? 'docs/ai/plan-viz';
const data = JSON.parse(readFileSync(input, 'utf8'));
const scope: {window: Record<string, any>} = {window: {}};
runInNewContext(readFileSync(join(out, 'timeline-model.js'), 'utf8'), scope);
const bands = scope.window.PLAN_TIMELINE_MODEL.bands(data.thinks.map((t: any) => t.trace), data.provenance.endTick);
if (data.ledgerSource) {
  const complete = bands.filter((b: any) => b.outcome === 'done' && !b.terminalAlreadyObserved && b.end - b.observedStart > 200)
    .sort((a: any, b: any) => (b.kind === 'island' || b.kind === 'expansion' ? 100 : 0) + new Set(b.segments.map((s: any) => s.stage)).size * 10
      - (a.kind === 'island' || a.kind === 'expansion' ? 100 : 0) - new Set(a.segments.map((s: any) => s.stage)).size * 10)[0];
  const interrupted = bands.find((b: any) => ['abandoned','failed'].includes(b.outcome) && !b.terminalAlreadyObserved)
    || bands.find((b: any) => b.segments.some((s: any) => s.status === 'blocked' && s.end - s.tick > 200));
  if (!complete || !interrupted || !bands.some((b: any) => new Set(b.segments.map((s: any) => s.stage)).size > 1))
    throw new Error('Choose a real match with a complete goal, interrupted/abandoned goal and observed phase changes.');
  const exampleScore = (e: any) => (e.attribution.disposition === 'normal' && e.ledger.classification.tags.includes('retreat-failed') ? 100 : 0)
    + (e.attribution.rootIds.length ? 10 : e.ledger.assignment.task ? 1 : 0);
  const event = (disposition: string) => data.events.filter((e: any) => e.attribution?.disposition === disposition)
    .sort((a: any, b: any) => exampleScore(b) - exampleScore(a))[0];
  const examples = [['normal','正常战损'],['suspicious','存疑阵亡'],['abnormal','异常阵亡'],['unattributed','未归因阵亡']]
    .flatMap(([key,label]) => { const found = event(key!); return found ? [[found,label]] : []; });
  const building = data.events.filter((e: any) => e.type === 'building-loss' && data.players[e.owner]).sort((a: any,b: any)=>(b.kind==='townHall'?100:b.kind==='shipyard'?50:0)-(a.kind==='townHall'?100:a.kind==='shipyard'?50:0))[0];
  if (!examples.length || !building) throw new Error('Missing real example events.');
  const stage = interrupted.segments.find((s: any) => s.status === 'blocked' && s.end - s.tick > 200);
  const goalTick = interrupted.end ?? stage?.tick ?? interrupted.observedStart;
  data.highlights = [
    {id:'goal-complete',label:'目标闭环',tick:complete.end,owner:complete.owner,bandKey:complete.key,range:{from:complete.observedStart-200,to:complete.end+200}},
    {id:'goal-interrupted',label:interrupted.outcome==='abandoned'?'目标放弃':'目标中断',tick:goalTick,owner:interrupted.owner,bandKey:interrupted.key,range:{from:goalTick-800,to:goalTick+500}},
    ...[...examples,[building,'建筑损失']].map(([e,label]: any[]) => ({id:e.id,label,eventId:e.id,tick:e.tick,owner:e.owner,range:{from:e.tick-600,to:e.tick+600}})),
  ];
  data.featuredTick=complete.end;data.featuredOwner=complete.owner;data.featuredBandKey=complete.key;
  data.goalStatistics={total:bands.length,completed:bands.filter((b: any)=>b.outcome==='done'&&!b.terminalAlreadyObserved).length,
    abandoned:bands.filter((b: any)=>['abandoned','failed'].includes(b.outcome)&&!b.terminalAlreadyObserved).length,
    phaseChanges:bands.reduce((n: number,b: any)=>n+Math.max(0,b.segments.length-1),0)};
}
const nodes: unknown[] = [], lookup = new Map<string, number>();
const thinks = data.thinks.map(({ trace, claims }: any) => {
  // The standalone sample uses ledger records once in the event index, rather than repeating incremental payloads.
  const { nodes: source, deathLedger: _ledger, ...rest } = trace;
  return { ...rest, nodes: source.map((node: unknown) => {
    const key = JSON.stringify(node);
    if (!lookup.has(key)) { lookup.set(key, nodes.length); nodes.push(node); }
    return lookup.get(key);
  }), claims };
});
const { thinks: _raw, ...world } = data;
const payload = JSON.stringify({ ...world, thinks, nodes });
const packed = gzipSync(payload, { level: 9 }).toString('base64');
const chunks = packed.match(/.{1,1000000}/g)!;
for (const file of readdirSync(out)) if (/^timeline-data(?:-\d+)?\.js$/.test(file) || file === 'timeline-nodes.js') unlinkSync(join(out, file));
const scripts = chunks.map((chunk, index) => {
  const file = `timeline-data-${index}.js`;
  writeFileSync(join(out, file), '/* Offline functional replay data, gzip/base64; regenerate with ai-plan-viz-timeline-build.ts. */\n'
    + 'window.PLAN_TIMELINE_PACK ??= [];\nwindow.PLAN_TIMELINE_PACK.push(' + JSON.stringify(chunk) + ');\n');
  return `<script src="${file}"></script>`;
}).join('');
const html = readFileSync(join(out, 'timeline.html'), 'utf8');
const scriptBlock = `<!-- timeline-payload -->${scripts}<!-- /timeline-payload --><script src="timeline-loader.js"></script>`;
writeFileSync(join(out, 'timeline.html'), html.includes('<!-- timeline-payload -->')
  ? html.replace(/<!-- timeline-payload -->[\s\S]*?<!-- \/timeline-payload --><script src="timeline-loader.js"><\/script>/, scriptBlock)
  : html.replace('<script src="timeline-data.js"></script><script src="timeline-nodes.js"></script>', scriptBlock));
writeFileSync(join(out, 'timeline-summary.json'), JSON.stringify({ provenance: data.provenance,
  highlights: data.highlights, goalStatistics: data.goalStatistics,
  frames: data.frames.length, thinks: thinks.length, nodeVersions: nodes.length, payloadBytes: Buffer.byteLength(payload), packedBytes: Math.ceil(packed.length * .75),
  deaths: data.events.filter((e: any) => e.type === 'death').length,
  normal: data.events.filter((e: any) => e.attribution?.disposition === 'normal').length,
  suspicious: data.events.filter((e: any) => e.attribution?.disposition === 'suspicious').length,
  abnormal: data.events.filter((e: any) => e.attribution?.disposition === 'abnormal').length,
  unattributed: data.events.filter((e: any) => e.attribution?.disposition === 'unattributed').length,
  buildingsLost: data.events.filter((e: any) => e.type === 'building-loss').length,
  ledgerSource: data.ledgerSource ?? null,
  limitations: ['效用分解、方法选择、预计到达、预期效果及抢占交接尚无正式数据。',
    '死亡分类直接读取同局死亡账本；账本中的推断归因保留原标记，不视为正式分配事实。',
    'v2 的正常、存疑、异常与未归因分桶互斥；子标签可以重叠，撤退失败标签不自动算异常。',
    '消失的目标只标记记录释放；只有明确的模块结果才能关联完成或放弃。',
    '实际路径来自世界采样；虚线仅为目标方向，不冒充寻路计划。'],
}, null, 2) + '\n');
console.log(JSON.stringify({ thinks: thinks.length, nodes: nodes.length, chunks: chunks.length, bytes: Buffer.byteLength(payload), packedBytes: Math.ceil(packed.length * .75) }));
