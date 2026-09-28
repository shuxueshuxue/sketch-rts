import type { V6RaidPlan, V6Strategy } from "../v6/doctrine";

// @@@v8-doctrine - V8 plays V7's machinery (its opening, economy, general, creeping) against V5 and V7 together, with
// armies that neither shoot nor summon (see v8-forbidden-units): a melee line with healers and cursers behind it. What
// the melee has against the pair: speed and the cavalry's charge to reach V5's kiting shooters, heavy armor that takes
// half from shooters and casters, the witch's curse, which strikes a summoned unit for 100 and so kills V7's spirits
// outright, and the ash chieftain, who hits casters and summons half again as hard. One line per race. A melee line has to
// run V5's archers down, and they step back between shots at 3.0: V8 first drew from four lines, and over 2000 games the
// footmen's (3.1, grove wardens 3.0) won 32% and the cinder runners' (fast, but 96 hp) 30%, against 40% for the riders
// and 35% for the ravagers; with those two alone V8 went from 682 wins to 780.

const RAIDERS: V6RaidPlan = { kinds: ["raider", "knight"], size: 4, minSecond: 300, cooldownSeconds: 90 };

export const V8_STRATEGIES: V6Strategy[] = [
  {
    // Raiders that charge, priests and witches behind them, and from the second phase knights ahead of all else: the
    // economy buys the farms to the elite bar for them. Left in the third phase, which opens at supply 70 while V8 stood
    // near 40, knights never came (none in 56 games by 12:00); wanted from the second, they came in 31 of 55 by 10:00,
    // and the grove line won 614 of 1000 games against 541.
    id: "grove-cavalry-line",
    race: "grove",
    weight: 1,
    phases: [
      {
        wants: [
          { unit: "priest", count: 2, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "raider", count: 6, priority: 58 },
          { unit: "witch", count: 2, priority: 56 },
        ],
        advanceShare: 0.75,
        advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "knight", count: 6, priority: 61 },
          { unit: "raider", count: 8, priority: 58 },
          { unit: "priest", count: 3, priority: 56 },
          { unit: "witch", count: 3, priority: 55 },
          { building: "stables", count: 2, priority: 52 },
          { upgrade: "weaponTraining", level: 1, priority: 51 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 70,
      },
      {
        wants: [
          { unit: "knight", count: 12, priority: 57 },
          { unit: "raider", count: 12, priority: 55 },
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
    raids: [RAIDERS],
    // @@@v8-lancer-stand-in - The opening's soldier is the lancer, not the footman: chasing V5's archers, footmen hit the
    // one they chased 6% of the time, the slowest of V8's fighters (3.1 to the archers' 3.0); the lancer walks 3.4 and
    // strikes from 74. With it V8 won 1225 of 2000 games against 1195 (297 of 500 on unseen seeds against 292).
    standIn: "lancer",
  },
  {
    // Ravagers, acolytes and hexers, with ash chieftains as soon as the tier opens; cinder revenants later.
    id: "ember-ravager-line",
    race: "ember",
    weight: 1,
    phases: [
      {
        wants: [
          { unit: "emberAcolyte", count: 2, priority: 65 },
          { bases: 2, priority: 60 },
          { unit: "emberRavager", count: 8, priority: 58 },
          { unit: "ashHexer", count: 2, priority: 56 },
        ],
        advanceShare: 0.75,
        advanceSupply: 42,
      },
      {
        wants: [
          { bases: 2, priority: 66 },
          { unit: "ashChieftain", count: 6, priority: 61 },
          { unit: "emberRavager", count: 10, priority: 58 },
          { unit: "emberAcolyte", count: 3, priority: 56 },
          { unit: "ashHexer", count: 3, priority: 55 },
          { building: "emberForge", count: 2, priority: 52 },
          { upgrade: "reinforcedPlating", level: 1, priority: 51 },
          { bases: 3, priority: 45 },
        ],
        advanceShare: 0.75,
        advanceSupply: 70,
      },
      {
        wants: [
          { unit: "emberRavager", count: 16, priority: 55 },
          { unit: "ashChieftain", count: 10, priority: 57 },
          { unit: "cinderRevenant", count: 6, priority: 54 },
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
