// Film an unedited real-match snapshot through the normal AI schedule and native world renderer.
// npx tsx scripts/ai-defense-replay.ts fixture.json out-dir [before] [subject] [rival] [seconds] [worker|rally]
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

const [fixture, out, mode = 'after', subject = 'v9_knight', rival = 'v9', duration = '95', scenario = 'worker'] = process.argv.slice(2);
if (!fixture || !out) throw new Error('fixture and out-dir are required');
const bytes = readFileSync(fixture), saved = JSON.parse(bytes.toString()) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory>;
};
mkdirSync(out, { recursive: true });
const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
game.activePlayers = [...saved.activePlayers];
const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
const planned = new Map<number, CommandEnvelope[]>(), commands: unknown[] = [], samples: unknown[] = [];
const rally = scenario === 'rally';
let post = { x: 2681.6543031765154, y: 4102.184899904971 }, anchoredPost = false;
const tracked = rally ? saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind !== 'worker'
  && !['priest', 'summoner', 'witch', 'ashHexer', 'fieldMedic'].includes(unit.kind)
  && unit.id !== 'unit-v9_archer-sparkArcher-2014').map(unit => unit.id) : saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind === 'worker'
  && Math.hypot(unit.x - 4016, unit.y - 4944) < 650).map(unit => unit.id);
// Key moments every twenty game seconds; the simulation still advances every tick.
const start = game.tick, fps = .05;
let maxGathered = 0, firstGatheredTick: number | undefined, gatheredSnapshot: GameSnapshot | undefined;
const measure = () => {
  if (rally && !anchoredPost && memories[subject]?.miningDefense) {
    post = memories[subject]!.miningDefense!.point; anchoredPost = true;
  }
  const count = game.units.filter(unit => tracked.includes(unit.id) && Math.hypot(unit.x - post.x, unit.y - post.y) <= 240).length;
  maxGathered = Math.max(maxGathered, count);
  if (rally && count === tracked.length && firstGatheredTick === undefined) { firstGatheredTick = game.tick; gatheredSnapshot = snapshotGame(game); }
  return count;
};
const summary = await recordScene({ name: 'defense-real-match', createGame: () => game, commands: live => {
  measure();
  for (const [index, owner] of saved.activePlayers.entries()) {
    if (!plannerThinksAt(live.tick, plannerPhase(index, saved.activePlayers.length, 15), 15)) continue;
    const version = (owner === subject ? subject : rival) as AiScriptVersion;
    const entries = planAiOwnerCommandEntries(snapshotGame(live), { playerId: owner, version,
      ...(mode === 'before' && owner === subject ? { scripts: bootstrapScripts(subject as BootstrapAiVersion)
        .filter(script => script.id !== (rally ? 'miningRally' : 'miningJobSafety')) } : {}) }, { teams: live.teams, memoryProvider });
    const due = live.tick + PLANNER_COMMAND_DELAY_TICKS;
    planned.set(due, [...(planned.get(due) ?? []), ...entries]);
  }
  const due = planned.get(live.tick) ?? [];
  planned.delete(live.tick);
  const delivered = partitionDeliveredPlannerCommands(live, due).deliverable;
  commands.push(...delivered.map(entry => ({ tick: live.tick, ...entry })));
  return delivered;
} }, { seconds: Number(duration), fps, width: 1280, height: 720,
  camera: rally ? { type: 'fixed', x: 2600, y: 3800, zoom: .65 } : { type: 'fixed', x: 4450, y: 5100, zoom: .65 }, hideOrderMarkers: false }, [{
  write(frame) {
    const living = game.units.filter(unit => tracked.includes(unit.id));
    samples.push({ tick: game.tick, gathered: rally ? measure() : undefined, workers: living.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, order: unit.order })) });
    const ctx = frame.canvas.getContext('2d');
    ctx.fillStyle = '#17211e'; ctx.fillRect(12, 12, 580, 54);
    ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
    ctx.fillText(`${mode} | tick ${frame.tick} | ${rally ? 'defenders gathered ' + measure() : 'original workers ' + living.length}/${tracked.length}`, 24, 46);
    if ([0, 20, 60, 100, 140].includes((game.tick - start) / 20)) writeFileSync(join(out, `${mode}-${game.tick}.png`), frame.canvas.toBuffer('image/png'));
  }, finish() {},
}, gifSink(join(out, `${mode}.gif`), { fps, width: 960, height: 540 })]);
if (gatheredSnapshot) {
  const still = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(still, gatheredSnapshot, game.nextId);
  await recordScene({ name: 'first-complete-mine-rally', createGame: () => still },
    { seconds: 0, fps: 1, width: 1280, height: 720, camera: { type: 'fixed', x: post.x, y: post.y, zoom: .8 } }, [{
      write(frame) {
        const ctx = frame.canvas.getContext('2d'); ctx.fillStyle = '#17211e'; ctx.fillRect(12, 12, 660, 54);
        ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
        ctx.fillText(`${mode} | tick ${frame.tick} | all ${tracked.length} defenders at the same mine mouth`, 24, 46);
        writeFileSync(join(out, `${mode}-gathered.png`), frame.canvas.toBuffer('image/png'));
      }, finish() {},
    }]);
}
writeFileSync(join(out, `${mode}.json`), JSON.stringify({ machine: hostname(), platform: platform(),
  scenario, rallyPoint: rally ? post : undefined, maxGathered: rally ? maxGathered : undefined, firstGatheredTick, fixtureSha256: createHash('sha256').update(bytes).digest('hex'), mode, summary, tracked, commands, samples }, null, 2));
console.log(JSON.stringify({ mode, ...summary, maxGathered: rally ? maxGathered : undefined, firstGatheredTick, survivors: game.units.filter(unit => tracked.includes(unit.id)).length, out }));
