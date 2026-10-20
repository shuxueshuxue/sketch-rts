import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { neutralCamps, creepForce } from '../policy/v7/creep';
import { strengthOf } from '../policy/v6/strength';
import { assessAllocatedCampBattle, assessAllocatedCampEngagement, assessAllocatedForce, assessPostBattleSiteRisk, assessPresentCampEngagement } from './allocated-force';
import { combatCapability } from '../../shared/combat-capabilities';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { buildStrategyDecision } from './decision';
import { landIdAt } from './regions';
import { strategicTargetCamp } from './target-camp';
import type { Arrival, Situation, SituationUnit, Target } from './types';
import type { AiPolicyMemory } from '../memory';
import { setBuildingBodies, walkableGoal } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';

function sapphire() {
  const frame: { snapshot: GameSnapshot; owner: PlayerId; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Ne-sapphireArchipelago-player-4-17991'];
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  return frame;
}

describe('allocated cohort force', () => {
  it('quotes the real sapphire landed party and its four proposed reinforcements as whole groups', () => {
    const data = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()) as {
      frames: Record<string, { snapshot: GameSnapshot; owner: PlayerId }>;
    };
    const { snapshot, owner } = data.frames['Ne-sapphireArchipelago-player-4-17991']!;
    const mine = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
    const camp = neutralCamps(snapshot).sort((a, b) => Math.hypot(a.center.x - mine.x, a.center.y - mine.y)
      - Math.hypot(b.center.x - mine.x, b.center.y - mine.y))[0]!;
    const landed = snapshot.units.find(unit => unit.id === 'unit-player-4-emberRavager-3661')!;
    const reinforcements = snapshot.units.filter(unit => ['5287', '5642', '5789', '5909']
      .some(id => unit.id === `unit-player-4-emberRavager-${id}`));
    expect(reinforcements).toHaveLength(4);
    const alone = assessAllocatedForce(owner, [landed], { metric: 'camp-force', camp });
    const together = assessAllocatedForce(owner, [landed, ...reinforcements], { metric: 'camp-force', camp });
    expect(alone.force).toBeCloseTo(0.9461, 3);
    expect(alone.requiredForce).toBeCloseTo(4.1127, 3);
    expect(alone.sufficient).toBe(false);
    expect(together.force).toBeCloseTo(4.7307, 3);
    expect(together.sufficient).toBe(true);
    expect(together.unitIds).toHaveLength(5);
  });

  it('recomputes free volleys when the allocator adds or removes a shooter', () => {
    const game = sketchScene('allocated-camp-cohort').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .unit('us', 'archer', 1000, 1000).unit('us', 'archer', 1050, 1000)
      .unit('neutral', 'ogreWarrior', 1500, 1500).unit('neutral', 'ogreMage', 1550, 1500).build().createGame();
    const snapshot = snapshotGame(game), camp = neutralCamps(snapshot)[0]!;
    const group = snapshot.units.filter(unit => unit.owner === 'us');
    const total = assessAllocatedForce('us', group, { metric: 'camp-force', camp });
    const singletonSum = group.reduce((sum, unit) => sum + assessAllocatedForce('us', [unit], { metric: 'camp-force', camp }).force, 0);
    expect(total.force).toBe(creepForce(group, camp));
    expect(total.force).toBeGreaterThan(singletonSum);
    expect(assessAllocatedForce('us', group.slice(0, 1), { metric: 'camp-force', camp }).force).toBeLessThan(total.force);
    const before = JSON.stringify(snapshot);
    expect(assessAllocatedForce('us', [...group].reverse(), { metric: 'camp-force', camp })).toEqual(total);
    const foe = { ...group[0]!, id: 'foe', owner: 'foe' }, dead = { ...group[0]!, id: 'dead', hp: 0 };
    expect(assessAllocatedForce('us', [...group, ...group, foe, dead], { metric: 'camp-force', camp })).toEqual(total);
    expect(assessAllocatedForce('us', group, { metric: 'field-strength', requiredForce: 1 }).force).toBe(strengthOf(group));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('shared camp engagement facts', () => {
  it('uses exactly the forecast combat currency when every participant has physically arrived', () => {
    const scene = sketchScene('present-camp-force').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .unit('neutral', 'ogreWarrior', 1400, 1400).unit('foe', 'footman', 1450, 1400);
    for (let i = 0; i < 6; i++) scene.unit('us', 'emberRavager', 1200 + i * 5, 1400);
    const snapshot = snapshotGame(scene.build().createGame()), camp = neutralCamps(snapshot)[0]!;
    const ours = snapshot.units.filter(unit => unit.owner === 'us'), enemy = snapshot.units.find(unit => unit.owner === 'foe')!;
    const target: Target = { entityId: 'mine', landId: landIdAt(snapshot.map, camp.center)!, point: camp.center };
    const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, lands: [], seas: [], assets: [],
      opportunities: [], limitations: [], economy: { cashGold: 0, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] },
      units: [{ id: enemy.id, owner: enemy.owner, kind: enemy.kind, location: { kind: 'land', landId: target.landId!, point: enemy },
        hp: enemy.hp, maxHp: enemy.maxHp, strength: 999999, roles: ['frontline'], expiresTick: null, commitments: [],
        arrivals: [{ targetId: 'mine', arrival: { status: 'reachable', ticks: 0, landTicks: 0, crossings: [], evidence: [] } }] }] };
    const before = JSON.stringify({ snapshot, situation });
    const physical = assessPresentCampEngagement({ snapshot, owner: 'us', target, unitIds: ours.map(unit => unit.id),
      campMemberIds: camp.creeps.map(unit => unit.id) });
    const forecast = assessAllocatedCampBattle({ snapshot, situation, target, unitIds: ours.map(unit => unit.id), battleStartTicks: 0 });
    expect(forecast.status).toBe('known');
    expect(physical.actualOpponentForce).toBe(forecast.actualOpponentForce);
    expect(physical.ourForce).toBe(forecast.ourForce);
    expect(physical.requiredForce).toBe(forecast.requiredForce);
    expect(physical.camp.creeps).toEqual(camp.creeps);
    expect(physical.camp.creeps).not.toContain(enemy);
    expect(physical.hostile).toEqual([enemy]);
    expect(assessPresentCampEngagement({ snapshot, owner: 'us', target, unitIds: [], campMemberIds: camp.creeps.map(unit => unit.id) }))
      .toMatchObject({ ours: [], ourForce: 0, sufficient: false });
    expect(JSON.stringify({ snapshot, situation })).toBe(before);
  });

  it('converges actual reinforcement waves and keeps later asset threats outside the first fight', () => {
    const game = sketchScene('camp-battle-waves').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .unit('us', 'archer', 1000, 1000).unit('us', 'archer', 1050, 1000)
      .unit('neutral', 'ogreWarrior', 1500, 1500)
      .unit('foe', 'footman', 1600, 1600).unit('foe', 'footman', 1650, 1600)
      .unit('foe', 'footman', 1700, 1600).unit('foe', 'footman', 1750, 1600).build().createGame();
    const snapshot = snapshotGame(game), target: Target = { entityId: 'mine', landId: 'land:1', point: { x: 1500, y: 1500 } };
    const ours = snapshot.units.filter(unit => unit.owner === 'us'), enemies = snapshot.units.filter(unit => unit.owner === 'foe');
    const dps = ours.reduce((sum, unit) => sum + combatCapability(snapshot, unit).dps, 0), camp = strategicTargetCamp(snapshot, target)!;
    const initialTicks = Math.ceil(camp.creeps.reduce((sum, unit) => sum + unit.hp, 0) / dps * SIM_TICKS_PER_SECOND);
    const extension = Math.ceil(enemies[0]!.hp / dps * SIM_TICKS_PER_SECOND), starts = 20;
    const etas = [starts + initialTicks - 1, starts + initialTicks + Math.floor(extension / 2),
      starts + initialTicks + Math.floor(1.5 * extension), starts + initialTicks + 3 * extension + 100];
    const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, lands: [], seas: [], assets: [],
      opportunities: [], limitations: [], economy: { cashGold: 0, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] },
      units: enemies.map((unit, i) => ({ id: unit.id, owner: unit.owner, kind: unit.kind,
        location: { kind: 'land', landId: 'land:1', point: unit }, hp: unit.hp, maxHp: unit.maxHp, strength: 999999,
        roles: ['frontline'], expiresTick: null, commitments: [], arrivals: [{ targetId: 'mine',
          arrival: { status: 'reachable', ticks: etas[i]!, landTicks: etas[i]!, crossings: [], evidence: [] } }] })) };
    const input = { snapshot, situation, target, unitIds: ours.map(unit => unit.id), battleStartTicks: starts };
    const before = JSON.stringify(input), battle = assessAllocatedCampBattle(input);
    expect(battle).toMatchObject({ status: 'known', converged: true, reasonCode: 'camp-battle-converged' });
    expect(battle.iterations).toBeGreaterThan(2);
    expect(battle.engagement.enRouteEnemyIds).toEqual(enemies.slice(0, 3).map(unit => unit.id).sort());
    expect(battle.engagement.memberIds).not.toContain(enemies[3]!.id);
    expect(battle.battleUntilTicks).toBeLessThan(etas[3]!);
    expect(assessAllocatedCampBattle({ ...input, maxIterations: 1 })).toMatchObject({ status: 'unknown',
      converged: false, reasonCode: 'camp-battle-iteration-limit', successProbability: null, ourForce: null });
    const post = assessPostBattleSiteRisk({ snapshot, situation, target, battleStartTicks: battle.battleUntilTicks,
      windowTicks: 1000, excludedEnemyIds: battle.engagement.memberIds,
      survivingPermanentCampForce: battle.attrition.survivingCampForce, plannedAssetRadius: BUILDING_DEFS.townHall.radius });
    expect(post.memberIds).toEqual([enemies[3]!.id]);
    expect(post.opponentForce).toBeGreaterThan(0);
    expect(post.ownForce).toBe(battle.attrition.survivingCampForce);
    expect(battle.attrition.survivors.reduce((sum, unit) => sum + unit.hp, 0))
      .toBeCloseTo(ours.reduce((sum, unit) => sum + unit.hp, 0) - battle.attrition.expectedHpLost);
    expect(assessAllocatedCampBattle(JSON.parse(JSON.stringify(input)))).toEqual(battle);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps the real sapphire guards, departure margin and same-cohort force separate without mutating the frame', () => {
    const frame = sapphire(), { snapshot, owner } = frame;
    const decision = buildStrategyDecision(snapshot, owner, { memory: frame.memory }, undefined, undefined, Infinity);
    const target = decision.objectives.find(objective => objective.kind === 'ConquerIsland'
      && objective.target.entityId === 'gold-satellite-2')!.target;
    const unitIds = [3661, 5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    const before = JSON.stringify({ snapshot, situation: decision.situation });
    const assessed = assessAllocatedCampEngagement({ snapshot, situation: decision.situation, target, unitIds,
      battleStartTicks: 1200, windowTicks: 2400 });
    const camp = strategicTargetCamp(snapshot, target)!;
    expect(assessed.status).toBe('known');
    expect(assessed.memberIds).toEqual([...camp.creeps.map(unit => unit.id),
      'unit-enemy2-priest-4362', 'unit-enemy2-priest-5083', 'unit-enemy2-raider-5106',
      'unit-enemy2-witch-4879', 'unit-player-5-summoner-5591'].sort());
    expect(assessed.actualOpponentForce).toBeGreaterThan(camp.strength);
    expect(assessed.margin).toBeCloseTo(1.5);
    expect(assessed.requiredForce).toBeCloseTo(assessed.actualOpponentForce! + 1.5);
    expect(assessed.ourForce).toBe(creepForce(snapshot.units.filter(unit => unitIds.includes(unit.id)), assessed.opposition));
    const battle = assessAllocatedCampBattle({ snapshot, situation: decision.situation, target, unitIds, battleStartTicks: 1200 });
    expect(battle.attrition.deadUnitIds).toEqual(['unit-player-4-emberRavager-3661']);
    expect(battle.attrition.expectedLossGold).toBe(UNIT_DEFS.emberRavager.cost);
    expect(battle.attrition.survivors).toHaveLength(4);
    expect(battle.attrition.wounds).toHaveLength(1);
    expect(battle.attrition.survivors.filter(unit => unit.hp === unit.maxHp)).toHaveLength(3);
    expect(battle.attrition.permanentUnitIds).not.toContain('unit-player-4-emberRavager-3661');
    const survivors = battle.attrition.survivors.map(survivor => ({ ...snapshot.units.find(unit => unit.id === survivor.unitId)!, hp: survivor.hp }));
    expect(battle.attrition.survivingCampForce).toBe(creepForce(survivors));
    expect(battle.attrition.survivingFieldForce).toBe(strengthOf(survivors));
    expect(JSON.stringify({ snapshot, situation: decision.situation })).toBe(before);
  });

  it('filters actual enemy geography and unload intentions, preserves unknown arrivals, and weights known reinforcements', () => {
    const game = sketchScene('camp-enemy-arrivals').map('twoShores').replaceDefaults()
      .player('us', { team: 'a' }).player('ally', { team: 'a' })
      .player('foe', { team: 'b' }).player('foeAlly', { team: 'b' })
      .unit('us', 'archer', 1000, 1000).unit('us', 'archer', 1050, 1000)
      .unit('neutral', 'ogreWarrior', 1500, 1500).unit('neutral', 'ogreMage', 1550, 1500)
      .unit('foe', 'footman', 1600, 1600).unit('foe', 'footman', 1650, 1600)
      .unit('foe', 'footman', 1700, 1600).unit('foe', 'footman', 1750, 1600)
      .unit('foe', 'footman', 1800, 1600).unit('foe', 'footman', 1850, 1600)
      .unit('foe', 'footman', 1900, 1600).unit('foe', 'footman', 1950, 1600)
      .unit('foe', 'transport', 3000, 3000).unit('foe', 'transport', 3050, 3000).build().createGame();
    const snapshot = snapshotGame(game), mine = walkableGoal(snapshot.map, 1500, 1500);
    for (const unit of snapshot.units.filter(unit => unit.kind !== 'transport')) {
      Object.assign(unit, mine);
      if (unit.owner === 'neutral') Object.assign(unit, { homeX: mine.x, homeY: mine.y });
    }
    const landId = landIdAt(snapshot.map, mine)!;
    expect(landId).toBeDefined();
    const target: Target = { entityId: 'target', landId, point: mine };
    const fighters = snapshot.units.filter(unit => unit.owner === 'foe' && unit.kind === 'footman');
    const [present, incoming, unknown, unreachable, late, otherLand, unloading, noUnload] = fighters;
    const ships = snapshot.units.filter(unit => unit.kind === 'transport');
    const elsewhere = Array.from({ length: Math.floor(snapshot.map.width / 256) }, (_, x) =>
      Array.from({ length: Math.floor(snapshot.map.height / 256) }, (_, y) => ({ x: 128 + x * 256, y: 128 + y * 256 })))
      .flat().find(point => landIdAt(snapshot.map, point) !== landId && landIdAt(snapshot.map, point) !== undefined)!;
    expect(elsewhere).toBeDefined();
    Object.assign(otherLand!, { x: elsewhere.x, y: elsewhere.y });
    ships[0]!.order = { type: 'unload', x: mine.x, y: mine.y };
    ships[1]!.order = { type: 'idle' };
    unloading!.cabin = { shipId: ships[0]!.id };
    noUnload!.cabin = { shipId: ships[1]!.id };
    const reachable = (ticks: number): Arrival => ({ status: 'reachable', ticks, landTicks: ticks, crossings: [], evidence: [] });
    const entries = new Map<string, Arrival>([[present!.id, reachable(5)], [incoming!.id, reachable(60)],
      [unknown!.id, { status: 'unknown', reason: { code: 'beyond-evaluation-window', detail: '', evidence: [] } }],
      [unreachable!.id, { status: 'unreachable', reason: { code: 'geometry', detail: '', evidence: [] } }],
      [late!.id, reachable(111)], [otherLand!.id, { status: 'unknown', reason: { code: 'unobserved', detail: '', evidence: [] } }],
      [unloading!.id, reachable(10)]]);
    const facts: SituationUnit[] = fighters.map(unit => ({ id: unit.id, owner: unit.owner, kind: unit.kind,
      location: { kind: 'land', landId, point: unit }, hp: unit.hp, maxHp: unit.maxHp, strength: 999999,
      roles: ['frontline'], expiresTick: null, commitments: [], arrivals: entries.has(unit.id)
        ? [{ targetId: 'target', arrival: entries.get(unit.id)! }] : [] }));
    const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 100,
      lands: [], seas: [], assets: [], units: facts, opportunities: [], limitations: [],
      economy: { cashGold: 0, predictedIncomeGold: 0, horizonTicks: 100, ledger: [] } };
    const assessed = assessAllocatedCampEngagement({ snapshot, situation, target,
      unitIds: snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id), battleStartTicks: 10, windowTicks: 100 });
    const camp = strategicTargetCamp(snapshot, target)!;
    expect(assessed.unknownEnemyIds).toEqual([unknown!.id]);
    expect(assessed.candidateEnemyIds).not.toContain(otherLand!.id);
    expect(assessed.candidateEnemyIds).not.toContain(noUnload!.id);
    expect(assessed.onStationEnemyIds).toEqual([...camp.creeps.map(unit => unit.id), present!.id, unloading!.id].sort());
    expect(assessed.enRouteEnemyIds).toEqual([incoming!.id]);
    expect(assessed.memberIds).not.toContain(unreachable!.id);
    expect(assessed.memberIds).not.toContain(late!.id);
    expect(assessed.knownOpponentForce).toBeCloseTo(camp.strength + creepForce([present!, unloading!]) + creepForce([incoming!]) / 1.5);
    expect(assessed.knownOurForce).toBe(creepForce(snapshot.units.filter(unit => unit.owner === 'us'), assessed.opposition));
    expect(assessed.actualOpponentForce).toBeNull();
    expect(assessed.ourForce).toBeNull();
    expect(assessed.requiredForce).toBeNull();

    // These counterfactual lifetimes vary only the recorded units' lifetime;
    // expired enemies cannot remain in either the rating or free-volley HP pool.
    present!.expiresTick = snapshot.tick + 5;
    incoming!.expiresTick = snapshot.tick + 50;
    unknown!.expiresTick = snapshot.tick + 5;
    unloading!.expiresTick = snapshot.tick + 60;
    const temporary = assessAllocatedCampEngagement({ snapshot, situation, target,
      unitIds: snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id), battleStartTicks: 10, windowTicks: 100 });
    expect(temporary.status).toBe('known');
    expect(temporary.memberIds).not.toContain(present!.id);
    expect(temporary.memberIds).not.toContain(incoming!.id);
    expect(temporary.unknownEnemyIds).toEqual([]);
    expect(temporary.enemyAvailability).toEqual([{ unitId: unloading!.id, fromTicks: 10, throughTicks: 60, share: .5 }]);
    expect(temporary.actualOpponentForce).toBeCloseTo(camp.strength + creepForce([unloading!]) / 2);
    expect(temporary.opposition.creeps.find(unit => unit.id === unloading!.id)?.hp).toBe(unloading!.hp / 2);
    expect(temporary.ourForce).toBe(creepForce(snapshot.units.filter(unit => unit.owner === 'us'), temporary.opposition));
    expect(unloading!.hp).toBe(unloading!.maxHp);
  });

  it('has finite cohort force after the last guard dies instead of dividing free volleys by zero', () => {
    const game = sketchScene('empty-cleared-camp').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).unit('us', 'archer', 1000, 1000).build().createGame();
    const units = snapshotGame(game).units;
    expect(assessAllocatedForce('us', units, { metric: 'camp-force', camp: {
      center: { x: 1500, y: 1500 }, creeps: [], strength: 0, reach: 0 } }).force).toBe(creepForce(units));
  });
});
