import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { sameGround } from '../../shared/terrain';
import { runGameLoop } from '../../sdk/game-runner';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AiGameAgent } from '../game-runner';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { bootstrapPolicyContext, planBootstrapCommands } from './policy';
import { planBootstrapNaval } from './expedition-recovery';
import { navalBudgetReserve } from '../policy/naval';
import { expansionGarrisonReady } from './expansion-garrison';

// Unedited 15-minute frames from native one-human/default-AI rooms at 348ab866.
// Keep every enemy, cargo hold, resource amount and existing assignment intact.
function scene(map: string, owner: string) {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/${map}-beachhead-15m.json`, import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>; versions: Record<string, BootstrapAiVersion>;
  };
  const game = createGame('bareDuel', { aiPlayers: [] });
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game), memory = saved.memories[owner]!, version = saved.versions[owner]!;
  const options = bootstrapPolicyContext(snapshot, owner, version, { memory, teams: game.teams });
  return { game, snapshot, memory, version, options, saved };
}

it.each([
  { map: 'ring', owner: 'player-4', mineId: 'gold-gen-8', reserve: 400 },
  { map: 'temple', owner: 'enemy', mineId: 'gold-gen-10', reserve: 0 },
])('retains and funds the cleared actual beachhead: $map / $owner', ({ map, owner, mineId, reserve }) => {
  const { snapshot, memory, options } = scene(map, owner);
  expect(memory.naval!.conquests?.[mineId]).toMatchObject({ stage: 'escort', reason: 'await-engineer-transport' });
  expect(navalBudgetReserve(snapshot, owner, options)).toBe(reserve);
  // Temple already has a hall order: the runner reserves that existing cost,
  // so the naval reserve must not charge the same 400 gold a second time.
  if (!reserve) expect(snapshot.units.some(unit => unit.owner === owner && unit.order.type === 'build'
    && unit.order.buildingKind === 'townHall')).toBe(true);
  planBootstrapNaval(snapshot, owner, options);
  expect(memory.naval!.conquests?.[mineId]?.stage).toBe('escort');
  if (map === 'ring') expect(Object.values(memory.naval!.ferries!).some(mission => mission.purpose === 'settle'
    && mission.targetId === mineId && mission.phase === 'loading')).toBe(true);
});

it('physically completes the real cleared island with an engineer crossing, a hall and an arrived garrison', () => {
  const owner = 'player-4', { game, saved } = scene('ring', owner);
  game.activePlayers = Object.keys(game.players);
  const memories = structuredClone(saved.memories);
  const agents: Record<string, AiGameAgent> = Object.fromEntries(Object.entries(saved.versions).map(([id, version]) => [id,
    { controller: 'external-agent', team: game.teams[id] ?? id, race: game.players[id]!.race, version, policyVersion: version }]));
  const mine = game.resources.find(mine => mine.id === 'gold-gen-8')!;
  const boarded = new Set<string>();
  let delivered = false, built = false, defended = false;
  runGameLoop({ name: 'native-ring-beachhead-completion', game, agents, maxTicks: 22000, thinkInterval: 15,
    commandPlanner: navalObservedPlanner(memories) }, { onStep({ game }) {
    for (const unit of game.units) if (unit.owner === owner && unit.kind === 'worker') {
      if (unit.deck) boarded.add(unit.id);
      else if (boarded.has(unit.id) && sameGround(game.map, unit, mine)) delivered = true;
    }
    const hall = game.buildings.find(building => building.owner === owner && building.kind === 'townHall'
      && building.complete && Math.hypot(building.x - mine.x, building.y - mine.y) < 400);
    built ||= hall !== undefined;
    if (hall) for (const [id, claim] of Object.entries(memories[owner]!.unitClaims)) {
      const unit = game.units.find(unit => unit.id === id);
      if (claim.kind === 'expansionGarrison' && claim.targetId === hall.id && unit && !unit.deck
        && Math.hypot(unit.x - hall.x, unit.y - hall.y) <= 650) defended = true;
    }
  } });
  expect(delivered).toBe(true);
  expect(built).toBe(true);
  expect(defended).toBe(true);
  expect(memories[owner]!.naval?.conquests?.[mine.id]?.stage).toBe('complete');
}, 180000);

it('redirects the real loaded settler back to its unfinished landing instead of another island', () => {
  const { snapshot, memory, options } = scene('sapphire', 'player-4');
  const boatId = 'unit-player-4-transport-2043';
  expect(memory.naval!.ferries![boatId]!.targetId).toBe('gold-enemy2-main');
  planBootstrapNaval(snapshot, 'player-4', options);
  expect(memory.naval!.conquests?.['gold-satellite-3']).toBeDefined();
  expect(memory.naval!.ferries![boatId]!.targetId).toBe('gold-satellite-3');
});

it('hands the actual overseas hall to a local guard without the naval claim stealing its order', () => {
  const owner = 'player-6', { game, snapshot, memory, version, options } = scene('sapphire', owner);
  const mineId = 'gold-satellite-5';
  expect(expansionGarrisonReady(snapshot, owner, options, mineId)).toBe(false);
  const entries = planBootstrapCommands(snapshot, owner, version, { memory, teams: game.teams });
  const guards = Object.entries(memory.unitClaims).filter(([, claim]) => claim.kind === 'expansionGarrison');
  expect(guards.length).toBeGreaterThan(0);
  expect(entries.some(entry => entry.scriptId === 'expansionGarrison' && 'unitIds' in entry.command
    && entry.command.unitIds.some(id => guards.some(([unitId]) => id === unitId)))).toBe(true);
});
