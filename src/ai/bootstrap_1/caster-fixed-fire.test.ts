import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { ABILITY_DEFS, unitMover } from '../../shared/catalog';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { capsuleClearsBodies, pointSegmentDistanceSquared } from '../../shared/navigation-math';
import { groundSteeringRoute } from '../../shared/route-selection';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { circleInPolygon, shipProfile, worldToLocal, type Point } from '../../shared/ship-geometry';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, Unit } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { planV6CasterScreen } from '../policy/v6/backline';
import { casterScreenOutsideFixedFire } from './caster-fixed-fire';
import { planBootstrapCasterScreen } from './caster-screen';
import { groundScreenMoves } from './ground-screen-goal';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { planSummonerScreen } from './summoner-screen';
import { recoveryArrivalFilter } from './recovery-arrival';

type Move = Extract<GameCommand, { type: 'move' }>;
type Saved = {
  snapshot: GameSnapshot;
  plannerSnapshot: GameSnapshot;
  nextId: number;
  memories: Record<string, AiPolicyMemory>;
  setup: { rulesVersion: number };
  entries?: { playerId: string; scriptId: string; command: GameCommand }[];
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function actual(tick: 159645 | 159660) {
  const bytes = readFileSync(new URL('./fixtures/caster-fixed-fire-c3-159645-159660.json.gz', import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('caa6db03b55bd7071c1b678098884204d464799bbdd682d6b54d9747d01fed6b');
  const fixture = JSON.parse(gunzipSync(bytes).toString()) as {
    sourceHead: string; contexts: Record<string, { before: Saved; after: Saved }>;
  };
  expect(fixture.sourceHead).toBe('46626b4edf32e567f3a18bf548eb154308aa1bfa');
  const pair = fixture.contexts[String(tick)]!;
  expect(pair.before.snapshot).toEqual(pair.before.plannerSnapshot);
  expect(pair.before.plannerSnapshot).toEqual(pair.after.plannerSnapshot);
  expect(pair.before.snapshot.tick).toBe(tick);
  expect(pair.before.setup.rulesVersion).toBe(2);
  expect(Object.keys(pair.before.memories).sort()).toEqual(['p0', 'p1', 'p2']);
  const snapshot = pair.before.plannerSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', {
    teams: snapshot.teams!, memory: structuredClone(pair.before.memories.p0!),
  });
  const selected = pair.after.entries!.filter(entry => entry.playerId === 'p0' && entry.scriptId === 'v6Backline')
    .map(entry => entry.command);
  expect(selected).toHaveLength(7);
  return { pair, snapshot, options, selected };
}

// Independent physical assertions: use actual building stats and native road
// segments, rather than calling the production admission predicate again.
function expectOutsideTowerRoad(snapshot: GameSnapshot, actor: Unit, move: Move) {
  const road = groundSteeringRoute(snapshot.map, actor, move);
  expect(distance(road.at(-1)!, move)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
  for (const tower of snapshot.buildings.filter(building => building.owner !== actor.owner
    && snapshot.teams?.[building.owner] !== snapshot.teams?.[actor.owner]
    && building.hp > 0 && building.complete && building.attackDamage > 0)) {
    for (let i = 1; i < road.length; i++) expect(Math.sqrt(pointSegmentDistanceSquared(tower, road[i - 1]!, road[i]!)))
      .toBeGreaterThan(tower.attackRange + actor.radius);
  }
}

/** Counterfactual component field, with ordinary native stats and real commands.
 * It is not a new ordinary0 match or evidence of complete-game success. */
function field(casterX = 1100, towerOwner: 'us' | 'foe' | 'ally' = 'foe', pressured = false) {
  let scene = sketchScene('caster-fixed-fire-component').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('ally', { race: 'grove', team: 'a' })
    .player('foe', { race: 'ember', team: 'b' })
    .townHall('us', 400, 400).townHall('ally', 400, 3500).townHall('foe', 3500, 3500)
    .unit('us', 'summoner', casterX, 2000, { id: 'caster' })
    .tower(towerOwner, 2000, 2000, { id: 'tower' });
  if (pressured) scene = scene.unit('foe', 'archer', casterX - 250, 2000, { id: 'rear-shooter' });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const caster = game.units.find(unit => unit.id === 'caster')!;
  const tower = game.buildings.find(building => building.id === 'tower')!;
  const snapshot = snapshotGame(game), options: AiPolicyContext = { teams: game.teams, memory: createAiPolicyMemory() };
  return { game, snapshot, caster, tower, options };
}

describe('bootstrap chosen caster moves outside fixed fire', () => {
  it('preserves every actual safe159645 screen command and complete policy inputs', () => {
    const { pair, snapshot, options, selected } = actual(159645);
    const before = structuredClone({ pair, options, selected });
    for (const command of selected) {
      expect(command.type).toBe('move');
      if (command.type !== 'move') throw Error('Expected actual screen move');
      expectOutsideTowerRoad(snapshot, snapshot.units.find(unit => unit.id === command.unitIds[0])!, command);
    }
    expect(casterScreenOutsideFixedFire(snapshot, 'p0', options, selected)).toBe(selected);
    expect(planSummonerScreen(snapshot, 'p0', options)).toEqual(selected);
    expect({ pair, options, selected }).toEqual(before);
  });

  it('admits clear forward actions at actual159660 and holds bodies with no selected clear step', () => {
    const { pair, snapshot, options, selected } = actual(159660);
    const before = structuredClone({ pair, options, selected });
    const result = casterScreenOutsideFixedFire(snapshot, 'p0', options, selected);
    expect(result).toHaveLength(7);
    let advancing = 0;
    for (let i = 0; i < result.length; i++) {
      const replacement = result[i]!, original = selected[i]!;
      expect(replacement).not.toEqual(original);
      expect('unitIds' in replacement && replacement.unitIds).toEqual('unitIds' in original && original.unitIds);
      if (replacement.type === 'holdPosition') continue;
      expect(replacement.type).toBe('move');
      if (replacement.type !== 'move' || original.type !== 'move') throw Error('This actual early front has short progress');
      const caster = snapshot.units.find(unit => unit.id === replacement.unitIds[0])!;
      expect(replacement.unitIds).toEqual(original.unitIds);
      expect(replacement.avoidCombat).toBe(true);
      expect(distance(caster, replacement)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
      expect(distance(replacement, original)).toBeLessThan(distance(caster, original));
      advancing++;
      expectOutsideTowerRoad(snapshot, caster, replacement);
      const road = groundSteeringRoute(snapshot.map, caster, replacement);
      const bodies = snapshot.units.filter(unit => unit.id !== caster.id && !unit.deck
        && unitMover(unit.kind) === 'land' && !(unit.kind === 'worker' && unit.order.type === 'mine'));
      for (let index = 1; index < road.length; index++) {
        expect(capsuleClearsBodies(road[index - 1]!, road[index]!, caster.radius, bodies)).toBe(true);
        expect(constrainGroundShipStep(snapshot.map, caster, road[index - 1]!, road[index]!, snapshot.units))
          .toEqual(road[index]);
      }
      expect(recoveryArrivalFilter(snapshot, caster, 15)(replacement)).toBe(true);
    }
    expect(advancing).toBeGreaterThan(0);
    // The first candidate really published this blocked step for15312. It is
    // a retained negative physical witness, not permission to walk through it.
    const crowded = snapshot.units.find(unit => unit.id === 'unit-p0-summoner-15312')!;
    const blockedPoint = { x: 2533.9868230898333, y: 4707.436775755676 };
    const neighbors = snapshot.units.filter(unit => unit.id !== crowded.id && unit.hp > 0 && !unit.deck
      && unitMover(unit.kind) === 'land');
    expect(capsuleClearsBodies(crowded, blockedPoint, crowded.radius, neighbors)).toBe(false);
    expect(result.find(command => 'unitIds' in command && command.unitIds.includes(crowded.id))?.type).toBe('holdPosition');
    expect(planSummonerScreen(snapshot, 'p0', options)).toEqual(result);
    expect({ pair, options, selected }).toEqual(before);
  });

  it('makes native progress toward the preference when only armed buildings remain', () => {
    const { game, snapshot, caster, tower, options } = field();
    expect(game.units.filter(unit => unit.owner === 'foe')).toHaveLength(0);
    const selected: GameCommand[] = [{ type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y }];
    const result = casterScreenOutsideFixedFire(snapshot, 'us', options, selected), start = { x: caster.x, y: caster.y };
    expect(result).not.toEqual(selected);
    expect(result[0]!.type).toBe('move');
    for (const command of result) issuePlayerCommand(game, 'us', command);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    expect(distance(caster, start)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
    expect(distance(caster, tower)).toBeLessThan(distance(start, tower));
    expect(caster.hp).toBe(caster.maxHp);
  });

  it('rejects a tower-crossing native road even when its far endpoint is safe', () => {
    const { snapshot, caster, tower, options } = field();
    const command: Move = { type: 'move', unitIds: [caster.id], x: 3000, y: caster.y };
    expect(distance(command, tower)).toBeGreaterThan(tower.attackRange + caster.radius);
    const originalRoad = groundSteeringRoute(snapshot.map, caster, command);
    expect(originalRoad.slice(1).some((point, i) =>
      pointSegmentDistanceSquared(tower, originalRoad[i]!, point) <= tower.attackRange ** 2)).toBe(true);
    const [replacement] = casterScreenOutsideFixedFire(snapshot, 'us', options, [command]);
    expect(replacement).not.toEqual(command);
    expect(replacement!.type).toBe('move');
    if (replacement!.type !== 'move') throw Error('Open ground has a usable short waypoint');
    expectOutsideTowerRoad(snapshot, caster, replacement);
  });

  it('uses a real outward escape instead of holding a caster already under tower fire', () => {
    const { game, snapshot, caster, tower, options } = field(1800), start = { x: caster.x, y: caster.y };
    expect(distance(caster, tower)).toBeLessThan(tower.attackRange);
    const result = casterScreenOutsideFixedFire(snapshot, 'us', options,
      [{ type: 'move', unitIds: [caster.id], x: 2300, y: caster.y }]);
    expect(result[0]!.type).toBe('move');
    for (const command of result) issuePlayerCommand(game, 'us', command);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    expect(distance(caster, tower)).toBeGreaterThan(distance(start, tower));
    expect(game.units.some(unit => unit.id === caster.id)).toBe(true);
  });

  it('does not trade a mobile attacker margin for entering previously clear tower fire', () => {
    const { snapshot, caster, tower, options } = field(1500, 'foe', true);
    const shooter = snapshot.units.find(unit => unit.id === 'rear-shooter')!;
    expect(distance(caster, shooter)).toBeLessThan(shooter.attackRange);
    expect(distance(caster, tower)).toBeGreaterThan(tower.attackRange + caster.radius);
    const result = casterScreenOutsideFixedFire(snapshot, 'us', options,
      [{ type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y }]);
    for (const command of result) if (command.type === 'move') expectOutsideTowerRoad(snapshot, caster, command);
  });

  it('does not bind a new escape goal to a dead hull still awaiting native cleanup', () => {
    const { snapshot, caster, tower, options } = field();
    const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/backline-ground-5b5-123600.json.gz', import.meta.url))).toString()) as Saved;
    const model = saved.snapshot.units.find(unit => shipProfile(unit))!;
    snapshot.units.push({ ...structuredClone(model), id: 'dead-hull-before-cleanup', hp: 0,
      x: caster.x + 48, y: caster.y, heading: 0, order: { type: 'idle' } });
    const result = casterScreenOutsideFixedFire(snapshot, 'us', options,
      [{ type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y }]);
    for (const command of result) if (command.type === 'move') expect(snapshot.units.some(ship => {
      const profile = shipProfile(ship);
      return profile && circleInPolygon(worldToLocal(ship, command), 0, profile.hull);
    })).toBe(false);
  });

  it.each(['far', 'ally', 'friendly', 'unarmed', 'incomplete', 'dead'] as const)(
    'keeps the exact selected move for the %s building counterexample', kind => {
      const f = field(1100, kind === 'ally' ? 'ally' : kind === 'friendly' ? 'us' : 'foe');
      const tower = f.snapshot.buildings.find(building => building.id === 'tower')!;
      if (kind === 'far') { tower.x = 3500; tower.y = 3500; }
      if (kind === 'unarmed') tower.attackDamage = 0;
      if (kind === 'incomplete') tower.complete = false;
      if (kind === 'dead') tower.hp = 0;
      setBuildingBodies(f.snapshot.map, f.snapshot.buildings.filter(building => building.hp > 0));
      const selected: GameCommand[] = [{ type: 'move', unitIds: [f.caster.id], x: 2300, y: 2000, avoidCombat: true }];
      expect(casterScreenOutsideFixedFire(f.snapshot, 'us', f.options, selected)).toBe(selected);
    });

  it.each(BOOTSTRAP_VERSIONS)('%s preserves close support reach against mobile units without a relevant tower', version => {
    let scene = sketchScene('fixed-fire-close-support-counterexample').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', 500, 1500).townHall('foe', 3500, 3500)
      .unit('us', 'witch', 1600, 1500, { id: 'support' }).unit('foe', 'archer', 2050, 1500)
      .tower('foe', 3500, 3000);
    for (let index = 0; index < 4; index++) scene = scene.unit('us', 'footman', 1960, 1440 + index * 30);
    const game = scene.build().createGame(), snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'us', version, { teams: game.teams, memory: createAiPolicyMemory() });
    // Summoner-route support also deliberately uses close=true in its own formation.
    const commands = version === 'v9_summoner' ? planSummonerScreen(snapshot, 'us', options)
      : planBootstrapCasterScreen(snapshot, 'us', options);
    const support = commands.find(command => command.type === 'move' && command.unitIds.includes('support'));
    expect(support?.type).toBe('move');
    if (support?.type !== 'move') throw Error('Expected the existing close support station');
    expect(distance(support, { x: 2050, y: 1500 })).toBeLessThanOrEqual(ABILITY_DEFS.curse.plannerRange);
    if (version !== 'v9_summoner') expect(commands).toEqual(planV6CasterScreen(snapshot, 'us', options));
  });

  it('preserves queued work, explicit spells and unavailable ownership', () => {
    const { snapshot, caster, tower, options } = field();
    const commands: GameCommand[] = [
      { type: 'cast', unitId: caster.id, ability: 'summon', x: caster.x + 100, y: caster.y },
      { type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y, queued: true },
      { type: 'attack', unitIds: [caster.id], targetId: tower.id },
    ];
    expect(casterScreenOutsideFixedFire(snapshot, 'us', options, commands)).toBe(commands);
    const immediate: GameCommand[] = [{ type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y }];
    expect(casterScreenOutsideFixedFire(snapshot, 'us', options, immediate, new Set([caster.id]))).toBe(immediate);
    snapshot.units.find(unit => unit.id === caster.id)!.orderQueue = [{ type: 'hold', x: caster.x, y: caster.y }];
    expect(casterScreenOutsideFixedFire(snapshot, 'us', options, immediate)).toBe(immediate);
  });

  it('does not take naval ferry work or redirect summoned front bodies', () => {
    const { snapshot, caster, tower, options } = field();
    const commands: GameCommand[] = [{ type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y }];
    options.memory.naval = { ferries: { boat: { purpose: 'assault', targetId: tower.id,
      from: caster, to: tower, phase: 'loading', crewIds: [caster.id], sinceTick: snapshot.tick } } };
    expect(casterScreenOutsideFixedFire(snapshot, 'us', options, commands)).toBe(commands);
    delete options.memory.naval;
    snapshot.units.find(unit => unit.id === caster.id)!.kind = 'spirit';
    expect(casterScreenOutsideFixedFire(snapshot, 'us', options, commands)).toBe(commands);
  });

  it('keeps an absent command outside this move-only owner repair', () => {
    const { snapshot, caster, tower, options } = field();
    snapshot.units.find(unit => unit.id === caster.id)!.order = { type: 'attack', targetId: tower.id,
      leashX: caster.x, leashY: caster.y };
    const commands: GameCommand[] = [], before = structuredClone({ snapshot, options });
    expect(casterScreenOutsideFixedFire(snapshot, 'us', options, commands)).toBe(commands);
    expect({ snapshot, options }).toEqual(before);
  });

  it('retains native hull clearance when fixed fire rejects a real-shore screen goal', () => {
    const bytes = readFileSync(new URL('./fixtures/backline-ground-5b5-123600.json.gz', import.meta.url));
    const saved = JSON.parse(gunzipSync(bytes).toString()) as Saved;
    const snapshot = saved.snapshot, caster = snapshot.units.find(unit => unit.id === 'unit-p0-summoner-60228')!;
    setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
    const options: AiPolicyContext = { teams: snapshot.teams!, memory: structuredClone(saved.memories.p0!) };
    // Explicit counterfactual tower placement on a complete real shoreline;
    // this is not claimed to be the historical reason for that earlier loss.
    const model = snapshot.buildings.find(building => building.complete && building.attackDamage > 0)!;
    const tower = { ...structuredClone(model), id: 'counterfactual-shore-tower', owner: 'p1',
      x: caster.x + 500, y: caster.y - 100 };
    snapshot.buildings.push(tower);
    setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
    const selected = groundScreenMoves(snapshot, 'p0', options,
      [{ type: 'move', unitIds: [caster.id], x: tower.x, y: tower.y }]);
    const result = casterScreenOutsideFixedFire(snapshot, 'p0', options, selected);
    for (const command of result) if (command.type === 'move') {
      const road = groundSteeringRoute(snapshot.map, caster, command);
      for (let index = 1; index < road.length; index++) expect(
        constrainGroundShipStep(snapshot.map, caster, road[index - 1]!, road[index]!, snapshot.units),
      ).toEqual(road[index]);
      expect(snapshot.units.some(ship => {
        const profile = shipProfile(ship);
        return profile && circleInPolygon(worldToLocal(ship, command), 0, profile.hull);
      })).toBe(false);
    }
  });
});
