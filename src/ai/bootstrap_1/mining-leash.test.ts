import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { walkableGoal } from '../../shared/terrain';
import type { CommandEnvelope } from '../../shared/net/types';
import type { GameSnapshot } from '../../shared/types';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { runAiGameLoop } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { distance } from '../policy/spatial';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mainArmyIntel, miningLeash, miningRally } from './mine-defense';
import { MINING_PURSUIT_RADIUS } from './mining-leash';
import { activeUnitClaim, isMineRallyClaim } from '../policy/claims';

const saved: { snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory> } =
  JSON.parse(readFileSync(new URL('./fixtures/defense-pursuit-19m50.json', import.meta.url), 'utf8'));
const control: { source: string; commands: (CommandEnvelope & { tick: number; scriptId: string })[] } = JSON.parse(readFileSync(new URL('./fixtures/defense-pursuit-before-commands.json', import.meta.url), 'utf8'));
const owner = 'v9_knight', hallId = 'building-v9_knight-townHall-1889';
const agents = {
  p1: { controller: 'external-agent' as const, team: 'rivals', race: 'grove' as const, version: 'v9' as const },
  v9_knight: { controller: 'external-agent' as const, team: 'v9_knight-side', race: 'ember' as const, version: 'v9_knight' as const },
};
function restored() {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  return game;
}

it('keeps real 19:50 defensive pursuit orders inside 650 of the attacked hall', () => {
  const game = restored(), hall = game.buildings.find(building => building.id === hallId)!;
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  let afterMax = 0, returnOrder = false;
  const originalMax = Math.max(...control.commands.flatMap(entry => entry.playerId === owner
    && entry.scriptId === 'v6General' && entry.command.type === 'attackMove' ? [distance(entry.command, hall)] : []));
  runAiGameLoop({ name: 'bounded-real-pursuit', game, agents, maxTicks: 25000, thinkInterval: 15,
    commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version }, { teams, memoryProvider }),
  }, { onCommand({ owner: player, scriptId, command, game }) {
    if (player !== owner || scriptId !== 'v6General') return;
    if (command.type === 'attackMove') afterMax = Math.max(afterMax, distance(command, hall));
    if (command.type === 'move' && distance(command, hall) <= 240
      && game.units.some(unit => command.unitIds.includes(unit.id) && distance(unit, hall) > MINING_PURSUIT_RADIUS)) returnOrder = true;
  } });
  expect(control.source).toBe('fd54606bb905c7902ccf1fb53ed8938781c48714');
  expect(originalMax).toBeGreaterThan(1200);
  expect(afterMax).toBeGreaterThan(0);
  expect(afterMax).toBeLessThanOrEqual(MINING_PURSUIT_RADIUS);
  expect(returnOrder).toBe(true);
}, 30000);

function strayingDefender() {
  const game = restored(), memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  runAiGameLoop({ name: 'real-arrived-screen', game, agents, maxTicks: 24000, thinkInterval: 15,
    commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version }, { teams, memoryProvider }),
  });
  const snapshot = snapshotGame(game), memory = memories[owner]!;
  const options = bootstrapPolicyContext(snapshot, owner, 'v9_knight', { memory, teams: game.teams });
  const intel = mainArmyIntel(snapshot, owner, options), anchor = memory.miningDefense!;
  const unit = intel.army.find(unit => activeUnitClaim(snapshot, owner, unit, options)?.arrived && unit.attackDamage > 0 && unit.speed >= 60
    && unit.hp >= unit.maxHp * .8)!;
  const hall = snapshot.buildings.find(building => building.id === hallId)!;
  const outside = walkableGoal(snapshot.map, hall.x + (anchor.point.x - hall.x) * 4, hall.y + (anchor.point.y - hall.y) * 4);
  Object.assign(unit, outside);
  const target = snapshot.units.find(unit => unit.owner === 'p1' && unit.attackDamage > 0)!;
  unit.order = { type: 'attack', targetId: target.id };
  expect(distance(unit, hall)).toBeGreaterThan(MINING_PURSUIT_RADIUS);
  return { game, snapshot, memory, options, unit, hall, point: anchor.point };
}

it('breaks an actual out-of-bounds attack and physically returns to the same mine mouth', () => {
  const { game, snapshot, options, unit, point } = strayingDefender();
  restoreSnapshotIntoGame(game, snapshot, game.nextId);
  const entries = runAiCommandEntriesFromScripts(snapshot, owner, [miningLeash], options);
  expect(entries.some(entry => entry.command.type === 'move' && entry.command.avoidCombat
    && entry.command.unitIds.includes(unit.id) && distance(entry.command, point) < 1)).toBe(true);
  issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: owner })));
  for (let i = 0; i < 20 * 20; i++) {
    stepGame(game);
    if (i === 100) {
      const live = game.units.find(candidate => candidate.id === unit.id)!;
      expect(distance(live, point)).toBeGreaterThan(240);
      const next = runAiCommandEntriesFromScripts(snapshotGame(game), owner, [miningLeash,
        { id: 'normal-fighting', phase: 'tactics', redirects: 'local',
          run: () => ({ type: 'attackMove', unitIds: [unit.id], x: 3200, y: 3500 }) },
      ], options);
      expect(next.some(entry => entry.scriptId === 'normal-fighting')).toBe(false);
    }
  }
  const arrived = game.units.find(candidate => candidate.id === unit.id)!;
  expect(arrived).toBeDefined();
  expect(distance(arrived, point)).toBeLessThanOrEqual(240);
});

it.each([
  { stage: 'build', paused: false, recalled: false },
  { stage: 'escort', paused: false, recalled: false },
  { stage: 'build', paused: true, recalled: true },
  { stage: 'complete', paused: false, recalled: true },
])('respects expansion ownership at $stage (paused=$paused)', ({ stage, paused, recalled }) => {
  const { snapshot, memory, options, unit } = strayingDefender();
  const mission = { mineId: 'gold-gen-1', stage, paused, sinceTick: snapshot.tick, interruptions: [] };
  Object.assign(memory, { landExpansion: mission });
  memory.unitClaims[unit.id]!.expansionMineId = mission.mineId;
  const original = structuredClone(mission);
  const entries = runAiCommandEntriesFromScripts(snapshot, owner, [miningLeash], options);
  expect(entries.some(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(unit.id))).toBe(recalled);
  expect(mission).toEqual(original);
});


it('does not recall a defender after a real strategic sortie has taken ownership', () => {
  const { game, snapshot, options, memory, unit } = strayingDefender();
  restoreSnapshotIntoGame(game, snapshot, game.nextId);
  const entries = runAiCommandEntriesFromScripts(snapshot, owner, [
    { id: 'independent-sortie', phase: 'tactics', redirects: 'strategic', claimsUnits: () => new Set([unit.id]),
      run: () => ({ type: 'attackMove', unitIds: [unit.id], x: 3200, y: 3500 }) },
    miningRally, miningLeash,
  ], options);
  expect(entries.some(entry => entry.scriptId === 'independent-sortie')).toBe(true);
  expect(isMineRallyClaim(activeUnitClaim(snapshot, owner, unit, options))).toBe(false);
  expect(['mineGuard', 'mineLeash']).not.toContain(activeUnitClaim(snapshot, owner, unit, options)?.kind);
  issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: owner })));
  const next = runAiCommandEntriesFromScripts(snapshotGame(game), owner, [miningLeash], options);
  expect(next.some(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(unit.id))).toBe(false);
});
