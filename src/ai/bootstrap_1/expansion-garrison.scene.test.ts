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
import { averagePoint, distance } from '../policy/spatial';

// Real v5-final-1 / ladder-16 / archer grove vs v9, at tick 4500 before its
// natural's foundation. Include construction so the task can prepare its defense
// before the hall completes, then check the actual post from tick 5100 onward.
const saved = JSON.parse(readFileSync(new URL('./fixtures/expansion-natural-3m45.json', import.meta.url), 'utf8')) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[];
  memories: Record<string, AiPolicyMemory>;
  agents: Record<string, AiGameAgent>; thinkInterval: number;
};

it('hands off the natural and resumes the same mine after a real enemy approach', () => {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  const naturalPoint = { x: 3696, y: 2000 };
  let naturalFoundationTick: number | undefined, naturalCompleteTick: number | undefined;
  let coverOrderTick: number | undefined;
  let protectedFrames = 0;
  let naturalId: string | undefined;
  let minimumStrength = Infinity;
  let firstUnguardedTick: number | undefined;
  let priorCamp: NonNullable<AiPolicyMemory['landExpansion']>['combat'];
  let avoided: { tick: number; mineId: string; center: { x: number; y: number }; retryUntil: number;
    nearby: string[]; threat: number; party: number } | undefined;
  let resumedTick: number | undefined;
  let resumedThreat: number | undefined;
  let clearedTick: number | undefined;
  let garrisonRecorded = false;
  const roadClearObjectives = new Set<string>();
  runGameLoop({ name: 'archer-natural-garrison-handoff', game, agents: saved.agents,
    maxTicks: 9600, thinkInterval: saved.thinkInterval,
    commandPlanner: navalObservedPlanner(memories),
  }, { beforeStep({ game }) {
    const task = memories.v9_archer!.landExpansion;
    const interruption = task?.interruptions.find(entry => entry.reason === 'camp-threat');
    const camp = priorCamp?.creep;
    if (!avoided && interruption && camp) {
      const party = game.units.filter(unit => camp.group.includes(unit.id));
      const center = averagePoint(party);
      const foes = game.units.filter(unit => unit.owner === 'p1' && unit.attackDamage > 0 && unit.kind !== 'worker');
      const nearby = foes.filter(unit => distance(unit, center) <= 900);
      avoided = { tick: interruption.tick, mineId: task!.mineId, center: camp.center,
        retryUntil: task!.combat!.creepRetry!.until, nearby: nearby.map(unit => unit.kind),
        threat: strengthOf(nearby), party: strengthOf(party) };
      expect(task!.combat!.creep).toBeUndefined();
    }
    const current = task?.combat?.creep;
    if (avoided && current && distance(current.center, avoided.center) < 1 && current.stage === 'engage'
      && resumedTick === undefined) {
      expect(task!.mineId).toBe(avoided.mineId);
      const party = game.units.filter(unit => current.group.includes(unit.id));
      const center = averagePoint(party);
      resumedTick = game.tick;
      resumedThreat = strengthOf(game.units.filter(unit => unit.owner === 'p1' && unit.attackDamage > 0
        && unit.kind !== 'worker' && distance(unit, center) <= 900));
      expect(resumedThreat).toBeLessThanOrEqual(strengthOf(party) * .5);
    }
  }, onCommand({ tick, owner, command }) {
    if (owner === 'v9_archer' && command.type === 'build' && command.buildingKind === 'defenseTower'
      && Math.hypot(command.x - 3535, command.y - 1856) <= BUILDING_DEFS.defenseTower.attackRange) coverOrderTick ??= tick;
  }, onStep({ game }) {
    naturalId ??= game.buildings.find(building => building.owner === 'v9_archer' && building.kind === 'townHall'
      && Math.hypot(building.x - naturalPoint.x, building.y - naturalPoint.y) < 100)?.id;
    const mission = memories.v9_archer!.landExpansion;
    if (mission?.roadCamp) roadClearObjectives.add(mission.mineId);
    if (mission?.combat?.creep) priorCamp = structuredClone(mission.combat);
    if (avoided && resumedTick && mission?.mineId === avoided.mineId
      && (mission.stage === 'escort' || mission.stage === 'build' || mission.stage === 'complete')) clearedTick ??= game.tick;
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
  expect(game.buildings.find(building => building.id === naturalId)?.hp, 'natural survives the raid while the original mine task continues').toBe(900);
  expect(naturalCompleteTick).toBeDefined();
  expect(coverOrderTick).toBeGreaterThan(naturalFoundationTick!);
  expect(naturalCompleteTick! - naturalFoundationTick!).toBe(BUILDING_DEFS.townHall.buildTime);
  expect(naturalCompleteTick!).toBeLessThanOrEqual(5298);
  expect(protectedFrames).toBeGreaterThanOrEqual(3000);
  expect(garrisonRecorded || minimumStrength === Infinity).toBe(true);
  // The intervening camp is a prerequisite of the same mine, not an unrelated errand.
  expect([...roadClearObjectives]).toEqual(['gold-gen-4']);
  // The changed main-army dispatch draws a real v9 force toward the clearing party.
  // The old snapshot tests correct avoidance and a same-mine retry, rather than
  // requiring the party to keep a deadline through a newly changed enemy attack.
  expect(avoided).toBeDefined();
  expect(avoided!.tick).toBe(6705);
  expect(avoided!.mineId).toBe('gold-gen-4');
  expect(avoided!.nearby).toEqual(Array(5).fill('emberRavager'));
  expect(avoided!.threat).toBeGreaterThan(avoided!.party * .5);
  expect(resumedTick).toBeGreaterThanOrEqual(avoided!.retryUntil);
  expect(clearedTick).toBeGreaterThan(resumedTick!);
  // The fresh-start full-AI scene in expansion-mission.test.ts owns the 7:30
  // completion deadline, separately from this handoff/hostile-approach fixture.
}, 30000);
