// Film an unedited real-match snapshot through the normal AI schedule and native world renderer.
// npx tsx scripts/ai-defense-replay.ts fixture.json out-dir [before|after|both] [subject] [rival] [seconds] [worker|rally]
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

const [fixture, out, requestedMode = 'after', subject = 'v9_knight', rival = 'v9', duration = '95', scenario = 'worker'] = process.argv.slice(2);
if (!fixture || !out) throw new Error('fixture and out-dir are required');
const bytes = readFileSync(fixture), saved = JSON.parse(bytes.toString()) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory>;
};
mkdirSync(out, { recursive: true });

async function replay(mode: string) {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  const planned = new Map<number, CommandEnvelope[]>(), commands: unknown[] = [], samples: unknown[] = [];
  const rally = scenario === 'rally';
  let post = { x: 2681.6543031765154, y: 4102.184899904971 }, anchoredPost = false;
  const hall = saved.snapshot.buildings.find(building => building.id === `building-${subject}-townhall`)!;
  const tracked = rally ? saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind !== 'worker'
    && !['priest', 'summoner', 'witch', 'ashHexer', 'fieldMedic'].includes(unit.kind)
    && unit.id !== 'unit-v9_archer-sparkArcher-2014').map(unit => unit.id) : saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind === 'worker'
    && Math.hypot(unit.x - 4016, unit.y - 4944) < 650).map(unit => unit.id);
  const start = game.tick, fps = .05, arrived = new Set<string>();
  let maxGathered = 0, firstGatheredTick: number | undefined, firstFightTick: number | undefined;
  let firstEngagementTick: number | undefined, hallDamage = 0;
  const moments: { name: string; snapshot: GameSnapshot; arrived: number; phase: string }[] = [];
  game.observer = { hit(source, target, damage) {
    if (target.id === hall.id) hallDamage += damage;
    if (rally && firstEngagementTick === undefined && tracked.includes(source.id) && target.owner !== subject
      && target.owner !== 'neutral' && Math.hypot(source.x - hall.x, source.y - hall.y) <= 650) firstEngagementTick = game.tick;
  } };
  const measure = () => {
    const anchor = memories[subject]?.miningDefense;
    if (rally && !anchoredPost && anchor) { post = anchor.point; anchoredPost = true; }
    const count = game.units.filter(unit => tracked.includes(unit.id) && Math.hypot(unit.x - post.x, unit.y - post.y) <= 240);
    for (const unit of count) arrived.add(unit.id);
    maxGathered = Math.max(maxGathered, count.length);
    if (rally && firstFightTick === undefined && anchor?.phase === 'fight') {
      firstFightTick = game.tick; moments.push({ name: 'fight', snapshot: snapshotGame(game), arrived: arrived.size, phase: 'fight' });
    }
    if (rally && arrived.size === tracked.length && firstGatheredTick === undefined) {
      firstGatheredTick = game.tick; moments.push({ name: 'arrived', snapshot: snapshotGame(game), arrived: arrived.size, phase: anchor?.phase ?? 'cleared' });
    }
    return count.length;
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
    const due = planned.get(live.tick) ?? []; planned.delete(live.tick);
    const delivered = partitionDeliveredPlannerCommands(live, due).deliverable;
    commands.push(...delivered.map(entry => ({ tick: live.tick, ...entry })));
    return delivered;
  } }, { seconds: Number(duration), fps, width: 1280, height: 720,
    camera: rally ? { type: 'fixed', x: 2600, y: 3800, zoom: .65 } : { type: 'fixed', x: 4450, y: 5100, zoom: .65 }, hideOrderMarkers: false }, [{
    write(frame) {
      const living = game.units.filter(unit => tracked.includes(unit.id)); measure();
      const phase = memories[subject]?.miningDefense?.phase ?? 'none';
      samples.push({ tick: game.tick, gathered: rally ? measure() : undefined, arrived: rally ? [...arrived] : undefined, phase,
        workers: living.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, order: unit.order })) });
      const ctx = frame.canvas.getContext('2d'); ctx.fillStyle = '#17211e'; ctx.fillRect(12, 12, 760, 54);
      ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
      ctx.fillText(`${mode} | tick ${frame.tick} | ${rally ? `arrived ${arrived.size}/${tracked.length} | ${phase}` : `original workers ${living.length}/${tracked.length}`}`, 24, 46);
      if ([0, 20, 60, 100, 140].includes((game.tick - start) / 20)) writeFileSync(join(out, `${mode}-${game.tick}.png`), frame.canvas.toBuffer('image/png'));
    }, finish() {},
  }, gifSink(join(out, `${mode}.gif`), { fps, width: 960, height: 540 })]);
  for (const moment of moments) {
    const still = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
    restoreSnapshotIntoGame(still, moment.snapshot, game.nextId);
    await recordScene({ name: `mine-${moment.name}`, createGame: () => still },
      { seconds: 0, fps: 1, width: 1280, height: 720, camera: { type: 'fixed', x: post.x, y: post.y, zoom: .7 } }, [{
        write(frame) {
          const ctx = frame.canvas.getContext('2d'); ctx.fillStyle = '#17211e'; ctx.fillRect(12, 12, 760, 54);
          ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
          ctx.fillText(`${mode} | tick ${frame.tick} | ${moment.phase} | arrived ${moment.arrived}/${tracked.length}`, 24, 46);
          writeFileSync(join(out, `${mode}-${moment.name}.png`), frame.canvas.toBuffer('image/png'));
        }, finish() {},
      }]);
  }
  writeFileSync(join(out, `${mode}.json`), JSON.stringify({ machine: hostname(), platform: platform(), scenario,
    rallyPoint: rally ? post : undefined, maxGathered, arrived: rally ? [...arrived] : undefined, firstGatheredTick,
    firstFightTick, firstEngagementTick: firstEngagementTick ?? null, hallDamage,
    fixtureSha256: createHash('sha256').update(bytes).digest('hex'), mode, summary, tracked, commands, samples }, null, 2));
  console.log(JSON.stringify({ mode, ...summary, arrived: rally ? arrived.size : undefined, firstGatheredTick, firstFightTick,
    firstEngagementTick: firstEngagementTick ?? null, hallDamage, survivors: game.units.filter(unit => tracked.includes(unit.id)).length, out }));
}
for (const mode of requestedMode === 'both' ? ['before', 'after'] : [requestedMode]) await replay(mode);
