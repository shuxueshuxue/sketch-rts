// Film an unedited real-match snapshot through the normal AI schedule and native world renderer.
// npx tsx scripts/ai-defense-replay.ts fixture.json out-dir [before] [subject] [rival] [seconds]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, platform } from 'node:os';
import { createHash } from 'node:crypto';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../src/shared/sim';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import { bootstrapScripts } from '../src/ai/bootstrap_1/policy';
import { plannerPhase, plannerThinksAt, PLANNER_COMMAND_DELAY_TICKS, partitionDeliveredPlannerCommands } from '../src/shared/sim/planner-schedule';
import { recordScene } from '../src/recorder/record';
import { gifSink } from '../src/recorder/sinks';
import type { CommandEnvelope } from '../src/shared/net/types';
import type { AiScriptVersion, BootstrapAiVersion, GameSnapshot } from '../src/shared/types';
import type { AiPolicyMemory } from '../src/ai/memory';

const [fixture, out, mode = 'after', subject = 'v9_knight', rival = 'v9', duration = '95'] = process.argv.slice(2);
if (!fixture || !out) throw new Error('fixture and out-dir are required');
const bytes = readFileSync(fixture), saved = JSON.parse(bytes.toString()) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory>;
};
mkdirSync(out, { recursive: true });
const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
game.activePlayers = [...saved.activePlayers];
const memoryProvider = createAiMemoryProvider(structuredClone(saved.memories));
const planned = new Map<number, CommandEnvelope[]>(), commands: unknown[] = [], samples: unknown[] = [];
const tracked = saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind === 'worker'
  && Math.hypot(unit.x - 4016, unit.y - 4944) < 650).map(unit => unit.id);
// Key moments every twenty game seconds; the simulation still advances every tick.
const start = game.tick, fps = .05;
const summary = await recordScene({ name: 'defense-real-match', createGame: () => game, commands: live => {
  for (const [index, owner] of saved.activePlayers.entries()) {
    if (!plannerThinksAt(live.tick, plannerPhase(index, saved.activePlayers.length, 15), 15)) continue;
    const version = (owner === subject ? subject : rival) as AiScriptVersion;
    const entries = planAiOwnerCommandEntries(snapshotGame(live), { playerId: owner, version,
      ...(mode === 'before' && owner === subject ? { scripts: bootstrapScripts(subject as BootstrapAiVersion)
        .filter(script => script.id !== 'miningJobSafety') } : {}) }, { teams: live.teams, memoryProvider });
    const due = live.tick + PLANNER_COMMAND_DELAY_TICKS;
    planned.set(due, [...(planned.get(due) ?? []), ...entries]);
  }
  const due = planned.get(live.tick) ?? [];
  planned.delete(live.tick);
  const delivered = partitionDeliveredPlannerCommands(live, due).deliverable;
  commands.push(...delivered.map(entry => ({ tick: live.tick, ...entry })));
  return delivered;
} }, { seconds: Number(duration), fps, width: 1280, height: 720,
  camera: { type: 'fixed', x: 4450, y: 5100, zoom: .65 }, hideOrderMarkers: false }, [{
  write(frame) {
    const living = game.units.filter(unit => tracked.includes(unit.id));
    samples.push({ tick: game.tick, workers: living.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, order: unit.order })) });
    const ctx = frame.canvas.getContext('2d');
    ctx.fillStyle = '#17211e'; ctx.fillRect(12, 12, 580, 54);
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText(`${mode} | tick ${frame.tick} | original workers ${living.length}/${tracked.length}`, 24, 46);
    if ([0, 20, 60, 90].includes((game.tick - start) / 20)) writeFileSync(join(out, `${mode}-${game.tick}.png`), frame.canvas.toBuffer('image/png'));
  }, finish() {},
}, gifSink(join(out, `${mode}.gif`), { fps, width: 960, height: 540 })]);
writeFileSync(join(out, `${mode}.json`), JSON.stringify({ machine: hostname(), platform: platform(),
  fixtureSha256: createHash('sha256').update(bytes).digest('hex'), mode, summary, tracked, commands, samples }, null, 2));
console.log(JSON.stringify({ mode, ...summary, survivors: game.units.filter(unit => tracked.includes(unit.id)).length, out }));
