import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { planBootstrapNaval } from './expedition-recovery';
import { expeditionDeparture } from './expedition-departure';
import { transportRecovery } from './transport-recovery';

const versions = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
function field() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-exhausted-island-departure.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, saved, memory: saved.memories.p0 };
}

it.each(versions)('%s clears the actual idle shore blockers of the exhausted-island return', version => {
  const { game, memory } = field(), snapshot = snapshotGame(game);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
  const commands = planBootstrapNaval(snapshot, 'p0', options);
  const yielding = new Set(commands.flatMap(command => command.type === 'move' ? command.unitIds : []));
  for (const id of ['unit-p0-footman-1069', 'unit-p0-archer-2466']) expect(yielding.has(id), id).toBe(true);
  for (const id of ['unit-p0-priest-2370', 'unit-p0-priest-3558', 'unit-p0-archer-2384', 'unit-p0-archer-2756']) expect(yielding.has(id), id).toBe(false);
  expect(memory.naval.ferries).toEqual({});
});

it.each(versions)('%s actually releases the complete saved return with ordinary naval policy orders', version => {
  const { game, memory, saved } = field(), boat = game.units.find(unit => unit.id === 'unit-p0-carrier-3510')!;
  const start = { x: boat.x, y: boat.y, hp: boat.hp }, scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
  let restored: ReturnType<typeof createGame> | undefined, restoredMemory: typeof memory | undefined;
  const issued: { tick: number; command: unknown }[] = [];
  const think = (world: typeof game, policy: typeof memory) => {
    const snapshot = snapshotGame(world), options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: policy, teams: world.teams });
    const entries = runAiCommandEntriesFromScripts(snapshot, 'p0', scripts, options);
    for (const entry of entries) issuePlayerCommand(world, 'p0', entry.command);
    return entries;
  };
  for (let tick = 0; tick < 1200; tick++) {
    if (tick === 120 && version === 'v9_archer') {
      const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId, memories: { ...saved.memories, p0: memory } }));
      restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId); restoredMemory = checkpoint.memories.p0;
    }
    if (tick % 15 === 0) {
      issued.push(...think(game, memory).map(entry => ({ tick: game.tick, command: entry.command })));
      if (restored) think(restored, restoredMemory);
    }
    stepGame(game); if (restored) stepGame(restored);
  }
  expect(Math.hypot(boat.x - start.x, boat.y - start.y), JSON.stringify({ boat, issued })).toBeGreaterThan(250);
  expect(boat.hp).toBe(start.hp);
  if (restored) {
    expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId); expect(restoredMemory).toEqual(memory);
  }
}, 120000);

it.each(['wounded', 'combat', 'boarding', 'queued', 'mounted', 'claimed', 'medical', 'ally', 'local-enemy'] as const)
  ('keeps a real shore body under its existing %s control', role => {
    const { game, memory } = field(), unit = game.units.find(unit => unit.id === 'unit-p0-footman-1069')!;
    const protectedUnits = new Set<string>();
    if (role === 'wounded') unit.hp -= 1;
    else if (role === 'combat') unit.order = { type: 'attackMove', x: 3760, y: 6839 };
    else if (role === 'boarding') unit.order = { type: 'board', transportId: 'unit-p0-carrier-3510' };
    else if (role === 'queued') unit.orderQueue = [{ type: 'attackMove', x: 3760, y: 6839 }];
    else if (role === 'mounted') memory.mounted = [{ unitIds: [unit.id], objective: { kind: 'camp', ids: [] } }];
    else if (role === 'claimed') memory.unitClaims[unit.id] = { kind: 'attack', targetId: 'continuing-task', x: unit.x, y: unit.y, sinceTick: game.tick, expiresTick: game.tick + 1 };
    else if (role === 'medical') protectedUnits.add(unit.id);
    else if (role === 'ally') unit.owner = 'player';
    else game.units.find(unit => unit.id === 'unit-p0-archer-2782')!.owner = 'p1';
    const snapshot = snapshotGame(game), before = JSON.parse(JSON.stringify(snapshot));
    const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory, teams: game.teams });
    const departure = expeditionDeparture(snapshot, 'p0', options, transportRecovery(snapshot, 'p0', options).ids, protectedUnits);
    expect(departure.ids.has(unit.id)).toBe(false);
    expect(departure.commands.some(command => 'unitIds' in command && command.unitIds.includes(unit.id))).toBe(false);
    expect(snapshot).toEqual(before);
  });
