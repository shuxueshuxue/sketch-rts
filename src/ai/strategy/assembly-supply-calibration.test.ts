import { expect, it } from 'vitest';
import { BUILDING_DEFS } from '../../shared/catalog';
import { createBuilding, createUnit } from '../../shared/map';
import { combatRating } from '../policy/v6/strength';
import raw from './data/assembly-supply-model.json';
import { createGame, snapshotGame } from '../../shared/sim';
import { calibratedAssemblySupply, type AssemblyProducerRoute } from './assembly-supply-calibration';
import { landIdAt } from './regions';

function fixture() {
  const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] }));
  snapshot.tick = 2400;
  snapshot.players.player!.race = 'ember';
  snapshot.buildings = [createBuilding('forge', 'player', 'emberForge', 1000, 1000, true),
    createBuilding('spire', 'player', 'cinderSpire', 1400, 1000, true)];
  const posts = [{ id: 'home', target: { point: { x: 1200, y: 1000 }, landId: landIdAt(snapshot.map, { x: 1200, y: 1000 })! } }];
  const producerRoutes: AssemblyProducerRoute[] = snapshot.buildings.flatMap(building => BUILDING_DEFS[building.kind].trains.map(unitKind => ({
    buildingId: building.id, unitKind, arrival: { status: 'reachable', ticks: 25, landTicks: 25, crossings: [] } })));
  return { snapshot, posts, producerRoutes, owner: 'player', version: 'v9_archer' as const };
}

it('selects a global kind-compatible joint cell with equal weights, original support and per-producer alignment', () => {
  const input = fixture(), before = JSON.stringify(input), result = calibratedAssemblySupply(input);
  expect(result.status).toBe('known');
  expect(result.featureCell).toMatchObject({ producerSignature: 'cinderSpire:1,emberForge:1' });
  expect(result.featureCell).not.toHaveProperty('map'); expect(result.featureCell).not.toHaveProperty('owner');
  expect(result.model!.scenarios.length).toBeGreaterThanOrEqual(2);
  expect(result.model!.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0)).toBeCloseTo(1);
  expect(result.model!.scenarios.every(scenario => scenario.producers.every(producer => ['forge', 'spire'].includes(producer.buildingId)))).toBe(true);
  expect(result.alignments.every(value => [0, 25].includes(value.routeTicks) && value.sourceFromTick >= 0 && value.supportThroughTick > input.snapshot.tick)).toBe(true);
  expect(result.alignments.some(value => value.points.some(point => point.members.length > 0))).toBe(true);
  expect(calibratedAssemblySupply({ ...input, snapshot: { ...input.snapshot, buildings: [...input.snapshot.buildings].reverse() },
    producerRoutes: [...input.producerRoutes].reverse() })).toEqual(result);
  expect(JSON.stringify(input)).toBe(before);
});

it('keeps missing calibration, ambiguous same-kind factories and missing post routes explicit', () => {
  const input = fixture(), second = structuredClone(input.snapshot.buildings[0]!); second.id = 'another-forge';
  expect(calibratedAssemblySupply({ ...input, snapshot: { ...input.snapshot, buildings: [...input.snapshot.buildings, second] } }))
    .toMatchObject({ status: 'unknown', model: null, missing: [{ code: 'assembly-supply-producer-mapping-unknown' }] });
  const unobserved = calibratedAssemblySupply({ ...input, producerRoutes: [] });
  expect(unobserved.status).toBe('unknown');
  expect(unobserved.missing.some(fact => fact.code === 'assembly-conditional-recruit-arrival-unknown')).toBe(true);
  const empty = calibratedAssemblySupply({ ...input, snapshot: { ...input.snapshot, buildings: [] } });
  expect(empty).toMatchObject({ status: 'known', model: null, missing: [] });
  const unsupported = calibratedAssemblySupply({ ...input, snapshot: { ...input.snapshot,
    buildings: [createBuilding('cannon', 'player', 'workshop', 1000, 1000, true)] } });
  expect(unsupported).toMatchObject({ status: 'unknown', model: null, missing: [{ code: 'assembly-supply-calibration-cell-unknown' }] });
});


it('retains v2 actual injured native weapons and health at every empirical inventory point', () => {
  expect(raw.calibrationId).toBe('assembly-supply-646-joint-live-tail-v2-eeac1238909c');
  const ratings = raw.memberProfiles.map(profile => {
    const unit = { ...createUnit('assessment-only', 'player', profile.kind as Parameters<typeof createUnit>[2], 0, 0), ...profile, kind: profile.kind as Parameters<typeof createUnit>[2] };
    const force = combatRating(unit);
    expect(force).toBeCloseTo(profile.force, 12);
    return force;
  });
  expect(raw.memberProfiles.some(profile => profile.hp < profile.maxHp)).toBe(true);
  let points = 0;
  for (const sample of raw.samples) for (const producer of sample.producers) for (const point of producer.points) {
    const indices = point[2] as number[];
    expect(indices.reduce((sum, index) => sum + ratings[index]!, 0)).toBeCloseTo(point[1] as number, 10);
    points++;
  }
  expect(points).toBeGreaterThan(10000);
});
