import type { DamageProfile } from '../shared/damage-types';
import type { Observed, ObservedSource, ObservedUnit, SimulationRemovalEvent } from '../shared/sim/observation';
import type { GameCommand, PlayerId } from '../shared/types';

export type AiDeathCategory = 'accepted-engagement' | 'logistics-transit' | 'idle'
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
  perimeter: { x: number; y: number; radius: number } | null;
};

export type AiDeathAssignment = {
  observedTick: number;
  task: AiDeathTask | null;
  otherTaskCandidates: AiDeathTask[];
  state: 'unassigned' | 'assigned' | 'en-route' | 'on-station' | 'emergency-interruption';
  stateAttribution: 'inferred';
  evidence: string[];
  /** No formal objective acceptance range exists in the legacy modules. */
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
  currentOrder: ObservedUnit['order'];
  lastIssuedOrder: AiIssuedOrder | null;
  /** Automatic acquisition/queued transitions can differ from the last issued command. */
  currentOrderSource: 'matches-last-issued' | 'derived-or-unrecorded';
  location: { space: 'land' | 'sea' | 'deck' | 'cabin' | 'garrison';
    landRegion: number | null; seaRegion: number | null; carrierId: string | null };
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
  classification: {
    disposition: 'normal' | 'abnormal' | 'lifecycle';
    primary: AiDeathCategory;
    tags: AiDeathCategory[];
    explanations: string[];
    attribution: 'inferred' | 'lifecycle-event';
    diagnosticVersion: 1;
    /** Baseline diagnostic, not a hidden policy change or a measured probability of winning. */
    minimumInferredCombatRatio: number;
  };
  limitations: string[];
};

export type AiDeathSummary = {
  events: number;
  deaths: number;
  nativeLosses: number;
  aliveExpirations: number;
  scriptedExits: number;
  normal: { count: number; catalogGold: number };
  abnormal: { count: number; catalogGold: number };
  lifecycle: { count: number; catalogGold: number };
  /** Primary categories partition records; tags deliberately overlap. */
  byCategory: Partial<Record<AiDeathCategory, { count: number; catalogGold: number }>>;
  byTag: Partial<Record<AiDeathCategory, number>>;
};

export type AiDeathLedgerFrame = {
  schemaVersion: 1;
  owner: PlayerId;
  throughTick: number;
  sinceTick: number;
  records: AiUnitDeathRecord[];
  summary: AiDeathSummary;
};
