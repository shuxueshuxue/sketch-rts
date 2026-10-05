import { createGame, type Game } from "../../shared/sim";
import type { TerrainLandmark } from "../../shared/types";
import { box, circle } from "../../story/region";
import { EMBER, FOLK, PLAYER, WILD } from "./common";

// The map of the Ashen March: one sheet of the atlas, the fen in the south-west, the ash wood across the middle, the
// ridge to the north-east and the Old Grove in the north-west. The chapters travel across it.

export const PLACES = {
  // Prologue: the watchtower and the river road.
  fenwatch: { x: 1500, y: 10200 },
  stones: [
    { x: 2050, y: 9750 },
    { x: 2850, y: 10300 },
    { x: 3650, y: 9820 },
  ],
  wolfReeds: { x: 3150, y: 10600 },
  burnedCart: { x: 3760, y: 9900 },
  houndDen: { x: 4450, y: 9420 },
  // Chapter one: Reedholm and its ford.
  reedholm: { x: 4700, y: 8650 },
  reedholmWest: { x: 4000, y: 8900 },
  ford: { x: 5350, y: 8150 },
  tessHut: { x: 4050, y: 8150 },
  villageSquare: { x: 4750, y: 8550 },
  // Chapter two: the old outpost.
  outpost: { x: 3000, y: 7000 },
  outpostMine: { x: 2640, y: 6700 },
  woodEdge: { x: 4300, y: 6750 },
  // Chapter three: the ash wood and the Ember forward camp.
  emberCamp: { x: 6300, y: 6650 },
  refugeeHollow: { x: 5250, y: 5850 },
  // Chapter four: the ridge pass.
  passSouth: { x: 5200, y: 4750 },
  passMouth: { x: 5200, y: 4450 },
  passNorth: { x: 5200, y: 3350 },
  eastRidge: { x: 5750, y: 4150 },
  // Chapter five: the Old Grove.
  heartwood: { x: 2400, y: 2150 },
  groveEdge: { x: 3300, y: 2350 },
  colossusRoad: { x: 6200, y: 2500 },
} as const;

export const REGIONS = {
  ford: circle(PLACES.ford.x, PLACES.ford.y, 170),
  pass: box(4950, 3900, 5450, 4700),
  passThrough: box(4700, 2900, 5700, 3700),
  grove: circle(PLACES.heartwood.x, PLACES.heartwood.y, 900),
};

// The atlas's own marks: rivers as ditches, roads, groves of trees, ridges, ruins.
const LANDMARKS: TerrainLandmark[] = [
  // The Reed river, west to east across the fen, then north past Reedholm's ford.
  ...riverRun("reed-river", [
    [600, 9500],
    [1400, 9450],
    [2300, 9350],
    [3200, 9300],
    [4100, 9200],
    [4900, 8900],
    [5350, 8150],
    [5600, 7500],
    [5700, 6900],
  ]),
  { id: "river-road-1", kind: "road", x: 1900, y: 10050, size: 520, rotation: 0.05 },
  { id: "river-road-2", kind: "road", x: 2750, y: 10000, size: 560, rotation: -0.1 },
  { id: "river-road-3", kind: "road", x: 3500, y: 9900, size: 520, rotation: -0.2 },
  { id: "reedholm-road", kind: "road", x: 4300, y: 8800, size: 560, rotation: -0.6 },
  { id: "outpost-road", kind: "road", x: 3500, y: 7900, size: 900, rotation: -1.2 },
  { id: "fen-grove-1", kind: "grove", x: 1100, y: 10700, size: 380, rotation: 0.3 },
  { id: "fen-grove-2", kind: "grove", x: 2500, y: 10800, size: 300, rotation: 1.1 },
  { id: "fen-grove-3", kind: "grove", x: 3300, y: 8900, size: 260, rotation: 0.4 },
  { id: "fen-ruin", kind: "ruin", x: 900, y: 9900, size: 220, rotation: 0.2 },
  { id: "stone-1", kind: "bannerStone", x: 2050, y: 9700, size: 120, rotation: 0 },
  { id: "stone-2", kind: "bannerStone", x: 2850, y: 10250, size: 120, rotation: 0 },
  { id: "stone-3", kind: "bannerStone", x: 3650, y: 9770, size: 120, rotation: 0 },
  { id: "outpost-scar", kind: "mineScar", x: 2640, y: 6700, size: 200, rotation: 0.4 },
  { id: "outpost-grove", kind: "grove", x: 2300, y: 7400, size: 340, rotation: 0.9 },
  { id: "ash-wood-1", kind: "grove", x: 4700, y: 6300, size: 420, rotation: 0.2 },
  { id: "ash-wood-2", kind: "grove", x: 5500, y: 7200, size: 400, rotation: 1.3 },
  { id: "ash-wood-3", kind: "grove", x: 5700, y: 6000, size: 360, rotation: 0.7 },
  { id: "ash-wood-4", kind: "grove", x: 6900, y: 7300, size: 380, rotation: 0.1 },
  { id: "ember-camp-mark", kind: "campMark", x: 6300, y: 6650, size: 300, rotation: 0.3 },
  { id: "hollow-ruin", kind: "ruin", x: 5350, y: 5800, size: 200, rotation: 0.6 },
  { id: "ridge-west", kind: "ridge", x: 4760, y: 4250, size: 620, rotation: 1.5 },
  { id: "ridge-east", kind: "ridge", x: 5660, y: 4250, size: 620, rotation: 1.6 },
  { id: "ridge-west-2", kind: "ridge", x: 4500, y: 3700, size: 420, rotation: 1.2 },
  { id: "ridge-east-2", kind: "ridge", x: 5950, y: 3750, size: 420, rotation: 1.9 },
  { id: "pass-road", kind: "road", x: 5200, y: 4100, size: 1100, rotation: 1.57 },
  { id: "old-grove-1", kind: "grove", x: 1800, y: 1700, size: 520, rotation: 0.4 },
  { id: "old-grove-2", kind: "grove", x: 2900, y: 1500, size: 480, rotation: 1.0 },
  { id: "old-grove-3", kind: "grove", x: 1700, y: 2800, size: 460, rotation: 0.2 },
  { id: "old-grove-4", kind: "grove", x: 3000, y: 3000, size: 380, rotation: 1.4 },
  { id: "grove-road", kind: "road", x: 4300, y: 2450, size: 1500, rotation: 0.02 },
  { id: "ash-plain-ruin", kind: "ruin", x: 5600, y: 2300, size: 260, rotation: 0.3 },
];

function riverRun(id: string, points: [number, number][]): TerrainLandmark[] {
  const marks: TerrainLandmark[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1]!;
    const [x2, y2] = points[index]!;
    marks.push({ id: `${id}-${index}`, kind: "ditch", x: (x1 + x2) / 2, y: (y1 + y2) / 2, size: Math.hypot(x2 - x1, y2 - y1) + 120, rotation: Math.atan2(y2 - y1, x2 - x1) });
  }
  return marks;
}

// The world before the first chapter: the atlas sheet and the four sides of the story.
export function ashenWorld(): Game {
  const players = [PLAYER, FOLK, EMBER, WILD];
  const game = createGame("grandThirty", {
    players,
    aiPlayers: [],
    teams: { [PLAYER]: "grove", [FOLK]: "grove", [EMBER]: "ember", [WILD]: "wild" },
    races: { [PLAYER]: "grove", [FOLK]: "grove", [EMBER]: "ember", [WILD]: "grove" },
    scenario: {
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      replaceDefaultResources: true,
      replaceDefaultMercenaryCamps: true,
      replaceDefaultLandmarks: true,
      addLandmarks: LANDMARKS,
      players: { [PLAYER]: { gold: 0 }, [EMBER]: { gold: 0 }, [FOLK]: { gold: 0 }, [WILD]: { gold: 0 } },
    },
  });
  // The atlas's scattered treasure belongs to the ladder maps, not to this story.
  game.items = [];
  return game;
}
