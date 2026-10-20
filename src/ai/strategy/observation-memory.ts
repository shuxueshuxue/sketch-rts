import type { VoyageRiskMemory } from './voyage-risk';
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
export type FieldProgress = { goal: Point; work: number; readyTick: number | null };
export type StrategyObservationMemory = {
  version: 1;
  owner: PlayerId;
  terrain: string;
  landBodies: string;
  fields: { land: FieldProgress[]; sea: FieldProgress[] };
  crossings: { key: string; fieldTicks: number[]; quotedTick: number }[];
  /** Bounded native planning cursor and exposure publication; no distance-field arrays. */
  voyageRisks?: VoyageRiskMemory;
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
  } else if (state.landBodies !== bodies) state = { ...state, landBodies: bodies, fields: { land: [], sea: state.fields.sea }, crossings: [] };
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
  // Explicit serialization bound, independent of map area or number of entities.
  // Drop historical quotations before useful geometry progress. A gap is retained
  // as unknown; it cannot create a recovered-site history or a zero handoff cost.
  let bytes = observationJsonBytes(state) + 16; // {"observation": ... }
  if (bytes > OBSERVATION_BYTE_LIMIT && !state.truncated) {
    state.truncated = true; bytes = observationJsonBytes(state) + 16;
  }
  const discard = (values: unknown[], first = false) => {
    const comma = values.length > 1 ? 1 : 0;
    const removed = first ? values.shift() : values.pop();
    bytes -= observationJsonBytes(removed) + comma;
  };
  while (bytes > OBSERVATION_BYTE_LIMIT) {
    if (state.history.objectives.length) discard(state.history.objectives);
    else if (state.history.lostSites.length) discard(state.history.lostSites, true);
    else if (state.history.assets.length) discard(state.history.assets);
    else if (state.crossings.length) discard(state.crossings, true);
    else if (state.fields.land.length) discard(state.fields.land);
    else if (state.fields.sea.length) discard(state.fields.sea);
    else throw new Error('Strategy observation identity exceeds its serialization budget');
  }
}
