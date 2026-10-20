import type { DamageProfile } from '../shared/damage-types';
import type { Observed, ObservedSource, ObservedUnit, SimulationRemovalEvent } from '../shared/sim/observation';
import type { GameCommand, PlayerId } from '../shared/types';
import type { DeathAttributionContext } from './strategy/types';

export type AiDeathCategory = 'combat-loss' | 'retreat-failed' | 'accepted-engagement' | 'logistics-transit' | 'idle'
  | 'retreat-or-treatment' | 'isolated-without-evacuation-plan' | 'recent-reassignment'
  | 'out-of-bounds' | 'neutral-outside-clearing' | 'post-worn-abandonment'
  | 'outmatched' | 'exposed-worker' | 'friendly-source' | 'unattributed' | 'summon-expired' | 'script-exit' | 'forfeit';

export type AiDeathTask = {
  id: string;
  kind: string;
  targetId: string | null;
  stage: string | null;
  source: string;
  /** Until the allocator exists this is always inferred, even when membership is explicit. */
  attribution: 'inferred';
  methodId: string | null;
  utility: number | null;
  combat: boolean;
  clearing: boolean;
  /** Observed live members of the recorded target camp; absent only in older exports. */
  clearingTargetIds?: string[];
  perimeter: { x: number; y: number; radius: number } | null;
};

export type AiDeathAssignment = {
  observedTick: number;
  task: AiDeathTask | null;
  otherTaskCandidates: AiDeathTask[];
  state: 'unassigned' | 'assigned' | 'en-route' | 'on-station' | 'emergency-interruption';
  stateAttribution: 'inferred';
  evidence: string[];
  /** No formal objective acceptance range exists in the previous modules. */
  plannedBalanceRange: null;
};

export type AiIssuedOrder = {
  tick: number;
  command: GameCommand;
  executor: string | null;
  source: string | null;
  attribution: 'recorded-issued-command' | 'sim-command-without-executor';
};

export type AiDeathBalance = {
  tick: number;
  radius: number;
  own: number;
  hostile: number;
  ratio: number | null;
  ownIds: string[];
  hostileIds: string[];
  estimator: 'effective-combat-rating';
};

export type AiUnitDeathRecord = {
  id: string;
  tick: number;
  /** Cleanup may happen later than the lethal hit; incremental traces use this boundary. */
  removedTick: number;
  owner: PlayerId;
  unit: ObservedUnit;
  catalogGold: number;
  removal: SimulationRemovalEvent['reason'];
  countedAsNativeLoss: boolean;
  /** Alive summon expiry and scripted exits are lifecycle events, not combat casualties. */
  actualDeath: boolean;
  cause: 'damage' | 'sinking' | 'forfeit' | 'expiry' | 'script-exit' | 'unknown';
  killer: ObservedSource | null;
  killerKindAttribution: 'observed-live-entity' | 'previously-observed-entity' | 'unresolved-source' | null;
  fatalDamageProfile: Observed<DamageProfile> | null;
  damageWindow: { fromTick: number; toTick: number; sources: {
    source: ObservedSource; profile: Observed<DamageProfile>; damage: number; hits: number;
  }[] };
  assignment: AiDeathAssignment;
  /** Shared strategy-layer join schema. Previous task membership does not create formal allocations. */
  attributionContext: DeathAttributionContext;
  currentOrder: ObservedUnit['order'];
  /** Can differ from the last issued command when a later command was queued or instantaneous. */
  currentOrderIssuer: AiIssuedOrder | null;
  lastIssuedOrder: AiIssuedOrder | null;
  /** Automatic acquisition/queued transitions can differ from the last issued command. */
  currentOrderSource: 'matches-last-issued' | 'matches-earlier-issued' | 'derived-or-unrecorded';
  location: { space: 'land' | 'sea' | 'deck' | 'cabin' | 'garrison';
    landId: `land:${number}` | null; seaId: `sea:${number}` | null; carrierId: string | null };
  health: { tick: number; hp: number; maxHp: number; source: 'think' | 'damage-before' | 'damage-after' | 'removal' }[];
  context: {
    retreating: boolean;
    treatment: boolean;
    killerIsAlly: boolean | null;
    balance: AiDeathBalance;
    outsidePerimeter: boolean | null;
    onHomeGround: boolean | null;
    safeOwnSitesOnGround: string[];
    ownTransportIds: string[];
    evacuationAssigned: boolean;
    /** Geometry/ownership is observed; absence of a transport assignment is not a proof no safe route exists. */
    escapeRoute: 'not-evaluated';
    switches: { tick: number; from: string | null; to: string | null; attribution: 'inferred' }[];
    wornRetreatTick: number | null;
  };
  classification: AiDeathClassification;
  limitations: string[];
};

export type AiDeathDisposition = 'normal' | 'suspicious' | 'abnormal' | 'unattributed' | 'lifecycle';
export type AiDeathClassificationV1 = {
  disposition: 'normal' | 'abnormal' | 'lifecycle';
  primary: AiDeathCategory;
  tags: AiDeathCategory[];
  explanations: string[];
  attribution: 'inferred' | 'lifecycle-event';
  diagnosticVersion: 1;
  minimumInferredCombatRatio: number;
};
export type AiDeathEngagement = {
  status: 'engaged' | 'outside-combat' | 'unknown';
  window: { fromTick: number; toTick: number };
  radius: number;
  balanceTick: number;
  opponentIds: string[];
  unresolvedNearbyIds: string[];
  receivedDamage: number;
  /** Null when the original export did not record outgoing damage. Never inferred from orders. */
  dealtDamage: number | null;
  inheritedFromCarrier: string | null;
  provenance: 'live-native-events' | 'reclassified-native-records';
  evidence: string[];
};
export type AiDeathClassification = {
  disposition: AiDeathDisposition;
  primary: AiDeathCategory;
  /** Every original v1 tag is retained, with v2 child labels appended. */
  tags: AiDeathCategory[];
  explanations: string[];
  attribution: 'inferred' | 'lifecycle-event';
  diagnosticVersion: 2;
  minimumInferredCombatRatio: number;
  engagement: AiDeathEngagement;
  v1: AiDeathClassificationV1;
};

export type AiDeathSummary = {
  events: number;
  deaths: number;
  nativeLosses: number;
  aliveExpirations: number;
  scriptedExits: number;
  normal: { count: number; catalogGold: number };
  suspicious: { count: number; catalogGold: number };
  abnormal: { count: number; catalogGold: number };
  unattributed: { count: number; catalogGold: number };
  lifecycle: { count: number; catalogGold: number };
  /** Primary categories partition records; tags deliberately overlap. */
  byCategory: Partial<Record<AiDeathCategory, { count: number; catalogGold: number }>>;
  byTag: Partial<Record<AiDeathCategory, number>>;
};

export type AiDeathLedgerFrame = {
  schemaVersion: 2;
  owner: PlayerId;
  throughTick: number;
  sinceTick: number;
  records: AiUnitDeathRecord[];
  summary: AiDeathSummary;
};
