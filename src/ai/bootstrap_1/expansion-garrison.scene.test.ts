import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AiGameAgent } from '../game-runner';
import { strengthOf } from '../policy/v6/strength';
import { unitMover, BUILDING_DEFS } from '../../shared/catalog';
import { runGameLoop } from '../../sdk/game-runner';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';

// Real v5-final-1 / ladder-16 / archer grove vs v9, at tick 4500 before its
// natural's foundation. Include construction so the task can prepare its defense
// before the hall completes, then check the actual post from tick 5100 onward.
const saved = JSON.parse(readFileSync(new URL('./fixtures/expansion-natural-3m45.json', import.meta.url), 'utf8')) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[];
  memories: Record<string, AiPolicyMemory>;
  agents: Record<string, AiGameAgent>; thinkInterval: number;
};

it('keeps the completed natural defended while the remaining troops establish the third', () => {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  const naturalPoint = { x: 3696, y: 2000 };
  let naturalFoundationTick: number | undefined, naturalCompleteTick: number | undefined;
  let coverOrderTick: number | undefined;
  let protectedFrames = 0;
  const naturalId = 'building-v9_archer-townHall-1553';
  let minimumStrength = Infinity;
  let firstUnguardedTick: number | undefined;
  let thirdFoundationTick: number | undefined;
  let thirdCompleteTick: number | undefined;
  let garrisonRecorded = false;
  const roadClearObjectives = new Set<string>();
  runGameLoop({ name: 'archer-natural-garrison-handoff', game, agents: saved.agents,
    maxTicks: 9000, thinkInterval: saved.thinkInterval,
    commandPlanner: navalObservedPlanner(memories),
  }, { onCommand({ tick, owner, command }) {
    if (owner === 'v9_archer' && command.type === 'build' && command.buildingKind === 'defenseTower'
      && Math.hypot(command.x - 3535, command.y - 1856) <= BUILDING_DEFS.defenseTower.attackRange) coverOrderTick ??= tick;
  }, onStep({ game }) {
    const mission = memories.v9_archer!.landExpansion;
    if (mission?.roadCamp) roadClearObjectives.add(mission.mineId);
    const third = game.buildings.find(building => building.owner === 'v9_archer'
      && building.kind === 'townHall' && building.id !== 'building-v9_archer-townhall' && building.id !== naturalId);
    if (third) thirdFoundationTick ??= game.tick;
    if (third?.complete) thirdCompleteTick ??= game.tick;
    garrisonRecorded ||= Object.values(memories.v9_archer!.unitClaims)
      .some(claim => claim.kind === 'expansionGarrison' && claim.targetId === naturalId);
    const natural = game.buildings.find(building => building.id === naturalId);
    if (natural) naturalFoundationTick ??= game.tick;
    if (natural?.complete) naturalCompleteTick ??= game.tick;
    if (game.tick < 5100) return;
    protectedFrames++;
    const minePoint = { x: 3535, y: 1856 };
    const covered = game.buildings.some(building => building.owner === 'v9_archer' && building.complete
      && building.attackDamage > 0 && Math.hypot(building.x - naturalPoint.x, building.y - naturalPoint.y) <= building.attackRange + (natural?.radius ?? 64)
      && Math.hypot(building.x - minePoint.x, building.y - minePoint.y) <= building.attackRange);
    if (covered) return;
    const guards = game.units.filter(unit => unit.owner === 'v9_archer' && unit.kind !== 'worker'
      && !unit.deck && unit.expiresTick === undefined && unitMover(unit.kind) === 'land' && unit.attackDamage > 0
      && Math.hypot(unit.x - naturalPoint.x, unit.y - naturalPoint.y) <= 650);
    minimumStrength = Math.min(minimumStrength, strengthOf(guards));
    if (strengthOf(guards) < 1) firstUnguardedTick ??= game.tick;
  } });
  expect(firstUnguardedTick, 'first tick below a footman of defense and without completed static cover').toBeUndefined();
  expect(minimumStrength).toBeGreaterThanOrEqual(1);
  expect(game.buildings.find(building => building.id === naturalId)?.hp, 'natural survives the raid while the third finishes').toBe(900);
  expect(naturalCompleteTick).toBeDefined();
  expect(coverOrderTick).toBeGreaterThan(naturalFoundationTick!);
  expect(naturalCompleteTick! - naturalFoundationTick!).toBe(BUILDING_DEFS.townHall.buildTime);
  expect(naturalCompleteTick!).toBeLessThanOrEqual(5298);
  expect(protectedFrames).toBeGreaterThanOrEqual(3000);
  expect(garrisonRecorded || minimumStrength === Infinity).toBe(true);
  // The intervening camp is a prerequisite of the same mine, not an unrelated errand.
  expect([...roadClearObjectives]).toEqual(['gold-gen-4']);
  // Original third: foundation 7782 (6:29.1), completion 8342 (6:57.1).
  // Allow thirty seconds for the natural's handoff, with a hard 7:30 limit on completion.
  expect(thirdFoundationTick).toBeDefined();
  expect(thirdFoundationTick!).toBeLessThanOrEqual(8382);
  expect(thirdCompleteTick).toBeDefined();
  expect(thirdCompleteTick!).toBeLessThanOrEqual(8942);
}, 30000);
