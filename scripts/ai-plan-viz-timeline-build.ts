import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const input = process.argv[2] ?? '/tmp/ai-plan-viz-timeline/capture.json';
const out = process.argv[3] ?? 'docs/ai/plan-viz';
const data = JSON.parse(readFileSync(input, 'utf8'));
const nodes: unknown[] = [], lookup = new Map<string, number>();
const thinks = data.thinks.map(({ trace, claims }: any) => {
  const { nodes: source, ...rest } = trace;
  return { ...rest, nodes: source.map((node: unknown) => {
    const key = JSON.stringify(node);
    if (!lookup.has(key)) { lookup.set(key, nodes.length); nodes.push(node); }
    return lookup.get(key);
  }), claims };
});
const { thinks: _raw, ...world } = data;
const js = (name: string, value: unknown) => '/* Real room observation; provenance in timeline-summary.json. */\nwindow.' + name + ' = ' + JSON.stringify(value).replaceAll('<', '\\u003c') + ';\n';
for (const [file, name, value] of [
  ['timeline-data.js', 'PLAN_TIMELINE', { ...world, thinks }],
  ['timeline-nodes.js', 'PLAN_TIMELINE_NODES', nodes],
] as const) {
  const content = js(name, value);
  if (Buffer.byteLength(content) > 1_500_000) throw new Error(`${file} exceeds repository file limit; split the functional data, not the evidence.`);
  writeFileSync(join(out, file), content);
}
writeFileSync(join(out, 'timeline-summary.json'), JSON.stringify({ provenance: data.provenance,
  frames: data.frames.length, thinks: thinks.length, nodeVersions: nodes.length,
  deaths: data.events.filter((e: any) => e.type === 'death').length,
  buildingsLost: data.events.filter((e: any) => e.type === 'building-loss').length,
  inferredReviews: data.events.filter((e: any) => e.attribution?.assessment === 'review').length,
  limitations: ['效用分解、方法选择、预计到达、预期效果及抢占交接尚无正式数据。',
    '伤亡时间/位置与致命击打来源是观察事实；目标/阶段归因与疑似异常分类为推断。',
    '消失的目标只标记记录释放，不推断为完成、失败或被抢占。',
    '实际路径每秒采样；虚线仅为记录目标方向，不冒充寻路计划。'],
}, null, 2) + '\n');
console.log(JSON.stringify({ thinks: thinks.length, nodeVersions: nodes.length, bytes: [JSON.stringify(world).length, JSON.stringify(nodes).length] }));
