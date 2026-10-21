import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { PUBLIC_PUZZLES } from '../src/ai/strategy/puzzles/scenes';
import { runPublicPuzzle } from '../src/ai/strategy/puzzles/run';

const args = process.argv.slice(2);
const option = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const mode = option('--mode') ?? 'v9_knight';
if (!['witness', 'v9_knight', 'v9_archer', 'v9_summoner'].includes(mode)) throw new Error('Unknown room policy / witness');
const selected = PUBLIC_PUZZLES.filter(p => !option('--case') || `${p.key}/${p.variant}` === option('--case'));
if (!selected.length) throw new Error('No matching puzzle');
const out = resolve(option('--out') ?? `work/public-puzzles/${mode}`);
mkdirSync(out, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const aiTree = execFileSync('git', ['rev-parse', 'd4ca2668:src/ai/bootstrap_1'], { encoding: 'utf8' }).trim();
const actualAiTree = execFileSync('git', ['rev-parse', 'HEAD:src/ai/bootstrap_1'], { encoding: 'utf8' }).trim();
if (actualAiTree !== aiTree) throw new Error('Main baseline bootstrap policy changed; choose and document a new baseline');
const summary: unknown[] = [];
for (const puzzle of selected) {
  const ticks = option('--ticks');
  const result = runPublicPuzzle(puzzle, mode as Parameters<typeof runPublicPuzzle>[1], ticks ? { maxTicks: Number(ticks) } : {});
  const name = `${puzzle.key}-${puzzle.variant}`;
  writeFileSync(resolve(out, `${name}.json.gz`), gzipSync(JSON.stringify(result), { level: 9 }));
  const { commands, ...execution } = result.execution;
  const row = { puzzle: result.puzzle, mode, source, mainBaseline: 'd4ca2668', aiTree, elapsedMs: result.elapsedMs,
    commandCount: commands.length, ...execution };
  summary.push(row);
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(row));
}
