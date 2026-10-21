import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { shipLaunchPose, shipLaunchPrototype } from '../../shared/ship-launch';
import { hullFits } from '../../shared/ship-navigation';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { regionIndex, landIdAt } from './regions';
import { nativeVoyageBerth } from './voyage-berth';
import { boardingBerth } from '../../shared/naval';

it('replaces the real p4/4180 water cell inside the yard with a native hull-clear boarding berth', () => {
  const frame: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const snapshot = frame.snapshot;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const candidate = regionIndex(snapshot.map).shores.find(shore => shore.water.x === 1648 && shore.water.y === 2480)!;
  const yard = snapshot.buildings.filter(building => building.owner === frame.owner && building.kind === 'shipyard')
    .sort((a,b) => Math.hypot(a.x-1648,a.y-2480)-Math.hypot(b.x-1648,b.y-2480))[0]!;
  const hull = shipLaunchPrototype(yard, 'transport'), launch = shipLaunchPose(snapshot, yard, hull)!;
  hull.x = launch.x; hull.y = launch.y;
  hull.sailing = { heading: launch.heading, speed: 0, load: 0, balance: 0 };
  const passenger = snapshot.units.find(unit => unit.owner === frame.owner && unit.kind === 'worker'
    && landIdAt(snapshot.map, unit) === candidate.landId)!;
  expect(hullFits(snapshot.map, hull, { ...candidate.water, heading: launch.heading })).toBe(false);
  const result = nativeVoyageBerth(snapshot, passenger, hull, candidate);
  expect(result.status).toBe('known');
  if (result.status !== 'known') throw new Error(result.reasonCode);
  expect(result.shore.water).not.toEqual(candidate.water);
  expect(hullFits(snapshot.map, hull, { ...result.shore.water, heading: result.heading })).toBe(true);
  expect(landIdAt(snapshot.map, result.shore.ground)).toBe(candidate.landId);
  const native = boardingBerth(snapshot.map, { ...passenger, ...result.shore.ground },
    { ...hull, ...result.shore.water, sailing: { ...hull.sailing!, heading: result.heading } });
  expect(native).toMatchObject({ ...result.shore.water, shore: result.shore.ground });
  expect(nativeVoyageBerth(snapshot, passenger, hull, result.shore)).toEqual(result);
  const restored: GameSnapshot = JSON.parse(JSON.stringify(snapshot));
  expect(nativeVoyageBerth(restored, JSON.parse(JSON.stringify(passenger)), JSON.parse(JSON.stringify(hull)), candidate)).toEqual(result);
});
