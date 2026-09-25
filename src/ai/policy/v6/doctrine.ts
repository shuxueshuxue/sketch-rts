import type { BuildingKind, RaceId, TrainableUnitKind, UpgradeKind } from "../../../shared/types";

// @@@v6-doctrine - What V6 plays is data, not code: a personality (how bold, how greedy, how sneaky) and a race strategy.
// A game draws one of each, so V6 is a different opponent from game to game while every module reads the same numbers.
//
// A strategy is a list of phases, like AMAI's per-tier build sequences (TFT/Human/BuildSequence.ai). A phase is what V6
// wants to own while it lasts, each want with a priority: so many units of a kind, a building, towers, a base count, an
// upgrade. Wants are standing orders, not one-off purchases: a unit that dies is simply missing again. The first phase
// holds the base while the economy grows; later phases add casters, bases and what rides beside the host.

export type V6Profile = {
  id: string;
  weight: number;
  // Added to V6's side of the attack gate, as a share of its own strength: above 0 it attacks on thinner margins.
  aggression: number;
  // Scales every raid's chance to launch when its window opens.
  raidAppetite: number;
};

export type V6Want =
  | { unit: TrainableUnitKind; count: number; priority: number }
  | { building: BuildingKind; count: number; priority: number }
  | { towers: "main" | "outposts"; count: number; priority: number }
  | { bases: number; priority: number }
  | { upgrade: UpgradeKind; level: number; priority: number };

export type V6Phase = {
  wants: V6Want[];
  // The next phase opens once this share of the phase's unit wants stands, or supply reaches the bar (AMAI's tier block).
  advanceShare: number;
  advanceSupply: number;
};

export type V6RaidPlan = {
  kinds: TrainableUnitKind[];
  size: number;
  minSecond: number;
  cooldownSeconds: number;
};

export type V6Strategy = {
  id: string;
  race: RaceId;
  weight: number;
  phases: V6Phase[];
  raids: V6RaidPlan[];
};

// Personalities vary style, not how much risk V6 takes. Every knob was tried on its own over the tune seeds: less
// aggression, an extra tower and greedy extra bases each lost 12 to 15 games in 100, while a little more aggression and
// a bigger raid appetite cost nothing measurable. So the three personalities left differ in how bold and how sneaky V6
// is; a greedy many-bases style needs expansions V6 can defend first.
export const V6_PROFILES: V6Profile[] = [
  { id: "steady", weight: 3, aggression: 0, raidAppetite: 0.6 },
  { id: "warlord", weight: 2, aggression: 0.15, raidAppetite: 0.8 },
  { id: "trickster", weight: 2, aggression: 0, raidAppetite: 1 },
];

const RAIDERS: V6RaidPlan = { kinds: ["raider", "knight"], size: 4, minSecond: 300, cooldownSeconds: 90 };
const RUNNERS: V6RaidPlan = { kinds: ["cinderRunner", "emberRavager"], size: 4, minSecond: 300, cooldownSeconds: 90 };

// Every strategy is a caster host: casters and their free spirits, nothing in front of them. Against V5's shooters and V3
// together, spirits were the only early army that traded well. The first rewrite opened with a main tower and put a melee
// front before the casters in phase two; with the same casters and neither, the two hosts went from 31% and 49% of the
// tune games to 92% and 95% (a tower is one footman that cannot move, and a front melts in the first combined push). The
// last phase's caster count is a ceiling V6 is not meant to reach: production never idles for want of a target.
// Strategies differ in what rides beside the host (raiding parties, the speed to use them) and in their race.
// Like AMAI's build sequences, a phase restates the bases of the one before, and the natural outranks the phase's army:
// one mine against two opponents' four is a lost game however well the army fights (V6 played whole games on one mine,
// the casters buying every coin before the hall's 320 ever stood in the bank).
export const V6_STRATEGIES: V6Strategy[] = [
  {
    // Played by hand on chalkFen (V6 north, won at 1322s): summoners and nothing else in front of them, the natural as
    // soon as the spirits have cleared its camp, a second sanctum at the first spare gold, a third base once the army
    // stands. No early tower and no melee front: every coin of those was a summoner fewer when the first push came.
    id: "grove-spirit-host",
    race: "grove",
    weight: 3,
    phases: [
      {
        wants: [
          { unit: "summoner", count: 4, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "summoner", count: 8, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 30,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "summoner", count: 14, priority: 56 },
          { building: "sanctum", count: 2, priority: 54 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { unit: "summoner", count: 30, priority: 52 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [],
  },
  {
    // The spirit host's army with a raiding party beside it: four raiders (stables, and the speed they need to get in and
    // out) hunt workers while the summoners hold the map. The old opening (a main tower, then a melee front) won half its
    // games while the same summoners without them won nine in ten.
    id: "grove-raider-host",
    race: "grove",
    weight: 2,
    phases: [
      {
        wants: [
          { unit: "summoner", count: 4, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "summoner", count: 8, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 30,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "summoner", count: 14, priority: 56 },
          { unit: "raider", count: 4, priority: 54 },
          { building: "sanctum", count: 2, priority: 52 },
          { upgrade: "speedTraining", level: 1, priority: 50 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { unit: "summoner", count: 28, priority: 52 },
          { unit: "raider", count: 5, priority: 50 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [RAIDERS],
  },
  {
    // Ember's copy of the grove spirit host: pyre callers only, the natural early, a second spire, then a third base.
    id: "ember-pyre-host",
    race: "ember",
    weight: 3,
    phases: [
      {
        wants: [
          { unit: "pyreCaller", count: 4, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "pyreCaller", count: 8, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 30,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "pyreCaller", count: 14, priority: 56 },
          { building: "cinderSpire", count: 2, priority: 54 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { unit: "pyreCaller", count: 30, priority: 52 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [],
  },
  {
    // Ember's raiding host: the pyre host's army, with four cinder runners (and the spire's speed training) hunting workers.
    id: "ember-runner-host",
    race: "ember",
    weight: 2,
    phases: [
      {
        wants: [
          { unit: "pyreCaller", count: 4, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "pyreCaller", count: 8, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 30,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "pyreCaller", count: 14, priority: 56 },
          { unit: "cinderRunner", count: 4, priority: 54 },
          { building: "cinderSpire", count: 2, priority: 52 },
          { upgrade: "speedTraining", level: 1, priority: 50 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { unit: "pyreCaller", count: 28, priority: 52 },
          { unit: "cinderRunner", count: 5, priority: 50 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [RUNNERS],
  },
];
