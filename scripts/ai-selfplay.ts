import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { runAiGame } from '../src/ai/game-runner';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import { seconds } from '../src/shared/time';
import type { AiScriptVersion } from '../src/ai/policy';
import type { RaceId } from '../src/shared/types';

// Both brains issue ordinary commands to the same live engine. The old brain
// is bundled from a Git revision outside production; no legacy policy is added
// to the game. Seat rotation and old-vs-old controls expose map advantages.
const args = process.argv.slice(2);
const value = (flag: string, fallback?: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const ref = value('--baseline-ref');
if (!ref) throw new Error('Use --baseline-ref <git revision>');
const revision = execFileSync('git', ['rev-parse', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
const root = resolve('.art-build/selfplay', revision), bundle = resolve(root, 'planner.mjs');
if (!existsSync(bundle)) {
  mkdirSync(root, { recursive: true });
  const archive = execFileSync('git', ['archive', revision, 'src'], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', root], { input: archive });
  if (!existsSync(resolve(root, 'node_modules'))) symlinkSync(resolve('node_modules'), resolve(root, 'node_modules'), 'dir');
  await build({ entryPoints: [resolve(root, 'src/ai/planner-context.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
  rmSync(resolve(root, 'src'), { recursive: true });
}
const old = await import(pathToFileURL(bundle).href) as typeof import('../src/ai/planner-context');
const control = args.includes('--control');
const seed = value('--seed', 'selfplay-unseen-07')!;
const cases = value('--cases', 'v5:land:grove:0,v7:land:grove:0,v8:land:grove:0,v5:sea:grove:0,v7:sea:grove:0,v8:sea:grove:0')!.split(',');
const maxSeconds = Number(value('--seconds', '2400'));
const out = value('--out', '.art-build/selfplay/latest.json')!;
const reports: unknown[] = [];
for (const cell of cases) {
  const [version, environment, race, seatText] = cell.split(':');
  if (!['v5', 'v7', 'v8'].includes(version!) || !['land', 'sea'].includes(environment!) || !['grove', 'ember'].includes(race!)) throw new Error(`Invalid case ${cell}`);
  const seat = Number(seatText), subject = `p${seat}`;
  if (![0, 1, 2].includes(seat)) throw new Error(`Invalid seat ${cell}`);
  const agents = Object.fromEntries([0, 1, 2].map(i => [`p${i}`, { controller: 'external-agent' as const, team: i === seat ? 'solo' : 'pair', race: (i === seat ? race : i % 2 ? 'grove' : 'ember') as RaceId, version: version as AiScriptVersion }]));
  const before = old.createAiMemoryProvider(), after = createAiMemoryProvider();
  const result = runAiGame({ name: cell, mapId: 'ladder', agents, maxTicks: seconds(maxSeconds), thinkInterval: seconds(.75), sampleInterval: seconds(60),
    options: { layout: { seed: `${seed}-${environment}`, kind: 'ring', idea: environment === 'sea' ? 'islandStarts' : 'openRing', size: 4096 } },
    commandPlanner: ({ snapshot, owner, agent, source, teams }) => (owner === subject && !control ? planAiOwnerCommandEntries : old.planAiOwnerCommandEntries)(snapshot, { playerId: owner, version: agent.version, source }, { teams, memoryProvider: owner === subject && !control ? after : before }),
  });
  const { snapshot, commands: _commands, ...report } = result;
  const record = { case: cell, seed, subject, control, baseline: revision, ...report, memory: (control ? before : after).get(subject),
    final: { units: snapshot.units.filter(u => u.owner === subject), buildings: snapshot.buildings.filter(b => b.owner === subject), items: snapshot.items, resources: snapshot.resources } };
  reports.push(record);
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(out, JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ case: cell, control, winner: report.winnerTeam, seconds: report.tick / seconds(1), timeout: report.timeout, cpuMs: report.cpuMs, final: report.timeline.at(-1)?.players }));
}
