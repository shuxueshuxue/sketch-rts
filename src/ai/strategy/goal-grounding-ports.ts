import type { Unit } from '../../shared/types';
import type { Point, SeaId, Target } from './types';
import type { Shore } from './regions';
import type { VoyageRisk } from './voyage-risk';
import type { GoalCandidates, GoalCapacityPressure, GoalEntityReference, GoalEstimate, GoalFact, GoalParameter, GoalTransportRequest } from './goal-planner-types';

export type GoalPublishedValue<T> = Readonly<{ state: 'met'; value: T; factIds: readonly string[] }>
  | Exclude<GoalCandidates<never>, { state: 'met' }>;
/** Initialization is a cheap serializable cursor, not geometry computation.
 * advance performs finite checks and reports their logical work. The common
 * source owns scheduling/publication on the existing FactWorkQueue. */
export type GoalGeometryRequest<State, Value> = Readonly<{
  key: string; revision: string; initialState: State;
  references?: readonly string[];
  advance: (state: State, allowance: number) => Readonly<{
    state: State; work: number; done: boolean; value?: Value;
  }>;
}>;
export type GoalGeometryReader = (<State, Value>(request: GoalGeometryRequest<State, Value>) => GoalPublishedValue<Value>) & {
  /** Lossless interned geometry versions, retained and charged with entries. */
  reference?: (namespace: string, value: GoalParameter) => string;
};
/** Sea-origin cargo needs only a destination shore. Land-origin grounding
 * must require departure before producing a pickup option. */
export type GoalShorePair = Readonly<{ id: string; seaId: SeaId; departure?: Shore; landing: Shore }>;
export type GoalHullCandidate = Readonly<{
  id: string; reference: GoalEntityReference; seaId: SeaId;
  /** Evaluation-only native shape/stats. Its ID never names an allocation
   * resource, world entity, receipt or output binding. */
  assessment: Unit; availableTick: number; preconditions: readonly GoalFact[];
  capacity: number; cargoUnitIds: readonly string[]; factIds: readonly string[];
}>;
export type GoalBerth = Readonly<{ water: Point; ground: Point; heading: number }>;
export type GoalSeaLeg = Readonly<{ ticks: number; endpoint: Point; heading: number;
  /** Estimated time/target is never an observed native arrival pose. */
  timeBasis?: 'sea-connectivity-estimate' | 'native-point-route';
  /** Published existing voyage model for this exact hull/start/native route. */
  risk?: VoyageRisk;
}>;
/** All implementations are injected by the one owner-think source. Candidate
 * domains consume them; they cannot construct another query/work allowance. */
export type GoalTransportFactPorts = Readonly<{
  shores: (from: Target, to: Target) => GoalCandidates<GoalShorePair>;
  hulls: (seaId: SeaId, from: Target, mass: number, request: GoalTransportRequest) => GoalCandidates<GoalHullCandidate>;
  /** Optional target pose is a dock geometry proposal, never current arrival. */
  berth: (passenger: Unit, hull: GoalHullCandidate, shore: Shore,
    preferredPose?: Readonly<Point & { heading: number }>) => GoalPublishedValue<GoalBerth>;
  seaLeg: (hull: GoalHullCandidate, from: Point & { heading: number }, to: Point, future: boolean) => GoalEstimate<GoalSeaLeg>;
}>;

/** Only this finite JSON representation is retained across thinks. Runtime
 * step callbacks and assessment snapshots must never be stored here. */
export type GoalGeometryMemory = {
  version: 1;
  references?: { id: string; namespace: string; value: GoalParameter }[];
  nextReference?: number;
  capacity?: { mode: 'bounded' | 'measurement'; maxBytes: number; maxEntries: number; thinkSequence: number;
    pinnedBytes: number; pinnedEntries: number; peakPinnedBytes: number; peakResidentBytes: number; overflowCount: number;
    pressure?: GoalCapacityPressure };
  entries: { key: string; revision: string; state: GoalParameter; work: number;
    references?: string[];
    requestedTick: number; lastUsedThink?: number; planIds?: string[]; readyTick: number | null; readyThink?: number; value: GoalParameter | null; errorCode?: string }[];
};
