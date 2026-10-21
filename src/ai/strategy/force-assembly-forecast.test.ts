import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { createUnit } from '../../shared/map';
import { snapshotGame, stepGame, trainingRecruitPrototype } from '../../shared/sim';
import { assessAllocatedForce } from './allocated-force';
import { forecastForceAssembly, type ForceAssemblyInput, type ConditionalAssemblyProduction } from './force-assembly-forecast';
import type { DecisionFacts } from './decision';
import type { Arrival } from './types';

const arrival = (ticks: number): DecisionFacts<Arrival> => ({ status: 'reachable', ticks, landTicks: ticks, crossings: [] });
const conditional = (forcePerTick: number): ConditionalAssemblyProduction => ({ source: 'conditional-incumbent-production',
  calibrationId: 'test-net-supply', phase: 'early', producerRates: [{ buildingId: 'barracks', postId: 'home', forcePerTick }], startsAtTick: 0,
  completionProbability: .8, timeMaeTicks: 20, timeP90ErrorTicks: 50, sampleCount: 10 });
function example() {
  const game = sketchScene('assembly-supply').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' })
    .playerState('us', { gold: 2000 }).townHall('us', 300, 300).townHall('foe', 3000, 3000)
    .building('us', 'barracks', 800, 800, { id: 'barracks' })
    .unit('us', 'footman', 1100, 1000, { id: 'current' }).build().createGame();
  const input: ForceAssemblyInput = { snapshot: snapshotGame(game), owner: 'us',
    rallies: [{ id: 'home', target: { point: { x: 1100, y: 1000 } } }],
    target: { metric: 'camp-force', camp: { center: { x: 1600, y: 1600 }, creeps: [], strength: 2, reach: 0 }, requiredForce: 3 },
    unitSupply: [{ unitId: 'current', postId: 'home', source: 'assigned', availableTick: 0, arrival: arrival(0) }],
    paidJobRoutes: [], throughTick: 1000, conditionalProduction: null };
  return { game, input };
}

it('uses real sequential job completion and the same native upgraded recruit stats without training or spending', () => {
  const { game, input } = example();
  game.players.us!.upgrades = { ...game.players.us!.upgrades, weaponTraining: 2, reinforcedPlating: 1 };
  issueCommandFrame(game, [{ playerId: 'us', scriptId: 'economy', command: { type: 'train', buildingId: 'barracks', unitKind: 'footman' } },
    { playerId: 'us', scriptId: 'economy', command: { type: 'train', buildingId: 'barracks', unitKind: 'footman' } }]);
  const building = game.buildings.find(building => building.id === 'barracks')!;
  building.queue[0]!.remaining = 10; building.queue[1]!.remaining = 20;
  const jobs = building.queue.filter(job => 'unitKind' in job);
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const forecast = forecastForceAssembly({ ...input, snapshot,
    paidJobRoutes: jobs.map(job => ({ buildingId: building.id, jobId: job.id!, postId: 'home', arrival: arrival(0) })) });
  expect(forecast.supplies.filter(supply => supply.source === 'paid-job').map(supply => supply.readyTick)).toEqual([10, 30]);
  expect(forecast.supplies.filter(supply => supply.source === 'paid-job').every(supply => supply.unitId === null)).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
  const prototypes = jobs.map(job => trainingRecruitPrototype(snapshot, building, job));
  const births: { tick: number; kind: string }[] = [], ids = new Set(game.units.map(unit => unit.id));
  for (let tick = 0; tick < 30; tick++) {
    stepGame(game);
    for (const unit of game.units) if (!ids.has(unit.id)) {
      ids.add(unit.id); births.push({ tick: game.tick, kind: unit.kind });
      const prototype = prototypes.find(projected => projected.kind === unit.kind)!;
      expect([unit.hp, unit.maxHp, unit.attackDamage, unit.attackCooldown, unit.attackRange, unit.speed])
        .toEqual([prototype.hp, prototype.maxHp, prototype.attackDamage, prototype.attackCooldown, prototype.attackRange, prototype.speed]);
    }
  }
  expect(births).toEqual([{ tick: 10, kind: 'footman' }, { tick: 30, kind: 'footman' }]);
});

it('uses a finite certain pipeline and starts residual production after it instead of counting the same births twice', () => {
  const { input } = example(), building = input.snapshot.buildings.find(building => building.id === 'barracks')!;
  building.queue.push({ id: 'paid', unitKind: 'footman', remaining: 100 });
  const forecast = forecastForceAssembly({ ...input, conditionalProduction: conditional(.01),
    paidJobRoutes: [{ buildingId: building.id, jobId: 'paid', postId: 'home', arrival: arrival(0) }] });
  expect(forecast.certainForce).toBe(2);
  expect(forecast.readyTick).toBe(200); // 100 to finish the paid job, then one residual unit of force.
  expect(forecast.conditionalForce).toBe(1); expect(forecast.completionProbability).toBe(.8);
  expect(forecast.conditionalProduction?.calibrationId).toBe('test-net-supply');
  expect(forecast.production).toEqual([{ buildingId: 'barracks', lane: 'training', fromTicks: 0, throughTicks: 200 }]);
  expect(forecastForceAssembly({ ...input, conditionalProduction: conditional(0),
    paidJobRoutes: [{ buildingId: building.id, jobId: 'paid', postId: 'home', arrival: arrival(0) }] }).missing)
    .toContainEqual({ code: 'needs-production', status: 'unmet', factIds: [] });
});

it('keeps zero or too-slow net growth a known force deficit rather than waiting on a nonexistent fact', () => {
  const { input } = example();
  for (const rate of [0, .001]) {
    const forecast = forecastForceAssembly({ ...input, conditionalProduction: conditional(rate) });
    expect(forecast).toMatchObject({ status: 'blocked', readyTick: null, completionProbability: 0, deficit: 2 });
    expect(forecast.missing).toContainEqual({ code: 'needs-production', status: 'unmet', factIds: [] });
  }
});

it('re-prices conditional production against the actual allowed lanes and half-open occupancy', () => {
  const { input } = example(), model = { ...input, conditionalProduction: conditional(.01) };
  expect(forecastForceAssembly(model).readyTick).toBe(200);
  expect(forecastForceAssembly({ ...model, allowedProduction: [] }).status).toBe('blocked');
  expect(forecastForceAssembly({ ...model, unavailableProduction: [{ buildingId: 'barracks', lane: 'training', fromTicks: 0, throughTicks: 100 }] }).readyTick).toBe(300);
  expect(forecastForceAssembly({ ...model, unavailableProduction: [{ buildingId: 'barracks', lane: 'research', fromTicks: 0, throughTicks: 100 }] }).readyTick).toBe(200);
});

it('excludes unavailable real members and training lanes without blocking independent research or moving paid jobs', () => {
  const { input } = example(), building = input.snapshot.buildings.find(building => building.id === 'barracks')!;
  building.queue.push({ id: 'paid', unitKind: 'footman', remaining: 100 });
  const model = { ...input, paidJobRoutes: [{ buildingId: building.id, jobId: 'paid', postId: 'home', arrival: arrival(0) }] };
  const before = JSON.stringify(input.snapshot);
  const research = forecastForceAssembly({ ...model, unavailableProduction: [{ buildingId: building.id, lane: 'research', fromTicks: 0, throughTicks: 100 }] });
  expect(research.certainForce).toBe(2);
  const training = forecastForceAssembly({ ...model, unavailableUnitIds: ['current'],
    unavailableProduction: [{ buildingId: building.id, lane: 'training', fromTicks: 0, throughTicks: 100 }] });
  expect(training.certainForce).toBe(0); expect(training.supplies).toEqual([]);
  expect(JSON.stringify(input.snapshot)).toBe(before);
});

it('requires an explicit recovery service and returns the real unit with its promised HP after recovery and travel', () => {
  const { input } = example(), patient = input.snapshot.units.find(unit => unit.id === 'current')!;
  patient.hp = 10;
  const supply = { ...input.unitSupply[0]!, source: 'recovery' as const, availableTick: 100, arrival: arrival(40) };
  const absent = forecastForceAssembly({ ...input, unitSupply: [supply] });
  expect(absent.status).toBe('unknown'); expect(absent.certainForce).toBe(0);
  const known = forecastForceAssembly({ ...input, unitSupply: [{ ...supply, recovery: { serviceId: 'native-well', hp: patient.maxHp } }] });
  expect(known.forceCurve[0]).toMatchObject({ tick: 140, force: 1, unitIds: [patient.id] });
  expect(patient.hp).toBe(10);
});

it('evaluates a ready cross-origin cohort once across its own posts, including camp range interactions', () => {
  const { input } = example();
  const archer = createUnit('other-origin', 'us', 'archer', 2300, 2000);
  const enemy = createUnit('guard', 'neutral', 'ogreWarrior', 1600, 1600);
  input.snapshot.units.push(archer);
  const members = input.snapshot.units.filter(unit => ['current', archer.id].includes(unit.id));
  const target = { metric: 'camp-force' as const, camp: { center: enemy, creeps: [enemy], strength: 1, reach: 0 }, requiredForce: 2 };
  const expected = assessAllocatedForce('us', members, target).force;
  const model = { ...input, target, rallies: [...input.rallies, { id: 'island', target: { point: archer } }],
    unitSupply: [...input.unitSupply, { unitId: archer.id, postId: 'island', source: 'assigned' as const, availableTick: 0, arrival: arrival(0) }] };
  const forecast = forecastForceAssembly(model);
  expect(forecast.atRallyForce).toBe(expected); expect(forecast.certainForce).toBe(expected);
  expect(forecast.supplies.map(supply => supply.postId).sort()).toEqual(['home', 'island']);
  expect(forecastForceAssembly(JSON.parse(JSON.stringify(model)))).toEqual(forecast);
  expect(forecastForceAssembly({ ...model, unitSupply: [...model.unitSupply].reverse() })).toEqual(forecast);
});

it('keeps route unknown distinct from physical impossibility and never turns a paid job into an existing member', () => {
  const { input } = example();
  expect(forecastForceAssembly({ ...input, unitSupply: [{ ...input.unitSupply[0]!, arrival: null }] }).status).toBe('unknown');
  const unreachable: DecisionFacts<Arrival> = { status: 'unreachable', reason: { code: 'blocked-ground' } };
  const blocked = forecastForceAssembly({ ...input, unitSupply: [{ ...input.unitSupply[0]!, arrival: unreachable }] });
  expect(blocked.status).toBe('blocked'); expect(blocked.missing[0]?.status).toBe('unmet');
  expect(() => forecastForceAssembly({ ...input, unitSupply: [...input.unitSupply, ...input.unitSupply] })).toThrow(/Duplicate/);
  expect(() => forecastForceAssembly({ ...input, conditionalProduction: { ...conditional(.01), completionProbability: NaN } })).toThrow(/Invalid/);
});
