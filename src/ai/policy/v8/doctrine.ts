import type { V6RaidPlan, V6Strategy } from "../v6/doctrine";

// @@@v8-doctrine - V8 plays V7's machinery (its opening, economy, general, creeping) with armies that summon nothing
// (see v8-no-summoners): every body it fields is trained. Against V7's spirit hosts it brings what kills summons (the
// witch's curse strikes a summoned unit for 100, an ash chieftain hits casters and summons half again as hard) and
// heavy armor, which takes half from shooters and casters (V5's archers, V7's summoners and pyre callers). Four lines,
// two per race, drawn per game like V6's strategies; which of them carry V8 is what the gauntlet's tally by strategy is
// for.

const RAIDERS: V6RaidPlan = { kinds: ["raider", "knight"], size: 4, minSecond: 300, cooldownSeconds: 90 };
const RUNNERS: V6RaidPlan = { kinds: ["cinderRunner", "emberRavager"], size: 4, minSecond: 300, cooldownSeconds: 90 };

export const V8_STRATEGIES: V6Strategy[] = [
  {
    // Priests and witches behind raiders, then knights: heavy cavalry that charges, healed, with curses on the summons.
    id: "grove-knight-line",
    race: "grove",
    weight: 1,
    phases: [
      {
        wants: [
          { unit: "priest", count: 2, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "witch", count: 2, priority: 58 },
          { unit: "raider", count: 4, priority: 55 },
        ],
        advanceShare: 0.75,
        advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "knight", count: 6, priority: 60 },
          { unit: "priest", count: 3, priority: 56 },
          { unit: "witch", count: 3, priority: 55 },
          { building: "stables", count: 2, priority: 52 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 70,
      },
      {
        wants: [
          { unit: "knight", count: 24, priority: 55 },
          { unit: "priest", count: 4, priority: 53 },
          { unit: "witch", count: 4, priority: 53 },
          { unit: "golem", count: 4, priority: 52 },
          { upgrade: "weaponTraining", level: 2, priority: 51 },
          { upgrade: "reinforcedPlating", level: 2, priority: 50 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [RAIDERS],
    standIn: "footman",
  },
  {
    // A footman front and massed archers, with priests and witches behind; knights once the tier opens.
    id: "grove-archer-line",
    race: "grove",
    weight: 1,
    phases: [
      {
        wants: [
          { unit: "archer", count: 6, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "priest", count: 2, priority: 58 },
          { unit: "witch", count: 2, priority: 56 },
        ],
        advanceShare: 0.75,
        advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "archer", count: 12, priority: 58 },
          { unit: "footman", count: 6, priority: 57 },
          { unit: "priest", count: 3, priority: 56 },
          { unit: "witch", count: 3, priority: 55 },
          { building: "archeryRange", count: 2, priority: 52 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 70,
      },
      {
        wants: [
          { unit: "archer", count: 24, priority: 54 },
          { unit: "knight", count: 8, priority: 55 },
          { unit: "priest", count: 4, priority: 53 },
          { unit: "witch", count: 4, priority: 53 },
          { upgrade: "weaponTraining", level: 2, priority: 51 },
          { upgrade: "reinforcedPlating", level: 2, priority: 50 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [],
    standIn: "footman",
  },
  {
    // Acolytes and hexers behind cinder runners, then ash chieftains (the caster slayers) and cinder revenants.
    id: "ember-chieftain-line",
    race: "ember",
    weight: 1,
    phases: [
      {
        wants: [
          { unit: "emberAcolyte", count: 2, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "ashHexer", count: 2, priority: 58 },
          { unit: "cinderRunner", count: 4, priority: 55 },
        ],
        advanceShare: 0.75,
        advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "ashChieftain", count: 6, priority: 60 },
          { unit: "emberAcolyte", count: 3, priority: 56 },
          { unit: "ashHexer", count: 3, priority: 55 },
          { building: "ashenHall", count: 2, priority: 52 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 70,
      },
      {
        wants: [
          { unit: "ashChieftain", count: 16, priority: 55 },
          { unit: "cinderRevenant", count: 8, priority: 54 },
          { unit: "emberAcolyte", count: 4, priority: 53 },
          { unit: "ashHexer", count: 4, priority: 53 },
          { upgrade: "weaponTraining", level: 2, priority: 51 },
          { upgrade: "reinforcedPlating", level: 2, priority: 50 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [RUNNERS],
    standIn: "emberRavager",
  },
  {
    // A ravager front and massed spark archers, with acolytes and hexers behind; ash chieftains once the tier opens.
    id: "ember-spark-line",
    race: "ember",
    weight: 1,
    phases: [
      {
        wants: [
          { unit: "sparkArcher", count: 6, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "emberAcolyte", count: 2, priority: 58 },
          { unit: "ashHexer", count: 2, priority: 56 },
        ],
        advanceShare: 0.75,
        advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "sparkArcher", count: 12, priority: 58 },
          { unit: "emberRavager", count: 6, priority: 57 },
          { unit: "emberAcolyte", count: 3, priority: 56 },
          { unit: "ashHexer", count: 3, priority: 55 },
          { building: "cinderSpire", count: 2, priority: 52 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 70,
      },
      {
        wants: [
          { unit: "sparkArcher", count: 24, priority: 54 },
          { unit: "ashChieftain", count: 8, priority: 55 },
          { unit: "emberAcolyte", count: 4, priority: 53 },
          { unit: "ashHexer", count: 4, priority: 53 },
          { upgrade: "weaponTraining", level: 2, priority: 51 },
          { upgrade: "reinforcedPlating", level: 2, priority: 50 },
          { bases: 3, priority: 50 },
          { towers: "outposts", count: 1, priority: 44 },
          { bases: 4, priority: 35 },
        ],
        advanceShare: 1,
        advanceSupply: 1_000,
      },
    ],
    raids: [],
    standIn: "emberRavager",
  },
];
