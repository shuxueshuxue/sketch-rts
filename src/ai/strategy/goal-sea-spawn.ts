import { canTrainAt, unitMover } from '../../shared/catalog';
import { shipProfile } from '../../shared/ship-geometry';
import { shipLaunchAnchors, shipLaunchCandidates } from '../../shared/ship-launch-geometry';
import { hullFits, hullPassageClear } from '../../shared/ship-navigation';
import { CELL_GROUND } from '../../shared/terrain';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { goalValueKey } from './goal-facts';
import type { GoalGeometryReader, GoalPublishedValue } from './goal-grounding-ports';
import type { Point, SeaId } from './types';

export type GoalSeaSpawn = Readonly<{ options: readonly Readonly<{ seaId: SeaId;
  /** A point to set the rally to, never a prediction of the birth pose. */
  rally: Readonly<{ kind: 'unrestricted' }> | Readonly<{ kind: 'sea-component'; seaId: SeaId; point: Point }>;
}>[] }>;
export type GoalSeaSpawnReader = (realYard: Building, nativePrototype: Unit) => GoalPublishedValue<GoalSeaSpawn>;
type Water = { left: number; top: number; cols: number; rows: number; labels: number[];
  cell: number; scan: number; component: number; queue: number[]; head: number };
type Cursor = { phase: 'anchors' | 'cells' | 'water' | 'candidates'; anchor: number; seas: SeaId[];
  water: Water | null; candidate: number; witnesses: { seaId: SeaId; point: Point }[] };

/** Decision geometry only: which sea can this kind enter from this real yard?
 * A sole native contact component needs no hull-fit/traffic/steering proof.
 * Ambiguous contacts use only the native local harbor candidates. Congestion
 * and a blocked birth pose remain native paid-job waiting, never a fake unit,
 * lease, output, exact birth pose or proof of training impossibility. */
export function createGoalSeaSpawnReader(input: Readonly<{
  snapshot: GameSnapshot; owner: string; geometry: GoalGeometryReader; terrainRevision: string;
  regionsReady: boolean; regionAt: (point: Point, mover: 'sea') => SeaId | undefined;
}>): GoalSeaSpawnReader {
  return (yard, prototype) => {
    const keyBase = `sea-spawn:${yard.id}:${prototype.kind}`;
    const pending = (code: string, ids: readonly string[] = [keyBase]): GoalPublishedValue<never> => ({
      state: 'pending', requestIds: ids, reason: { code, factIds: ids, values: {} } });
    const real = input.snapshot.buildings.find(building => building.id === yard.id && building.owner === input.owner
      && building.hp > 0 && building.complete && building.kind === 'shipyard');
    const race = input.snapshot.players[input.owner]?.race, profile = shipProfile(prototype);
    if (!real || !race || !canTrainAt(race, real.kind, prototype.kind) || unitMover(prototype.kind) !== 'sea' || !profile
      || prototype.owner !== input.owner || input.snapshot.units.some(unit => unit.id === prototype.id))
      return { state: 'unmet', reason: { code: 'native-sea-spawn-producer-or-prototype-invalid', factIds: [], values: {} } };
    if (!input.regionsReady) return pending('native-sea-spawn-regions-pending');
    const shape = input.geometry.reference?.('sea-spawn-hull', { kind: prototype.kind, hull: profile.hull });
    const result = input.geometry<Cursor, GoalSeaSpawn>({ key: `${keyBase}:${goalValueKey([
      real.x, real.y, real.radius, shape ?? profile.hull])}`, revision: input.terrainRevision,
    ...(shape ? { references: [shape] } : {}),
    initialState: { phase: 'anchors', anchor: 0, seas: [], water: null, candidate: 0, witnesses: [] },
    advance(state, allowance) {
      let work = 0;
      const done = (value: GoalSeaSpawn) => ({ state, work, done: true, value });
      if (!allowance) return { state, work, done: false };
      const map = input.snapshot.map, anchors = shipLaunchAnchors(map, real);
      const candidates = shipLaunchCandidates(map, real, prototype), terrain = map.terrain;
      while (work < allowance) {
        if (state.phase === 'anchors') {
          if (state.anchor < anchors.length) {
            const sea = input.regionAt(anchors[state.anchor++]!, 'sea'); work++;
            if (sea && !state.seas.includes(sea)) state.seas.push(sea);
            continue;
          }
          state.seas.sort();
          if (state.seas.length <= 1) return done({ options: state.seas.map(seaId => ({ seaId, rally: { kind: 'unrestricted' } })) });
          if (!terrain) return done({ options: [] });
          const left = Math.max(0, Math.floor((real.x - candidates.reach) / terrain.cell));
          const right = Math.min(terrain.cols - 1, Math.floor((real.x + candidates.reach) / terrain.cell));
          const top = Math.max(0, Math.floor((real.y - candidates.reach) / terrain.cell));
          const bottom = Math.min(terrain.rows - 1, Math.floor((real.y + candidates.reach) / terrain.cell));
          const cols = Math.max(0, right - left + 1), rows = Math.max(0, bottom - top + 1);
          state.water = { left, top, cols, rows, labels: Array<number>(cols * rows).fill(0),
            cell: 0, scan: 0, component: 0, queue: [], head: 0 };
          state.phase = 'cells'; continue;
        }
        const water = state.water!;
        if (state.phase === 'cells') {
          if (water.cell < water.labels.length) {
            const index = water.cell++, col = index % water.cols, row = Math.floor(index / water.cols); work++;
            if (CELL_GROUND[terrain!.cells[(water.top + row) * terrain!.cols + water.left + col] ?? '.']?.sea)
              water.labels[index] = -1;
            continue;
          }
          state.phase = 'water'; continue;
        }
        if (state.phase === 'water') {
          if (water.head < water.queue.length) {
            const current = water.queue[water.head++]!, col = current % water.cols, row = Math.floor(current / water.cols); work++;
            const neighbors = [col ? current - 1 : -1, col + 1 < water.cols ? current + 1 : -1,
              row ? current - water.cols : -1, row + 1 < water.rows ? current + water.cols : -1];
            for (const next of neighbors) if (next >= 0 && water.labels[next] === -1) {
              water.labels[next] = water.component; water.queue.push(next);
            }
            continue;
          }
          if (water.scan < water.labels.length) {
            const index = water.scan++; work++;
            if (water.labels[index] === -1) {
              water.labels[index] = ++water.component; water.queue = [index]; water.head = 0;
            }
            continue;
          }
          water.queue = []; water.head = 0; state.phase = 'candidates'; continue;
        }
        if (state.candidate < candidates.count) {
          const { anchor, pose, entry, outward } = candidates.at(state.candidate++); work++;
          const label = (point: Point) => {
            const col = Math.floor(point.x / terrain!.cell) - water.left, row = Math.floor(point.y / terrain!.cell) - water.top;
            return col >= 0 && row >= 0 && col < water.cols && row < water.rows ? water.labels[row * water.cols + col]! : 0;
          };
          const component = label(anchor);
          if (component <= 0 || !hullFits(map, prototype, pose) || label(pose) !== component
            || outward && !hullPassageClear(map, prototype, entry, pose)) continue;
          const seaId = input.regionAt(pose, 'sea');
          if (seaId && !state.witnesses.some(witness => witness.seaId === seaId))
            state.witnesses.push({ seaId, point: { x: pose.x, y: pose.y } });
          continue;
        }
        const witnesses = state.witnesses.sort((a, b) => a.seaId < b.seaId ? -1 : a.seaId > b.seaId ? 1 : 0);
        return done({ options: witnesses.map(({ seaId, point }) => ({ seaId,
          rally: witnesses.length === 1 ? { kind: 'unrestricted' } : { kind: 'sea-component', seaId, point } })) });
      }
      return { state, work, done: false };
    } });
    // No geometric candidate at an ambiguous contact establishes neither a
    // different basin nor permanent production failure. Keep that decision
    // unknown; the native paid job is still allowed to wait for its exit.
    return result.state === 'met' && !result.value.options.length
      ? pending('native-sea-spawn-component-unresolved', result.factIds) : result;
  };
}
