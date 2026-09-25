import type { BuildingKind, RaceId, TrainableUnitKind, UpgradeKind } from "../../../shared/types";

// @@@v6-doctrine - What V6 plays is data, not code: a personality (how bold, how greedy, how sneaky) and a race strategy.
// A game draws one of each, so V6 is a different opponent from game to game while every module reads the same numbers.
//
// A strategy is a list of phases, like AMAI's per-tier build sequences (TFT/Human/BuildSequence.ai). A phase is what V6
// wants to own while it lasts, each want with a priority: so many units of a kind, a building, towers, a base count, an
// upgrade. Wants are standing orders, not one-off purchases: a unit that dies is simply missing again. The first phase
// holds the base while the economy grows; later phases add a front, more bases and a siege piece.

export type V6Profile = {
  id: string;
  weight: number;
  // Added to V6's side of the attack gate, as a share of its own strength: above 0 it attacks on thinner margins.
  aggression: number;
  // Scales every raid's chance to launch when its window opens.
  raidAppetite: number;
};

// A reactive front: the count is split between a unit that can catch shooters and one that holds a line, by how much of
// the enemy army is shooters (AMAI's SetBuildReact).
export type V6ReactiveFront = { chaser: TrainableUnitKind; holder: TrainableUnitKind };

export type V6Want =
  | { unit: TrainableUnitKind; count: number; priority: number }
  | { front: V6ReactiveFront; count: number; priority: number }
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

const GROVE_FRONT: V6ReactiveFront = { chaser: "raider", holder: "footman" };
const EMBER_FRONT: V6ReactiveFront = { chaser: "cinderRunner", holder: "emberRavager" };

// Every strategy opens on the caster core and one tower: against V5's shooters and V3 together, free spirits were the
// only early army that traded well, and a melee front alone melted in the first combined push around minute five. A
// second early tower bought little (a tower is one footman that cannot move) and cost the workers and the natural. The
// last phase's caster count is a ceiling V6 is not meant to reach: production never idles for want of a target. The front comes in phase two, in front of the summoners, reacting to what the enemy fields;
// phase three brings the siege piece and more bases. Strategies differ in their front, their raids and their siege.
// Like AMAI's build sequences, a phase restates the bases of the one before, and the natural outranks the phase's army:
// one mine against two opponents' four is a lost game however well the army fights (V6 played whole games on one mine,
// the summoners and the front buying every coin before the hall's 320 ever stood in the bank).
export const V6_STRATEGIES: V6Strategy[] = [
  {
    id: "grove-spirit-host",
    race: "grove",
    weight: 3,
    phases: [
      {
        wants: [
          { unit: "summoner", count: 4, priority: 65 },
          { towers: "main", count: 1, priority: 62 },
          { bases: 2, priority: 55 },
          { unit: "summoner", count: 6, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 26,
      },
      {
        wants: [
          { front: GROVE_FRONT, count: 4, priority: 60 },
          { unit: "summoner", count: 12, priority: 56 },
          { towers: "outposts", count: 1, priority: 52 },
          { building: "sanctum", count: 2, priority: 50 },
          { unit: "priest", count: 1, priority: 45 },
          { bases: 2, priority: 66 },
          { bases: 3, priority: 40 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { front: GROVE_FRONT, count: 4, priority: 58 },
          { building: "workshop", count: 1, priority: 54 },
          { unit: "golem", count: 3, priority: 52 },
          { unit: "summoner", count: 30, priority: 50 },
          { unit: "priest", count: 2, priority: 45 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 3, priority: 48 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [],
  },
  {
    id: "grove-raider-host",
    race: "grove",
    weight: 2,
    phases: [
      {
        wants: [
          { unit: "summoner", count: 4, priority: 65 },
          { towers: "main", count: 1, priority: 62 },
          { bases: 2, priority: 55 },
          { unit: "summoner", count: 6, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 26,
      },
      {
        wants: [
          { unit: "raider", count: 4, priority: 60 },
          { unit: "summoner", count: 12, priority: 56 },
          { upgrade: "speedTraining", level: 1, priority: 52 },
          { towers: "outposts", count: 1, priority: 50 },
          { bases: 2, priority: 66 },
          { bases: 3, priority: 40 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { unit: "raider", count: 5, priority: 58 },
          { unit: "knight", count: 3, priority: 54 },
          { unit: "summoner", count: 30, priority: 50 },
          { unit: "priest", count: 2, priority: 45 },
          { bases: 3, priority: 48 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [RAIDERS],
  },
  {
    id: "ember-pyre-host",
    race: "ember",
    weight: 3,
    phases: [
      {
        wants: [
          { unit: "pyreCaller", count: 4, priority: 65 },
          { towers: "main", count: 1, priority: 62 },
          { bases: 2, priority: 55 },
          { unit: "pyreCaller", count: 6, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 26,
      },
      {
        wants: [
          { front: EMBER_FRONT, count: 4, priority: 60 },
          { unit: "pyreCaller", count: 12, priority: 56 },
          { towers: "outposts", count: 1, priority: 52 },
          { building: "cinderSpire", count: 2, priority: 50 },
          { unit: "emberAcolyte", count: 1, priority: 45 },
          { bases: 2, priority: 66 },
          { bases: 3, priority: 40 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { front: EMBER_FRONT, count: 6, priority: 58 },
          { unit: "pyreCaller", count: 30, priority: 52 },
          { unit: "ashHexer", count: 2, priority: 48 },
          { unit: "emberAcolyte", count: 2, priority: 45 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 3, priority: 48 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [],
  },
  {
    id: "ember-runner-host",
    race: "ember",
    weight: 2,
    phases: [
      {
        wants: [
          { unit: "pyreCaller", count: 4, priority: 65 },
          { towers: "main", count: 1, priority: 62 },
          { bases: 2, priority: 55 },
          { unit: "pyreCaller", count: 6, priority: 50 },
        ],
        advanceShare: 0.75,
        advanceSupply: 26,
      },
      {
        wants: [
          { unit: "cinderRunner", count: 4, priority: 60 },
          { unit: "pyreCaller", count: 12, priority: 56 },
          { upgrade: "speedTraining", level: 1, priority: 52 },
          { towers: "outposts", count: 1, priority: 50 },
          { bases: 2, priority: 66 },
          { bases: 3, priority: 40 },
        ],
        advanceShare: 0.75,
        advanceSupply: 55,
      },
      {
        wants: [
          { unit: "cinderRunner", count: 5, priority: 58 },
          { unit: "emberRavager", count: 4, priority: 54 },
          { unit: "pyreCaller", count: 30, priority: 50 },
          { unit: "ashHexer", count: 2, priority: 45 },
          { bases: 3, priority: 48 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [RUNNERS],
  },
];
