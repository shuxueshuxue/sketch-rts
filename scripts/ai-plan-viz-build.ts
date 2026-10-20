import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiPlanTrace } from '../src/ai/plan-trace';

// Plain classic JS (not fetch/modules) keeps the mockups usable through file://.
const input = process.argv[2] ?? '/tmp/ai-plan-viz-capture/capture.json';
const out = process.argv[3] ?? 'docs/ai/plan-viz';
const data = JSON.parse(readFileSync(input, 'utf8'));
writeFileSync(join(out, 'sample-data.js'), '/* Generated from a real native-room continuation. See README.md for provenance. */\nwindow.PLAN_VIZ_SAMPLE = '
  + JSON.stringify(data).replaceAll('<', '\\u003c') + ';\n');
const trace = data.frames[0].traces['player-4'] as AiPlanTrace;
writeFileSync(join(out, 'trace-example.json'), JSON.stringify(trace, null, 2) + '\n');
writeFileSync(join(out, 'capture-summary.json'), JSON.stringify({ provenance: data.provenance, performance: data.performance,
  frames: data.frames.map((frame: { tick: number; traces: Record<string, AiPlanTrace> }) => ({ tick: frame.tick,
    owners: Object.fromEntries(Object.entries(frame.traces).map(([owner, trace]) => [owner, {
      thinkTick: trace.tick, nodeCount: trace.nodes.length, roots: trace.nodes.filter(node => trace.roots.includes(node.id))
        .map(node => ({ id: node.id, kind: node.kind, status: node.status, reason: node.reasons[0]?.code })),
    }])),
  })),
}, null, 2) + '\n');
