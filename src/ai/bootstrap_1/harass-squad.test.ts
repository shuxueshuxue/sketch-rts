import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { GameSnapshot, Unit } from '../../shared/types';
import { runAiGameLoop } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { activeUnitClaim, recordUnitTaskClaim } from '../policy/claims';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { distance } from '../policy/spatial';
import { readV6Intel } from '../policy/v6/intel';
import { bootstrapPolicyContext } from './policy';
import { harassSquadAssignment, HARASS_DEPARTURE_RADIUS } from './harass-squad';
import { mainArmyIntel, mineDefense } from './mine-defense';
import { expansionMissionUnitIds, prepareExpansionMission } from './expansion-mission';
import { availableMountedRiders } from './mounted-tasks';

const saved: { snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory> } =
  JSON.parse(readFileSync(new URL('./fixtures/defense-harass-9m03.json', import.meta.url), 'utf8'));
const owner = 'v9_knight', targetId = 'unit-p1-horseArcher-2460', hallId = 'building-v9_knight-townHall-2260';
const agents = {
  p1: { controller: 'external-agent' as const, team: 'rivals', race: 'grove' as const, version: 'v9_archer' as const },
  v9_knight: { controller: 'external-agent' as const, team: 'v9_knight-side', race: 'ember' as const, version: 'v9_knight' as const },
};
function captured() {
  const snapshot = structuredClone(saved.snapshot), memory = structuredClone(saved.memories[owner]!);
  const options = bootstrapPolicyContext(snapshot, owner, owner, { memory, teams: snapshot.teams ?? {} });
  const hall = snapshot.buildings.find(building => building.id === hallId)!;
  const target = snapshot.units.find(unit => unit.id === targetId)!;
  return { snapshot, memory, options, hall, target };
}
function select(context: ReturnType<typeof captured>) {
  return harassSquadAssignment(context.snapshot, owner, context.options, readV6Intel(context.snapshot, owner, context.options));
}
function bind(context: ReturnType<typeof captured>) {
  const crew = select(context)!.crew;
  const goal = structuredClone(context.memory.v6!.general);
  const entries = runAiCommandEntriesFromScripts(context.snapshot, owner, [mineDefense], context.options);
  expect(context.memory.v6!.general).toEqual(goal);
  expect(crew.every(unit => activeUnitClaim(context.snapshot, owner, unit, context.options)?.kind === 'harassSquad')).toBe(true);
  return { crew, entries };
}
function restored(snapshot = saved.snapshot) {
  const game = createGame(snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(snapshot), saved.nextId); game.activePlayers = [...saved.activePlayers];
  return game;
}

it('uses the real three outranging archers, not the melee picked before, in the complete 9:03 match fork', () => {
  const game = restored(), memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  const expected = saved.snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'contractArcher').map(unit => unit.id).sort();
  const ordered = new Set<string>(), targets = new Set<string>();
  const originalGoal = structuredClone(memories[owner]!.v6!.general);
  let directives = 0, hitsBy = 0, hitsAgainst = 0, bound = false;
  game.observer = { hit(source, target) { if (source.id === targetId) hitsBy++; if (target.id === targetId) hitsAgainst++; } };
  runAiGameLoop({ name: 'fixed-real-harass-squad', game, agents, maxTicks: saved.snapshot.tick + 3000, thinkInterval: 15,
    commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version }, { teams, memoryProvider }),
  }, { onCommand({ owner: player, scriptId, command }) {
    if (player !== owner || scriptId !== 'mineDefense') return;
    directives++;
    if ('unitIds' in command) for (const id of command.unitIds) ordered.add(id);
    if (command.type === 'attack') targets.add(command.targetId);
  }, onStep() {
    const memory = memories[owner]!;
    // The local squad never redirects the general (also checked in bind()).
    // A separate sixty-second territory task may now send the surplus forward.
    if (!memory.territory?.lastAction) expect(memory.v6!.general).toEqual(originalGoal);
    expect(memory.miningDefense).toBeUndefined();
    if (memory.harassDefense) {
      bound = true;
      expect(memory.harassDefense.hallId).toBe(hallId);
      expect(memory.harassDefense.targetId).toBe(targetId);
      expect(Object.entries(memory.unitClaims).filter(([, claim]) => claim.kind === 'harassSquad').map(([id]) => id).sort()).toEqual(expected);
    }
  } });
  expect(expected).toHaveLength(3); expect(bound).toBe(true);
  expect([...ordered].sort()).toEqual(expected); expect([...targets]).toEqual([targetId]);
  // Parent a2cff607: 105 directives / 11 defenders, 65 hits by the rider, zero against it.
  expect(directives).toBeLessThan(105); expect(hitsBy).toBeLessThan(65); expect(hitsAgainst).toBeGreaterThan(0);
  expect(game.units.some(unit => unit.id === targetId)).toBe(false);
}, 30000);

it.each([38, 54, 109])('sizes the squad by live two-volley firepower at %s target HP', hp => {
  const context = captured(); context.target.hp = hp;
  const crew = select(context)!.crew;
  expect(crew).toHaveLength(hp === 38 ? 1 : hp === 54 ? 2 : 3);
  expect(crew.every(unit => unit.attackRange > context.target.attackRange)).toBe(true);
});

it('prefers outranging ranged units over equally fast cavalry and rejects shorter-range slow melee', () => {
  const context = captured(), cavalry = context.snapshot.units.find(unit => unit.owner === owner && unit.kind === 'emberRavager')!;
  Object.assign(cavalry, { kind: 'knight', speed: context.target.speed, attackDamage: 60, level: 3 });
  expect(select(context)!.crew.every(unit => unit.kind === 'contractArcher')).toBe(true);
  for (const unit of context.snapshot.units) if (unit.owner === owner && unit.kind === 'contractArcher') unit.attackRange = context.target.attackRange;
  const revised = { ...context, snapshot: { ...context.snapshot, units: [...context.snapshot.units] } };
  expect(select(revised)!.crew).toContain(cavalry);
  cavalry.speed = context.target.speed - 1;
  expect(select({ ...revised, snapshot: { ...revised.snapshot } })).toBeUndefined();
});

it.each(['all', 'partial'] as const)('binds only accepted orders when a higher-priority task rejects %s of the squad', blocked => {
  const context = captured(), selected = select(context)!.crew;
  const ids = selected.slice(0, blocked === 'all' ? selected.length : 1).map(unit => unit.id);
  runAiCommandEntriesFromScripts(context.snapshot, owner, [
    { id: 'earlier-task', phase: 'tactics', redirects: 'strategic', claimsUnits: () => new Set(ids),
      run: () => ({ type: 'holdPosition', unitIds: ids }) }, mineDefense,
  ], context.options);
  const bound = Object.entries(context.memory.unitClaims).filter(([, claim]) => claim.kind === 'harassSquad').map(([id]) => id).sort();
  expect(bound).toEqual(selected.filter(unit => !ids.includes(unit.id)).map(unit => unit.id).sort());
  if (blocked === 'all') expect(context.memory.harassDefense).toBeUndefined();
  else expect(select(context)!.crew.map(unit => unit.id).sort()).toEqual(bound);
});

it('keeps the original members and target when nearer replacements and another rider appear', () => {
  const context = captured(), { crew } = bind(context);
  const replacement: Unit = { ...structuredClone(crew[0]!), id: 'nearer-new-archer', x: context.hall.x, y: context.hall.y };
  const rider = { ...structuredClone(context.target), id: 'nearer-new-rider', x: context.hall.x + 300, y: context.hall.y };
  const next = { ...context, snapshot: { ...context.snapshot, units: [...context.snapshot.units, replacement, rider] } };
  expect(select(next)!.crew.map(unit => unit.id).sort()).toEqual(crew.map(unit => unit.id).sort());
  expect(select(next)!.target.id).toBe(targetId);
  crew[0]!.hp = crew[0]!.maxHp * .2;
  expect(select(next)!.crew.map(unit => unit.id).sort()).toEqual(crew.map(unit => unit.id).sort());
});

it('returns outside 650 without releasing a circling rider, and physically reaches the fixed post', () => {
  const context = captured(), { crew } = bind(context), point = context.memory.harassDefense!.point;
  const unit = crew[0]!;
  // The raw mine-mouth lane is walkable along this direction.
  Object.assign(unit, { x: context.hall.x + (point.x - context.hall.x) * 3.5, y: context.hall.y + (point.y - context.hall.y) * 3.5,
    order: { type: 'attack', targetId } });
  Object.assign(context.target, { x: context.hall.x + (point.x - context.hall.x) * 4, y: context.hall.y + (point.y - context.hall.y) * 4 });
  const entries = runAiCommandEntriesFromScripts({ ...context.snapshot }, owner, [mineDefense], context.options);
  expect(entries.some(({ command }) => command.type === 'move' && command.avoidCombat
    && command.unitIds.includes(unit.id) && distance(command, point) < 1)).toBe(true);
  expect(activeUnitClaim(context.snapshot, owner, unit, context.options)?.kind).toBe('harassSquad');
  expect(select(context)!.target.id).toBe(targetId);
  const game = restored(context.snapshot); issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: owner })));
  for (let tick = 0; tick < 500; tick++) stepGame(game);
  expect(distance(game.units.find(candidate => candidate.id === unit.id)!, point)).toBeLessThanOrEqual(240);
});

it.each(['dead', 'departed'] as const)('releases the binding only after the target has %s', reason => {
  const context = captured(), { crew } = bind(context);
  const next = { ...context.snapshot, units: context.snapshot.units.filter(unit => reason !== 'dead' || unit.id !== targetId) };
  if (reason === 'departed') Object.assign(context.target, { x: context.hall.x - HARASS_DEPARTURE_RADIUS - 100, y: context.hall.y });
  // Departure from this mine can start an independent job at another mine, which is allowed.
  runAiCommandEntriesFromScripts(next, owner, [mineDefense], context.options);
  expect(crew.every(unit => context.memory.unitClaims[unit.id]?.sinceTick !== saved.snapshot.tick
    || context.memory.unitClaims[unit.id]?.kind !== 'harassSquad')).toBe(true);
  if (reason === 'dead') expect(context.memory.harassDefense).toBeUndefined();
});

it('respects expansion and garrison ownership and keeps a confirmed squad out of later expansion and mounted tasks', () => {
  const context = captured(), selected = select(context)!.crew;
  recordUnitTaskClaim(context.snapshot, context.memory, selected[0]!.id, { kind: 'expansionGarrison', targetId: hallId, x: context.hall.x, y: context.hall.y });
  expect(select(context)).toBeUndefined();
  delete context.memory.unitClaims[selected[0]!.id];
  const { crew } = bind(context);
  expect(mainArmyIntel(context.snapshot, owner, context.options).army.some(unit => crew.includes(unit))).toBe(false);
  const mineId = context.snapshot.resources.find(mine => mine.amount > 0)!.id;
  context.memory.landExpansion = { mineId, stage: 'escort', sinceTick: context.snapshot.tick, interruptions: [] };
  for (const unit of crew) context.memory.unitClaims[unit.id]!.expansionMineId = mineId;
  prepareExpansionMission(context.snapshot, owner, context.options, mainArmyIntel(context.snapshot, owner, context.options));
  expect(expansionMissionUnitIds(context.memory).some(id => crew.some(unit => unit.id === id))).toBe(false);
  const rider = crew[0]!; rider.kind = 'horseArcher';
  expect(availableMountedRiders(context.snapshot, owner, context.options)).not.toContain(rider);
});

it('evacuates workers without sending slow melee or redirecting the main army when no eligible squad exists', () => {
  const context = captured();
  for (const unit of context.snapshot.units) if (unit.owner === owner && unit.kind === 'contractArcher') unit.attackRange = context.target.attackRange;
  const worker = context.snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker')
    .sort((a, b) => distance(a, context.hall) - distance(b, context.hall))[0]!;
  Object.assign(context.target, { x: worker.x + 200, y: worker.y, order: { type: 'attack', targetId: worker.id } });
  const snapshot = { ...context.snapshot }, goal = structuredClone(context.memory.v6!.general);
  const memories = { ...structuredClone(saved.memories), [owner]: context.memory };
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, source: 'external-agent', version: owner },
    { teams: snapshot.teams ?? {}, memoryProvider: createAiMemoryProvider(memories) });
  expect(entries.some(entry => entry.scriptId === 'miningJobSafety' && entry.command.type === 'move' && entry.command.avoidCombat && entry.command.unitIds.includes(worker.id))).toBe(true);
  expect(entries.some(entry => entry.scriptId === 'mineDefense')).toBe(false);
  expect(Object.values(context.memory.unitClaims).some(claim => claim.kind === 'harassSquad')).toBe(false);
  expect(context.memory.miningDefense).toBeUndefined();
  expect(context.memory.v6!.general).toEqual(goal);
});


it('renews a long-lived binding through an accepted order before the shared TTL expires', () => {
  const context = captured(), { crew } = bind(context), point = context.memory.harassDefense!.point;
  const expiry = context.memory.unitClaims[crew[0]!.id]!.expiresTick;
  const next = { ...context.snapshot, tick: expiry - 30 };
  for (const unit of crew) { Object.assign(unit, point); unit.order = { type: 'hold', ...point }; }
  const entries = runAiCommandEntriesFromScripts(next, owner, [mineDefense], context.options);
  expect(entries).toHaveLength(crew.length);
  for (const unit of crew) {
    expect(activeUnitClaim(next, owner, unit, context.options)).toMatchObject({ kind: 'harassSquad',
      targetId, sinceTick: saved.snapshot.tick, expiresTick: next.tick + 3600 });
  }
});


it.each([false, true])('does not mistake an overwhelming mounted attack for a nuisance (existing squad=%s)', bound => {
  const context = captured();
  if (bound) bind(context);
  const reinforcement = { ...structuredClone(context.target), id: 'powerful-mounted-reinforcement', level: 30,
    x: context.hall.x + 400, y: context.hall.y, order: { type: 'attack' as const, targetId: context.hall.id } };
  const snapshot = { ...context.snapshot, units: [...context.snapshot.units, reinforcement] };
  if (!bound) expect(harassSquadAssignment(snapshot, owner, context.options, readV6Intel(snapshot, owner, context.options))).toBeUndefined();
  expect(mainArmyIntel(snapshot, owner, context.options).intrusion?.attackers.some(unit => unit.id === reinforcement.id)).toBe(true);
});
