import { boundCache, type CacheCapacity, type CacheUse } from './bounded-cache';
import type { VoyageRiskMemory } from './voyage-risk';
import type { PointRouteMemory } from './point-routes';
import type { FactWorkReceipt } from './fact-work';
import type { GoalGeometryMemory } from './goal-grounding-ports';
import { standingBodies } from '../../shared/structure-bodies';
import { fnv1a } from '../../shared/sim/checksum';
import type { Terrain } from '../../shared/terrain';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { Asset, Objective, Opportunity, Point, Situation } from './types';
import { observationJsonBytes } from './observation-json-bytes';
import { explanationForMemory } from './explanations';

export type PreviousObjective = Pick<Objective, 'id' | 'sinceTick' | 'stability'> & { utility: Pick<Objective['utility'], 'score'> };
export type SituationHistory = Pick<Situation, 'tick' | 'owner' | 'assets' | 'opportunities'>;
export type FieldProgress = CacheUse & { goal: Point; work: number; readyTick: number | null; readyThink?: number };
export type StrategyObservationMemory = {
  version: 1;
  owner: PlayerId;
  terrain: string;
  landBodies: string;
  fields: { land: FieldProgress[]; sea: FieldProgress[] };
  crossings: (CacheUse & { key: string; fieldTicks: number[]; quotedTick: number })[];
  /** Bounded native planning cursor and exposure publication; no distance-field arrays. */
  voyageRisks?: VoyageRiskMemory;
  pointRoutes?: PointRouteMemory;
  /** Monotone owner-think clock, independent of simulation time. */
  thinkSequence?: number;
  factWork?: FactWorkReceipt;
  goalGeometry?: GoalGeometryMemory;
  cacheCapacities?: Record<string, CacheCapacity>;
  truncated?: true;
  history?: { tick: number; assets: Asset[]; lostSites: Opportunity[]; objectives: PreviousObjective[] };
};
export const OBSERVATION_FIELD_LIMIT = 64;
export const OBSERVATION_HISTORY_LIMIT = 256;
export const OBSERVATION_BYTE_LIMIT = 64 * 1024;
const versions = new WeakMap<Terrain, { cells: string; key: string }>();
/** Preserve every original field, including any nested fields named strategy. */
export function originalPolicyMemory(memory: AiPolicyMemory) {
  const { strategy: _observation, ...policy } = memory; return policy;
}

/** Only deterministic publication state. Arrays for native flow computation stay
 * in terrain's acceleration caches. The same serialized input admits the same
 * work, regardless of cache occupancy, owner interleaving or process lifetime. */
export function observationMemory(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory): StrategyObservationMemory {
  const terrain = snapshot.map.terrain;
  let shape = terrain && versions.get(terrain);
  if (terrain && (!shape || shape.cells !== terrain.cells)) {
    shape = { cells: terrain.cells, key: `${terrain.cols}:${terrain.rows}:${terrain.cell}:${fnv1a(terrain.cells)}` };
    versions.set(terrain, shape);
  }
  const key = shape?.key ?? `open:${snapshot.map.width}:${snapshot.map.height}`;
  // Exact tuples, not process-local overlay revision numbers or entity identities.
  const tuples = standingBodies(snapshot).map(({ x, y, radius }) => [x, y, radius])
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  const bodies = `${tuples.length}:${fnv1a(JSON.stringify(tuples))}`;
  let state = memory.strategy?.observation;
  if (!state || state.version !== 1 || state.owner !== owner || state.terrain !== key) {
    state = { version: 1, owner, terrain: key, landBodies: bodies, fields: { land: [], sea: [] }, crossings: [] };
  } else if (state.landBodies !== bodies) state = { ...state, landBodies: bodies, fields: { land: [], sea: state.fields.sea }, crossings: [],
    ...(state.pointRoutes ? { pointRoutes: { entries: [] } } : {}) };
  state.crossings ??= [];
  memory.strategy = { observation: state };
  return state;
}

export function observationHistory(state: StrategyObservationMemory): SituationHistory | undefined {
  return state.history && { owner: state.owner, tick: state.history.tick, assets: state.history.assets, opportunities: state.history.lostSites };
}

export function retainObservationHistory(state: StrategyObservationMemory, situation: Situation, objectives: readonly Objective[]) {
  if (situation.assets.filter(asset => asset.kind === 'hall' || asset.kind === 'mine').length > OBSERVATION_HISTORY_LIMIT
    || situation.opportunities.filter(opportunity => opportunity.kind === 'lost-site').length > OBSERVATION_HISTORY_LIMIT
    || objectives.length > OBSERVATION_HISTORY_LIMIT) state.truncated = true;
  state.history = {
    tick: situation.tick,
    assets: situation.assets.filter(asset => asset.kind === 'hall' || asset.kind === 'mine').slice(0, OBSERVATION_HISTORY_LIMIT),
    lostSites: situation.opportunities.filter(opportunity => opportunity.kind === 'lost-site').slice(0, OBSERVATION_HISTORY_LIMIT).map(explanationForMemory),
    objectives: objectives.slice(0, OBSERVATION_HISTORY_LIMIT).map(({ id, sinceTick, stability, utility, rank }) =>
      ({ id, sinceTick, stability: { ...stability }, utility: { score: rank === null ? null : utility.score } })),
  };
  boundObservationMemory(state);
}

/** Also used after control-only action targets extend the same publication
 * ledger. Explanations or process caches never determine this trimming. */
export function boundObservationMemory(state: StrategyObservationMemory) {
  type Item = { id: string; use: CacheUse; value: unknown; group: string };
  const items: Item[] = [];
  const add = (group: string, values: readonly unknown[], id: (value: any, index: number) => string,
    use: (value: any) => CacheUse = value => value) => values.forEach((value, index) => items.push({ id: `${group}:${id(value, index)}`, use: use(value), value, group }));
  add('objectives', state.history?.objectives ?? [], value => value.id, () => ({}));
  add('lostSites', state.history?.lostSites ?? [], value => value.id, () => ({}));
  add('assets', state.history?.assets ?? [], value => value.id, () => ({}));
  add('crossings', state.crossings, value => value.key);
  add('pointRoutes', state.pointRoutes?.entries ?? [], value => value.key);
  add('goalGeometry', state.goalGeometry?.entries ?? [], value => value.key);
  add('land', state.fields.land, value => `${value.goal.x}:${value.goal.y}`);
  add('sea', state.fields.sea, value => `${value.goal.x}:${value.goal.y}`);
  const payload = (entries: readonly Item[]) => {
    const group = (name: string) => entries.filter(entry => entry.group === name).map(entry => entry.value);
    const { cacheCapacities: _diagnostics, ...rest } = state;
    return { ...rest, fields: { land: group('land'), sea: group('sea') }, crossings: group('crossings'),
      ...(state.history ? { history: { ...state.history, objectives: group('objectives'), lostSites: group('lostSites'), assets: group('assets') } } : {}),
      ...(state.pointRoutes ? { pointRoutes: { entries: group('pointRoutes') } } : {}),
      ...(state.goalGeometry ? { goalGeometry: { ...state.goalGeometry, entries: group('goalGeometry') } } : {}) };
  };
  const result = boundCache({ kind: 'observation', entries: items, id: entry => entry.id,
    lastUsed: entry => entry.use.lastUsedThink ?? -1, plans: entry => entry.use.planIds ?? [],
    maxBytes: OBSERVATION_BYTE_LIMIT, bytes: entries => observationJsonBytes(payload(entries)) + 16,
    thinkSequence: state.thinkSequence ?? state.factWork?.tick ?? 0, capacity: state.cacheCapacities?.observation });
  const retained = new Set(result.entries.map(entry => entry.value));
  if (result.evicted.length) state.truncated = true;
  if (state.history) {
    state.history.objectives = state.history.objectives.filter(value => retained.has(value));
    state.history.lostSites = state.history.lostSites.filter(value => retained.has(value));
    state.history.assets = state.history.assets.filter(value => retained.has(value));
  }
  state.crossings = state.crossings.filter(value => retained.has(value));
  if (state.pointRoutes) state.pointRoutes.entries = state.pointRoutes.entries.filter(value => retained.has(value));
  if (state.goalGeometry) state.goalGeometry.entries = state.goalGeometry.entries.filter(value => retained.has(value));
  state.fields.land = state.fields.land.filter(value => retained.has(value));
  state.fields.sea = state.fields.sea.filter(value => retained.has(value));
  (state.cacheCapacities ??= {}).observation = result.capacity;
}

/** Called once by the owner-think boundary, never by nested fact readers. */
export function beginObservationThink(state: StrategyObservationMemory) {
  const next = (state.thinkSequence ?? state.factWork?.thinkSequence ?? 0) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Owner think sequence exhausted');
  state.thinkSequence = next;
  return next;
}
