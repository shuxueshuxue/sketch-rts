import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { groundFrontThreat, groundUnitFacesFront } from '../policy/ground-threat';
import { averagePoint, distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { LOCAL_RANGE, planV6Army, planV6General } from '../policy/v6/general';
import { readV6Intel } from '../policy/v6/intel';
import { marchStrength, strengthOf } from '../policy/v6/strength';
import { mainArmyIntel, planBootstrapGeneral } from './mine-defense';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';

type Actual = {
  tick: number;
  snapshot: GameSnapshot;
  owner: string;
  options: AiPolicyContext;
  claims: { scriptId: string; ids: string[] }[];
  originalCommands: GameCommand[];
  originalPostGeneral: NonNullable<NonNullable<AiPolicyContext['memory']['v6']>['general']>;
  originalPostRetreatedAt: number;
};
const bytes = readFileSync(new URL('./fixtures/incoming-overlap-221325-221340.json.gz', import.meta.url));
const fixture = JSON.parse(gunzipSync(bytes).toString()) as {
  sourceHead: string;
  rulesVersion: number;
  provenance: { realGeneralRunBeforeArgs: boolean; completeWorldAndOptionsMemory: boolean; worldOrMemoryEdited: boolean };
  cases: Actual[];
};

function actual(tick: number) {
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('5adcfe133c187c0324750f59668a11c5582cb5a44a5912e5da6989bf632e72f6');
  expect(fixture.sourceHead).toBe('afda48c685f56548e2106cf5ed892d4622219fca');
  expect(fixture.rulesVersion).toBe(2);
  expect(fixture.provenance.realGeneralRunBeforeArgs).toBe(true);
  expect(fixture.provenance.completeWorldAndOptionsMemory).toBe(true);
  expect(fixture.provenance.worldOrMemoryEdited).toBe(false);
  const saved = structuredClone(fixture.cases.find(row => row.tick === tick)!);
  expect(saved.snapshot.tick).toBe(tick);
  expect(saved.options.requestedVersion).toBe('v7');
  expect(saved.claims).toHaveLength(23);
  expect(saved.claims.filter(row => row.ids.length).map(row => [row.scriptId, row.ids.length]))
    .toEqual([['v6Backline', 7]]);
  setBuildingBodies(saved.snapshot.map, [...saved.snapshot.buildings, ...(saved.snapshot.obstacles ?? [])]);
  return saved;
}

describe('bootstrap approaching armies count a facing unit once', () => {
  it('preserves the complete actual221325 General output before the later retreat', () => {
    const saved = actual(221325), world = structuredClone(saved.snapshot);
    expect(planBootstrapGeneral(saved.snapshot, saved.owner, saved.options)).toEqual(saved.originalCommands);
    expect(saved.options.memory.v6!.general).toEqual(saved.originalPostGeneral);
    expect(saved.options.memory.v6!.retreatedAt).toBe(saved.originalPostRetreatedAt);
    expect(saved.snapshot).toEqual(world);
  });

  it('does not repeat the actual221340 incoming retreat for six already-facing enemies', () => {
    const saved = actual(221340), world = structuredClone(saved.snapshot);
    const before = structuredClone(saved.options.memory.v6!);
    expect(saved.originalPostGeneral.mode).toBe('hold');
    expect(saved.originalPostRetreatedAt).toBe(221340);
    expect(saved.originalCommands).toHaveLength(1);
    const commands = planBootstrapGeneral(saved.snapshot, saved.owner, saved.options);
    expect(saved.options.memory.v6!.general!.mode).toBe('attack');
    expect(saved.options.memory.v6!.general!.targetHallId).toBe(before.general!.targetHallId);
    expect(saved.options.memory.v6!.retreatedAt).toBe(before.retreatedAt);
    expect(saved.options.memory.v6!.plays?.['general:retreat:incoming'])
      .toBe(before.plays?.['general:retreat:incoming']);
    const home = saved.originalPostGeneral.target!;
    expect(commands.some(command => 'x' in command && command.x === home.x && command.y === home.y)).toBe(false);
    expect(saved.snapshot).toEqual(world);
  });

  it.each(BOOTSTRAP_VERSIONS)('keeps the attack in the complete221340 world for %s (controlled family counterfactual outside summoner)', family => {
    const saved = actual(221340), world = structuredClone(saved.snapshot);
    const options = family === 'v9_summoner' ? saved.options
      : bootstrapPolicyContext(saved.snapshot, saved.owner, family, {
        teams: saved.options.teams!, memory: structuredClone(saved.options.memory),
      });
    if (family !== 'v9_summoner') {
      // The physical world, health, orders, army group and remembered enemy
      // positions stay actual. Only family context and its valid doctrine id
      // change; preserve the recorded steady personality rather than rerolling.
      const doctrine = options.doctrines!.find(candidate => candidate.race === saved.snapshot.players[saved.owner]!.race)!;
      options.memory.v6!.doctrine = { ...options.memory.v6!.doctrine!, strategyId: doctrine.id };
      expect(options.requestedVersion).toBe('v9');
    }
    const before = structuredClone(options.memory.v6!);
    planBootstrapGeneral(saved.snapshot, saved.owner, options);
    expect(options.memory.v6!.general!.mode).toBe('attack');
    expect(options.memory.v6!.general!.targetHallId).toBe(before.general!.targetHallId);
    expect(options.memory.v6!.retreatedAt).toBe(before.retreatedAt);
    expect(options.memory.v6!.plays?.['general:retreat:incoming'])
      .toBe(before.plays?.['general:retreat:incoming']);
    expect(saved.snapshot).toEqual(world);
  });

  it('uses the same real facing set as the front threat on the actual full world', () => {
    const { snapshot, owner, options } = actual(221340), intel = mainArmyIntel(snapshot, owner, options);
    const marching = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'spirit');
    expect(marching).toHaveLength(12);
    const center = averagePoint(marching);
    const repeated = intel.enemies.flatMap(enemy => enemy.army)
      .filter(unit => distance(unit, center) > LOCAL_RANGE && groundUnitFacesFront(snapshot, unit, marching));
    expect(repeated.map(unit => unit.id)).toEqual([
      'unit-p1-summoner-51903', 'unit-p1-spirit-293595', 'unit-p1-spirit-293597',
      'unit-p1-spirit-293599', 'unit-p1-spirit-294332', 'unit-p1-spirit-294369',
    ]);
    expect(strengthOf(repeated)).toBe(3.701688054735391);
    expect(groundFrontThreat(snapshot, intel, marching)).toBe(9.583964045471363);
  });
});

/** Ordinary native unit stats on an open component field, not a match outcome.
 * The explicit ArmyPlan below isolates incoming accounting from other jobs. */
function field(spread = false, enemyGap = 1200, approaching = true) {
  let scene = sketchScene('incoming-accounting-component').map('bareDuel').replaceDefaults()
    .player('p0', { race: 'grove', team: 'own' }).player('p1', { team: 'left' }).player('p2', { team: 'right' })
    .townHall('p0', 2000, 500, { id: 'home' }).townHall('p1', 500, 3500, { id: 'left-hall' })
    .townHall('p2', 3500, 3500, { id: 'right-hall' })
    .unit('p0', 'footman', spread ? 1100 : 2000, spread ? 2000 : 1960, { id: 'front-a' })
    .unit('p0', 'footman', spread ? 2900 : 2000, spread ? 2000 : 2040, { id: 'front-b' });
  if (spread) scene = scene.unit('p1', 'footman', 1000, 2000, { id: 'left' })
    .unit('p2', 'footman', 3000, 2000, { id: 'right' });
  else for (let i = 0; i < 4; i++) scene = scene.unit('p1', 'footman', 2000 + enemyGap, 1940 + i * 40, { id: `incoming-${i}` });
  const game = scene.build().createGame();
  game.tick = 1000;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  const snapshot = snapshotGame(game);
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const memory = createAiPolicyMemory(), options: AiPolicyContext = {
    version: 'v2', requestedVersion: 'v7', teams: game.teams,
    doctrines: structuredClone(fixture.cases[0]!.options.doctrines!), memory,
  };
  const intel = readV6Intel(snapshot, 'p0', options), own = intel.army;
  const center = averagePoint(own), target = intel.enemies[0]!.bases[0]!.hall;
  const enemyCenters = Object.fromEntries(intel.enemies.filter(enemy => enemy.center).map(enemy => {
    const now = enemy.center!, gap = distance(now, center), shift = approaching ? 30 : 0;
    return [enemy.owner, { x: now.x + (now.x - center.x) / gap * shift, y: now.y + (now.y - center.y) / gap * shift }];
  }));
  memory.v6 = {
    doctrine: { profileId: 'steady', strategyId: 'grove-raider-host', decidedTick: 0 },
    general: { mode: 'attack', target: { x: target.x, y: target.y }, targetHallId: target.id,
      group: own.map(unit => unit.id), groupStart: marchStrength(own), enemyCenters,
      enemyGaps: Object.fromEntries(intel.enemies.filter(enemy => enemy.center).map(enemy =>
        [enemy.owner, distance(enemy.center!, center) + (approaching ? 30 : 0)])) },
  };
  return { snapshot, options };
}

type Facing = Parameters<typeof planV6Army>[4]['unitFacing'];
function component(snapshot: GameSnapshot, options: AiPolicyContext, unitFacing: Facing, ground: boolean) {
  const intel = readV6Intel(snapshot, 'p0', options);
  const plan: Parameters<typeof planV6Army>[4] = {
    reinforcements: 'rally', expansionBasis: 'halls', reserveExpansion: true,
    pursue: () => true, recovery: () => [], gatherAssault: false,
    chooseCamp: () => undefined, startCamp: () => {}, campTerritory: 'home', chooseMine: () => undefined,
    threatWithin: (unit, point, range) => distance(unit, point) <= range,
    frontThreat: (world, front, center) => ground ? groundFrontThreat(snapshot, world, front)
      : world.enemies.reduce((total, enemy) => total + strengthOf(enemy.army.filter(unit => distance(unit, center) <= LOCAL_RANGE)), 0),
    unitFacing, respondingPower: () => 0, selectAttack: () => undefined,
    withinHomeReach: () => false, campOnOwnSide: () => false, defenseTarget: () => undefined,
    towerWaiting: () => [], waitForTowers: () => false,
  };
  return planV6Army(snapshot, 'p0', options, intel, plan);
}

describe('incoming accounting boundaries and the explicit legacy model', () => {
  it.each(['v6', 'v7'] as const)('removes only repeated facing strength in the %s incoming branch', requestedVersion => {
    const { snapshot, options } = field(true), legacy = structuredClone(options);
    options.requestedVersion = legacy.requestedVersion = requestedVersion;
    component(snapshot, legacy, () => false, true);
    expect(legacy.memory.v6!.retreatedAt).toBe(snapshot.tick);
    expect(legacy.memory.v6!.plays?.['general:retreat:incoming']).toBe(1);
    component(snapshot, options, (enemy, front) => groundUnitFacesFront(snapshot, enemy, front), true);
    expect(options.memory.v6!.general!.mode).toBe('attack');
    expect(options.memory.v6!.retreatedAt).toBeUndefined();
  });

  it.each(['v6', 'v7'] as const)('still retreats from a genuine nonoverlapping incoming army in %s', requestedVersion => {
    const { snapshot, options } = field();
    options.requestedVersion = requestedVersion;
    const intel = readV6Intel(snapshot, 'p0', options);
    expect(intel.enemies.flatMap(enemy => enemy.army).every(unit => !groundUnitFacesFront(snapshot, unit, intel.army))).toBe(true);
    component(snapshot, options, (enemy, front) => groundUnitFacesFront(snapshot, enemy, front), true);
    expect(options.memory.v6!.retreatedAt).toBe(snapshot.tick);
    expect(options.memory.v6!.plays?.['general:retreat:incoming']).toBe(1);
  });

  it('keeps the attack without an approaching or closing army', () => {
    for (const requestedVersion of ['v6', 'v7'] as const) {
      const { snapshot, options } = field(false, 1200, false);
      options.requestedVersion = requestedVersion;
      component(snapshot, options, (enemy, front) => groundUnitFacesFront(snapshot, enemy, front), true);
      expect(options.memory.v6!.general!.mode).toBe('attack');
      expect(options.memory.v6!.retreatedAt).toBeUndefined();
    }
  });

  it('keeps the existing strict15 approach and inclusive1500 range gates', () => {
    for (const movement of [15, 15.01]) {
      const { snapshot, options } = field(), intel = readV6Intel(snapshot, 'p0', options);
      const enemy = intel.enemies.find(row => row.owner === 'p1')!.center!;
      options.memory.v6!.general!.enemyCenters!.p1 = { x: enemy.x + movement, y: enemy.y };
      component(snapshot, options, (unit, front) => groundUnitFacesFront(snapshot, unit, front), true);
      expect(options.memory.v6!.retreatedAt).toBe(movement > 15 ? snapshot.tick : undefined);
    }
    for (const range of [1500, 1500.01]) {
      const { snapshot, options } = field(false, range);
      component(snapshot, options, (unit, front) => groundUnitFacesFront(snapshot, unit, front), true);
      expect(options.memory.v6!.retreatedAt).toBe(range <= 1500 ? snapshot.tick : undefined);
    }
  });

  it('preserves ordered output and complete memory for the explicit legacy centroid model at range boundaries', () => {
    for (const requestedVersion of ['v6', 'v7'] as const) for (const gap of [899.5, 900, 900.5, 1500, 1500.5]) {
      const { snapshot, options } = field(false, gap), legacy = structuredClone(options);
      options.requestedVersion = legacy.requestedVersion = requestedVersion;
      const commands = component(snapshot, options, (enemy, _front, center) => distance(enemy, center) <= LOCAL_RANGE, false);
      const oldCommands = component(snapshot, legacy, () => false, false);
      expect(commands).toEqual(oldCommands);
      expect(options.memory).toEqual(legacy.memory);
    }
  });

  it('wires the unchanged public default General to that centroid model', () => {
    const { snapshot, options } = field(), expected = structuredClone(options);
    const commands = planV6General(snapshot, 'p0', options);
    const legacy = component(snapshot, expected, () => false, false);
    expect(commands).toEqual(legacy);
    expect(options.memory).toEqual(expected.memory);
  });
});
