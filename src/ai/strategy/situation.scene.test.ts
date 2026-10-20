import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { groundWholeAt, setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { withNativeLandRoadReuse } from '../policy/land-road';
import { evaluateSituation } from './situation';

type Scene = { event: string; owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory };
const scenes: Scene[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
const scene = (event: string) => structuredClone(scenes.find(scene => scene.event === event)!);
const assess = (frame: Scene) => {
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  return withNativeLandRoadReuse(() => evaluateSituation(frame.snapshot, frame.owner, frame.memory));
};

describe('read-only situation over exact contract event frames', () => {
  it('projects L3 actual mobile care above half health without losing its guard task', () => {
    const frame: Scene = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/recovery-L3.json.gz', import.meta.url))).toString());
    const before = JSON.stringify(frame), situation = assess(frame);
    const patient = situation.units.find(unit => unit.id === 'unit-player-ashChieftain-3872')!;
    expect(patient.hp / patient.maxHp).toBeGreaterThan(.7);
    expect(patient.commitments).toContainEqual(expect.objectContaining({ source: 'mobileCare.claimsUnits' }));
    expect(patient.commitments.some(task => task.source.startsWith('unitClaims.'))).toBe(true);
    expect(JSON.stringify(frame)).toBe(before);
  });
  it.each(['E01', 'E02', 'E05', 'Nd', 'Ne'])('preserves the full %s world and task memory and uses shared component IDs', event => {
    const frame = scene(event), before = JSON.stringify(frame);
    const situation = assess(frame);
    expect(JSON.stringify(frame)).toBe(before);
    expect(situation.tick).toBe(frame.snapshot.tick);
    expect(new Set(situation.units.map(unit => unit.id)).size).toBe(situation.units.length);
    for (const unit of situation.units) if (unit.location.kind === 'land')
      expect(unit.location.landId).toBe(`land:${groundWholeAt(frame.snapshot.map, unit.location.point)}`);
    const aboard = new Set(situation.units.filter(unit => unit.location.kind === 'aboard').map(unit => unit.id));
    expect(situation.lands.flatMap(land => land.unitIds).some(id => aboard.has(id))).toBe(false);
    expect(situation.economy.ledger).toEqual([]);
  });

  it('finds E02 island danger independently of the old home-only intrusion anchor', () => {
    const situation = assess(scene('E02'));
    const threat = situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === 'building-p0-townHall-9337')!;
    expect(threat.attackers).toHaveLength(4);
    expect(threat.friendlyOnStationStrength).toBe(0);
    expect(threat.arrivedStrength + threat.incomingStrength).toBeGreaterThan(5);
    expect(new Set(threat.attackers.map(attacker => attacker.unitId)).size).toBe(4);
  });

  it('keeps E05 attack membership even when a soldier currently holds still', () => {
    const frame = scene('E05'), situation = assess(frame);
    for (const id of frame.memory.landAttack!.general.group!) {
      const unit = situation.units.find(unit => unit.id === id);
      if (unit) expect(unit.commitments).toContainEqual(expect.objectContaining({
        source: 'landAttack', objectiveId: 'AttackSite:p0:building-p3-townHall-7099',
      }));
    }
  });

  it('does not count Nd live passengers as available defenders at home', () => {
    const situation = assess(scene('Nd'));
    const crew = situation.units.filter(unit => unit.location.kind === 'aboard' && unit.location.shipId === 'unit-enemy-transport-2302');
    expect(crew.filter(unit => !unit.roles.includes('worker')).length).toBe(6);
    expect(crew.every(unit => unit.commitments.some(task => task.source === 'naval.ferries'))).toBe(true);
    const home = situation.assets.find(asset => asset.id === 'building-enemy-townHall-1622')!;
    const threat = situation.lands.find(land => land.id === home.target.landId)!.threats.find(threat => threat.siteId === home.id)!;
    expect(threat.attackers.length).toBeGreaterThan(0);
  });
  it('forecasts an observed enemy unloading order without treating its passengers as landed', () => {
    const frame = scene('Nd'), ship = frame.snapshot.units.find(unit => unit.id === 'unit-enemy-transport-2302')!;
    const opponent = Object.keys(frame.snapshot.players).find(owner => owner !== frame.owner
      && frame.snapshot.teams?.[owner] !== frame.snapshot.teams?.[frame.owner])!;
    const mission = frame.memory.naval!.ferries![ship.id]!;
    const passengers = frame.snapshot.units.filter(unit => unit.deck?.shipId === ship.id || unit.cabin?.shipId === ship.id);
    ship.owner = opponent; ship.x = mission.from.x; ship.y = mission.from.y;
    ship.order = { type: 'unload', ...mission.from };
    for (const unit of passengers) unit.owner = opponent;
    const situation = assess(frame), ids = new Set(passengers.filter(unit => unit.kind !== 'worker' && unit.attackDamage > 0).map(unit => unit.id));
    const threat = situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === 'building-enemy-townHall-1622')!;
    expect(threat.attackers.some(attacker => ids.has(attacker.unitId))).toBe(true);
    expect(situation.units.filter(unit => ids.has(unit.id)).every(unit => unit.location.kind === 'aboard')).toBe(true);
    expect(threat.attackers.filter(attacker => ids.has(attacker.unitId)).every(attacker =>
      attacker.arrival.status === 'reachable' && attacker.arrival.crossings.length === 1)).toBe(true);
  });

  it('makes Ne borrowing and every crossing phase explicit, without declaring a busy boat free', () => {
    const situation = assess(scene('Ne'));
    for (const suffix of [5287, 5642, 5789, 5909]) {
      const unit = situation.units.find(unit => unit.id === `unit-player-4-emberRavager-${suffix}`)!;
      expect(unit.commitments.some(task => task.objectiveId === 'ExpandLand:player-4:gold-mainland-2')).toBe(true);
      const arrival = unit.arrivals.find(entry => entry.targetId === 'gold-satellite-2')!.arrival;
      expect(arrival.status).toBe('conditional');
      if (arrival.status !== 'conditional') throw new Error('Expected a conditional transport plan');
      expect(arrival.unmet.some(reason => reason.code === 'borrow-transport' || reason.code === 'obtain-transport')).toBe(true);
      expect(arrival.crossings).toHaveLength(1);
      expect(arrival.crossings[0]!.boardingTicks).toBeGreaterThan(0);
      expect(arrival.crossings[0]!.sailingTicks).toBeGreaterThan(0);
      expect(arrival.crossings[0]!.unloadingTicks).toBeGreaterThan(0);
      expect(arrival.ticks).toBe(arrival.landTicks + arrival.crossings.reduce((sum, crossing) =>
        sum + crossing.waitTicks + crossing.boardingTicks + crossing.sailingTicks + crossing.unloadingTicks, 0));
    }
  });
});
