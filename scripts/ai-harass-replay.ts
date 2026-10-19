// Native-rendered replay of both delivered parent commands and the current full AI stack.
// tsx scripts/ai-harass-replay.ts fixture parent-commands.json out-dir [seconds=150] [frame-seconds=10]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hostname, platform } from 'node:os';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../src/shared/sim';
import { plannerPhase, plannerThinksAt, PLANNER_COMMAND_DELAY_TICKS, partitionDeliveredPlannerCommands } from '../src/shared/sim/planner-schedule';
import type { CommandEnvelope } from '../src/shared/net/types';
import type { GameSnapshot } from '../src/shared/types';
import type { AiPolicyMemory } from '../src/ai/memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import { recordScene } from '../src/recorder/record';
import { gifSink } from '../src/recorder/sinks';

const [fixture, parent, out, duration = '150', frameSeconds = '10'] = process.argv.slice(2);
if (!fixture || !parent || !out) throw new Error('fixture, delivered parent commands and output directory required');
const bytes = readFileSync(fixture), saved = JSON.parse(bytes.toString()) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory>;
};
const control = JSON.parse(readFileSync(parent, 'utf8')) as { source: string; commands: (CommandEnvelope & { tick: number; scriptId: string })[] };
if (!control.source) throw new Error('Parent playback must identify its original source commit');
const subject = 'v9_knight', targetId = 'unit-p1-horseArcher-2460';
mkdirSync(out, { recursive: true });
for (const mode of ['before', 'after']) {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId); game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  type Entry = CommandEnvelope & { scriptId?: string };
  const planned = new Map<number, Entry[]>(), playback = new Map<number, Entry[]>();
  for (const entry of control.commands) playback.set(entry.tick, [...(playback.get(entry.tick) ?? []), entry]);
  const commands: unknown[] = [], samples: unknown[] = [], hitEvents: unknown[] = [];
  const crew = new Set<string>(); let directives = 0, hitsBy = 0, hitsAgainst = 0, deadTick: number | undefined;
  const general = structuredClone(memories[subject]!.v6!.general);
  game.observer = { hit(source, target, damage) {
    if (source.id === targetId) hitsBy++;
    if (target.id === targetId) hitsAgainst++;
    if (source.id === targetId || target.id === targetId) hitEvents.push({ tick: game.tick, source: source.id, target: target.id, damage });
  } };
  const start = game.tick, fps = 1 / Number(frameSeconds);
  const summary = await recordScene({ name: 'real-harassment-replay', createGame: () => game, commands: live => {
    if (!live.units.some(unit => unit.id === targetId)) deadTick ??= live.tick;
    if (mode === 'after') for (const [index, owner] of saved.activePlayers.entries()) {
      if (!plannerThinksAt(live.tick, plannerPhase(index, saved.activePlayers.length, 15), 15)) continue;
      const entries = planAiOwnerCommandEntries(snapshotGame(live), { playerId: owner, source: 'external-agent',
        version: owner === subject ? 'v9_knight' : 'v9_archer' }, { teams: live.teams, memoryProvider });
      const due = live.tick + PLANNER_COMMAND_DELAY_TICKS;
      planned.set(due, [...(planned.get(due) ?? []), ...entries]);
    }
    const due = (mode === 'before' ? playback : planned).get(live.tick) ?? []; planned.delete(live.tick);
    const delivered = partitionDeliveredPlannerCommands(live, due).deliverable;
    for (const entry of delivered) if (entry.playerId === subject && entry.scriptId === 'mineDefense') {
      directives++;
      if ('unitIds' in entry.command) for (const id of entry.command.unitIds) crew.add(id);
    }
    commands.push(...delivered.map(entry => ({ tick: live.tick, ...entry })));
    return delivered;
  } }, { seconds: Number(duration) + 1 / fps, fps, width: 1280, height: 720,
    camera: { type: 'fixed', x: 4390, y: 4820, zoom: .7 }, hideOrderMarkers: false }, [{
    write(frame) {
      const target = game.units.find(unit => unit.id === targetId);
      samples.push({ tick: game.tick, target: target && { x: target.x, y: target.y, hp: target.hp },
        squad: structuredClone(memories[subject]?.harassDefense), general: structuredClone(memories[subject]?.v6?.general),
        crew: game.units.filter(unit => crew.has(unit.id)).map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, order: unit.order })) });
      const ctx = frame.canvas.getContext('2d'); ctx.fillStyle = '#17211e'; ctx.fillRect(12, 12, 1070, 54);
      ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
      ctx.fillText(`${mode} | +${(frame.tick - start) / 20}s | orders ${directives} | defenders ${crew.size} | rider hits ${hitsBy} | returned hits ${hitsAgainst}`, 24, 46);
      writeFileSync(join(out, `${mode}-${frame.tick}.png`), frame.canvas.toBuffer('image/png'));
    }, finish() {},
  }, gifSink(join(out, `${mode}.gif`), { fps, width: 960, height: 540 })]);
  const receipt = { mode, machine: hostname(), platform: platform(), controlSource: control.source,
    fixtureSha256: createHash('sha256').update(bytes).digest('hex'), summary, directives, crew: [...crew], hitsBy, hitsAgainst,
    deadTick: deadTick ?? null, mainGoalUnchanged: mode === 'after' ? JSON.stringify(memories[subject]!.v6!.general) === JSON.stringify(general) : undefined,
    commands, samples, hitEvents };
  writeFileSync(join(out, `${mode}.json`), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ...receipt, commands: undefined, samples: undefined, hitEvents: undefined }));
}
