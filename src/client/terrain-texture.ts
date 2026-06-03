import type { MapId } from "../shared/types";
import { RICH_SCORE_MAP_IDS } from "../shared/map";

export type TexturePoint = { x: number; y: number };
export type TextureStroke = {
  layer: "contour" | "hatch" | "silhouette";
  color: string;
  width: number;
  points: TexturePoint[];
};

type SceneRecipe = {
  contourSpacing: number;
  hatchSpacing: number;
  amplitude: number;
  drift: number;
  contourColor: string;
  hatchColor: string;
  silhouetteColor: string;
};

export type TerrainTextureRequest = {
  mapId: MapId;
  camera: TexturePoint;
  width: number;
  height: number;
};

const RECIPES: Partial<Record<MapId, SceneRecipe>> = {
  verdantCrossroads: {
    contourSpacing: 260,
    hatchSpacing: 520,
    amplitude: 22,
    drift: 0.8,
    contourColor: "rgba(72, 104, 61, 0.105)",
    hatchColor: "rgba(128, 109, 69, 0.12)",
    silhouetteColor: "rgba(75, 91, 67, 0.14)",
  },
  bareDuel: {
    contourSpacing: 340,
    hatchSpacing: 700,
    amplitude: 13,
    drift: 0.45,
    contourColor: "rgba(79, 93, 68, 0.075)",
    hatchColor: "rgba(135, 116, 78, 0.08)",
    silhouetteColor: "rgba(79, 93, 68, 0.1)",
  },
  combatArena: {
    contourSpacing: 180,
    hatchSpacing: 360,
    amplitude: 10,
    drift: 0.52,
    contourColor: "rgba(92, 76, 70, 0.078)",
    hatchColor: "rgba(132, 96, 82, 0.084)",
    silhouetteColor: "rgba(88, 70, 66, 0.104)",
  },
  openClaims: {
    contourSpacing: 300,
    hatchSpacing: 560,
    amplitude: 18,
    drift: 0.62,
    contourColor: "rgba(88, 104, 63, 0.09)",
    hatchColor: "rgba(156, 127, 54, 0.1)",
    silhouetteColor: "rgba(96, 100, 72, 0.12)",
  },
  campRush: {
    contourSpacing: 240,
    hatchSpacing: 460,
    amplitude: 20,
    drift: 1.05,
    contourColor: "rgba(86, 92, 67, 0.1)",
    hatchColor: "rgba(119, 78, 53, 0.11)",
    silhouetteColor: "rgba(96, 70, 50, 0.13)",
  },
  wildMarches: {
    contourSpacing: 220,
    hatchSpacing: 430,
    amplitude: 24,
    drift: 1.22,
    contourColor: "rgba(65, 96, 64, 0.105)",
    hatchColor: "rgba(92, 111, 77, 0.11)",
    silhouetteColor: "rgba(67, 86, 66, 0.14)",
  },
  stagHollow: {
    contourSpacing: 235,
    hatchSpacing: 455,
    amplitude: 26,
    drift: 1.14,
    contourColor: "rgba(68, 96, 62, 0.108)",
    hatchColor: "rgba(102, 114, 74, 0.11)",
    silhouetteColor: "rgba(69, 83, 63, 0.14)",
  },
  emberFen: {
    contourSpacing: 250,
    hatchSpacing: 470,
    amplitude: 18,
    drift: 1.28,
    contourColor: "rgba(82, 92, 67, 0.095)",
    hatchColor: "rgba(129, 92, 68, 0.105)",
    silhouetteColor: "rgba(92, 76, 58, 0.125)",
  },
  thornedDelta: {
    contourSpacing: 210,
    hatchSpacing: 410,
    amplitude: 21,
    drift: 1.34,
    contourColor: "rgba(58, 99, 78, 0.102)",
    hatchColor: "rgba(92, 118, 87, 0.11)",
    silhouetteColor: "rgba(62, 88, 75, 0.14)",
  },
  silverRidge: {
    contourSpacing: 280,
    hatchSpacing: 520,
    amplitude: 28,
    drift: 0.82,
    contourColor: "rgba(76, 88, 82, 0.095)",
    hatchColor: "rgba(116, 120, 104, 0.105)",
    silhouetteColor: "rgba(78, 86, 82, 0.13)",
  },
  ashVale: {
    contourSpacing: 230,
    hatchSpacing: 440,
    amplitude: 20,
    drift: 1.18,
    contourColor: "rgba(83, 91, 72, 0.1)",
    hatchColor: "rgba(126, 95, 74, 0.105)",
    silhouetteColor: "rgba(88, 78, 66, 0.13)",
  },
  reedBasin: {
    contourSpacing: 245,
    hatchSpacing: 460,
    amplitude: 23,
    drift: 1.3,
    contourColor: "rgba(63, 101, 82, 0.098)",
    hatchColor: "rgba(83, 118, 93, 0.108)",
    silhouetteColor: "rgba(62, 91, 78, 0.135)",
  },
  frostMeadow: {
    contourSpacing: 275,
    hatchSpacing: 535,
    amplitude: 17,
    drift: 0.92,
    contourColor: "rgba(73, 93, 88, 0.09)",
    hatchColor: "rgba(116, 124, 109, 0.1)",
    silhouetteColor: "rgba(78, 92, 88, 0.12)",
  },
  sunkenOrchard: {
    contourSpacing: 225,
    hatchSpacing: 425,
    amplitude: 25,
    drift: 1.08,
    contourColor: "rgba(75, 99, 62, 0.104)",
    hatchColor: "rgba(116, 106, 71, 0.108)",
    silhouetteColor: "rgba(75, 86, 63, 0.14)",
  },
  cedarPass: {
    contourSpacing: 215,
    hatchSpacing: 405,
    amplitude: 27,
    drift: 1.16,
    contourColor: "rgba(61, 93, 70, 0.104)",
    hatchColor: "rgba(101, 117, 80, 0.108)",
    silhouetteColor: "rgba(61, 84, 68, 0.14)",
  },
  moonlitCauseway: {
    contourSpacing: 265,
    hatchSpacing: 500,
    amplitude: 22,
    drift: 1.06,
    contourColor: "rgba(66, 92, 82, 0.096)",
    hatchColor: "rgba(104, 112, 94, 0.104)",
    silhouetteColor: "rgba(66, 82, 78, 0.128)",
  },
  briarToll: {
    contourSpacing: 218,
    hatchSpacing: 420,
    amplitude: 24,
    drift: 1.38,
    contourColor: "rgba(58, 98, 70, 0.104)",
    hatchColor: "rgba(94, 118, 75, 0.11)",
    silhouetteColor: "rgba(61, 86, 65, 0.14)",
  },
  amberReach: {
    contourSpacing: 252,
    hatchSpacing: 485,
    amplitude: 19,
    drift: 1.1,
    contourColor: "rgba(86, 96, 63, 0.096)",
    hatchColor: "rgba(137, 114, 66, 0.106)",
    silhouetteColor: "rgba(89, 83, 61, 0.13)",
  },
  lichenCrown: {
    contourSpacing: 232,
    hatchSpacing: 445,
    amplitude: 26,
    drift: 1.18,
    contourColor: "rgba(63, 101, 70, 0.106)",
    hatchColor: "rgba(98, 119, 82, 0.11)",
    silhouetteColor: "rgba(64, 88, 68, 0.14)",
  },
  obsidianBrook: {
    contourSpacing: 272,
    hatchSpacing: 510,
    amplitude: 16,
    drift: 0.98,
    contourColor: "rgba(71, 87, 83, 0.09)",
    hatchColor: "rgba(103, 111, 103, 0.1)",
    silhouetteColor: "rgba(70, 80, 80, 0.124)",
  },
  willowCircuit: {
    contourSpacing: 224,
    hatchSpacing: 430,
    amplitude: 23,
    drift: 1.24,
    contourColor: "rgba(59, 100, 76, 0.104)",
    hatchColor: "rgba(85, 120, 88, 0.109)",
    silhouetteColor: "rgba(59, 88, 74, 0.138)",
  },
  quarrySong: {
    contourSpacing: 286,
    hatchSpacing: 540,
    amplitude: 29,
    drift: 0.86,
    contourColor: "rgba(80, 88, 78, 0.094)",
    hatchColor: "rgba(118, 112, 94, 0.104)",
    silhouetteColor: "rgba(78, 82, 76, 0.13)",
  },
  mistHarbor: {
    contourSpacing: 238,
    hatchSpacing: 455,
    amplitude: 20,
    drift: 1.32,
    contourColor: "rgba(64, 94, 88, 0.098)",
    hatchColor: "rgba(91, 113, 103, 0.106)",
    silhouetteColor: "rgba(64, 84, 82, 0.132)",
  },
  sableRun: {
    contourSpacing: 228,
    hatchSpacing: 438,
    amplitude: 25,
    drift: 1.26,
    contourColor: "rgba(70, 94, 68, 0.102)",
    hatchColor: "rgba(111, 107, 78, 0.108)",
    silhouetteColor: "rgba(72, 84, 66, 0.136)",
  },
  fernBarrow: {
    contourSpacing: 242,
    hatchSpacing: 452,
    amplitude: 27,
    drift: 1.12,
    contourColor: "rgba(61, 100, 74, 0.106)",
    hatchColor: "rgba(91, 119, 84, 0.11)",
    silhouetteColor: "rgba(62, 88, 72, 0.14)",
  },
  glassmereFord: {
    contourSpacing: 276,
    hatchSpacing: 520,
    amplitude: 18,
    drift: 0.96,
    contourColor: "rgba(69, 94, 91, 0.094)",
    hatchColor: "rgba(98, 118, 109, 0.102)",
    silhouetteColor: "rgba(68, 86, 84, 0.128)",
  },
  cinderHeath: {
    contourSpacing: 248,
    hatchSpacing: 472,
    amplitude: 21,
    drift: 1.2,
    contourColor: "rgba(87, 91, 67, 0.096)",
    hatchColor: "rgba(130, 100, 74, 0.106)",
    silhouetteColor: "rgba(89, 78, 63, 0.13)",
  },
  runeMeadow: {
    contourSpacing: 222,
    hatchSpacing: 418,
    amplitude: 24,
    drift: 1.04,
    contourColor: "rgba(63, 99, 78, 0.103)",
    hatchColor: "rgba(99, 116, 86, 0.108)",
    silhouetteColor: "rgba(64, 88, 75, 0.136)",
  },
  saltwindBasin: {
    contourSpacing: 258,
    hatchSpacing: 490,
    amplitude: 20,
    drift: 1.34,
    contourColor: "rgba(66, 93, 86, 0.097)",
    hatchColor: "rgba(105, 116, 96, 0.104)",
    silhouetteColor: "rgba(66, 84, 80, 0.13)",
  },
  verdigrisSpire: {
    contourSpacing: 246,
    hatchSpacing: 462,
    amplitude: 26,
    drift: 1.18,
    contourColor: "rgba(62, 99, 76, 0.104)",
    hatchColor: "rgba(94, 118, 86, 0.108)",
    silhouetteColor: "rgba(62, 86, 73, 0.138)",
  },
  pineTangle: {
    contourSpacing: 218,
    hatchSpacing: 408,
    amplitude: 25,
    drift: 1.4,
    contourColor: "rgba(59, 99, 68, 0.106)",
    hatchColor: "rgba(89, 119, 74, 0.11)",
    silhouetteColor: "rgba(60, 86, 65, 0.14)",
  },
  pearlBog: {
    contourSpacing: 264,
    hatchSpacing: 506,
    amplitude: 19,
    drift: 1.26,
    contourColor: "rgba(65, 96, 88, 0.098)",
    hatchColor: "rgba(100, 117, 105, 0.104)",
    silhouetteColor: "rgba(65, 84, 82, 0.13)",
  },
  ironMoss: {
    contourSpacing: 284,
    hatchSpacing: 534,
    amplitude: 28,
    drift: 0.9,
    contourColor: "rgba(76, 91, 76, 0.096)",
    hatchColor: "rgba(116, 116, 91, 0.104)",
    silhouetteColor: "rgba(76, 84, 73, 0.13)",
  },
  duskGrove: {
    contourSpacing: 226,
    hatchSpacing: 422,
    amplitude: 24,
    drift: 1.3,
    contourColor: "rgba(64, 98, 68, 0.104)",
    hatchColor: "rgba(101, 113, 77, 0.108)",
    silhouetteColor: "rgba(65, 86, 66, 0.138)",
  },
  hollowFord: {
    contourSpacing: 270,
    hatchSpacing: 512,
    amplitude: 18,
    drift: 1.02,
    contourColor: "rgba(68, 94, 90, 0.096)",
    hatchColor: "rgba(96, 118, 108, 0.102)",
    silhouetteColor: "rgba(67, 86, 84, 0.128)",
  },
  copperWeald: {
    contourSpacing: 252,
    hatchSpacing: 480,
    amplitude: 22,
    drift: 1.12,
    contourColor: "rgba(83, 95, 67, 0.098)",
    hatchColor: "rgba(131, 108, 72, 0.106)",
    silhouetteColor: "rgba(84, 80, 63, 0.13)",
  },
  opalFen: {
    contourSpacing: 236,
    hatchSpacing: 448,
    amplitude: 21,
    drift: 1.36,
    contourColor: "rgba(63, 96, 84, 0.1)",
    hatchColor: "rgba(92, 116, 98, 0.106)",
    silhouetteColor: "rgba(63, 86, 80, 0.132)",
  },
  grandThirty: {
    contourSpacing: 380,
    hatchSpacing: 760,
    amplitude: 30,
    drift: 0.95,
    contourColor: "rgba(65, 96, 64, 0.075)",
    hatchColor: "rgba(128, 109, 69, 0.085)",
    silhouetteColor: "rgba(67, 86, 66, 0.1)",
  },
};

export function generateTerrainLinework(request: TerrainTextureRequest): TextureStroke[] {
  const recipe = sceneRecipeFor(request.mapId);
  const margin = 160;
  const left = request.camera.x - margin;
  const top = request.camera.y - margin;
  const right = request.camera.x + request.width + margin;
  const bottom = request.camera.y + request.height + margin;
  const strokes: TextureStroke[] = [];

  for (let y = Math.floor(top / recipe.contourSpacing) * recipe.contourSpacing; y <= bottom; y += recipe.contourSpacing) {
    const seed = hash(`${request.mapId}:contour:${Math.round(y / recipe.contourSpacing)}`);
    if (seed % 5 === 0) continue;
    const points: TexturePoint[] = [];
    for (let x = Math.floor(left / 120) * 120; x <= right; x += 120) {
      const wave = Math.sin(x * 0.005 + seed * 0.00013) + Math.sin(x * 0.011 + seed * 0.00031) * recipe.drift;
      points.push({ x: x - request.camera.x, y: y + wave * recipe.amplitude - request.camera.y });
    }
    strokes.push({ layer: "contour", color: recipe.contourColor, width: 1, points });
  }

  const hatchColumns = Math.ceil((right - left) / recipe.hatchSpacing);
  const hatchRows = Math.ceil((bottom - top) / recipe.hatchSpacing);
  for (let column = 0; column <= hatchColumns; column += 1) {
    for (let row = 0; row <= hatchRows; row += 1) {
      const worldX = Math.floor(left / recipe.hatchSpacing) * recipe.hatchSpacing + column * recipe.hatchSpacing;
      const worldY = Math.floor(top / recipe.hatchSpacing) * recipe.hatchSpacing + row * recipe.hatchSpacing;
      const seed = hash(`${request.mapId}:hatch:${Math.round(worldX / 32)}:${Math.round(worldY / 32)}`);
      if (seed % 3 !== 0) continue;
      const length = 36 + (seed % 37);
      const angle = ((seed % 70) - 35) * (Math.PI / 180);
      const cx = worldX + ((seed >>> 8) % 180) - request.camera.x;
      const cy = worldY + ((seed >>> 16) % 160) - request.camera.y;
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length * 0.45;
      strokes.push({
        layer: "hatch",
        color: recipe.hatchColor,
        width: 1,
        points: [
          { x: cx - dx / 2, y: cy - dy / 2 },
          { x: cx + dx / 2, y: cy + dy / 2 },
        ],
      });
    }
  }

  for (const anchor of sceneAnchors(request.mapId)) {
    if (anchor.x < left || anchor.x > right || anchor.y < top || anchor.y > bottom) continue;
    const x = anchor.x - request.camera.x;
    const y = anchor.y - request.camera.y;
    const width = anchor.size;
    strokes.push({
      layer: "silhouette",
      color: recipe.silhouetteColor,
      width: 1.4,
      points: [
        { x: x - width * 0.5, y: y + width * 0.15 },
        { x: x - width * 0.22, y: y - width * 0.16 },
        { x: x + width * 0.08, y: y - width * 0.04 },
        { x: x + width * 0.34, y: y - width * 0.22 },
        { x: x + width * 0.5, y: y + width * 0.12 },
      ],
    });
  }

  return strokes;
}

function sceneRecipeFor(mapId: MapId) {
  const explicit = RECIPES[mapId];
  if (explicit) return explicit;
  if (!isRichScoreMap(mapId)) throw new Error(`Missing terrain texture recipe for ${mapId}`);
  return richGeneratedRecipe(mapId);
}

function richGeneratedRecipe(mapId: MapId): SceneRecipe {
  const seed = hash(`terrain:${mapId}`);
  const palettes = [
    ["rgba(63, 98, 74, 0.104)", "rgba(94, 118, 83, 0.108)", "rgba(63, 86, 72, 0.138)"],
    ["rgba(75, 91, 82, 0.096)", "rgba(111, 116, 101, 0.104)", "rgba(76, 84, 80, 0.13)"],
    ["rgba(85, 94, 66, 0.098)", "rgba(132, 110, 73, 0.106)", "rgba(86, 80, 62, 0.13)"],
    ["rgba(64, 96, 88, 0.098)", "rgba(98, 117, 106, 0.104)", "rgba(64, 84, 82, 0.13)"],
  ] as const;
  const palette = palettes[seed % palettes.length]!;
  return {
    contourSpacing: 218 + (seed % 68),
    hatchSpacing: 408 + ((seed >>> 5) % 132),
    amplitude: 18 + ((seed >>> 11) % 12),
    drift: 0.92 + ((seed >>> 17) % 52) / 100,
    contourColor: palette[0],
    hatchColor: palette[1],
    silhouetteColor: palette[2],
  };
}

export function estimateTextureInkCoverage(strokes: TextureStroke[], width: number, height: number) {
  const inkLength = strokes.reduce((total, stroke) => total + strokeLength(stroke) * stroke.width, 0);
  return inkLength / (width * height);
}

function sceneAnchors(mapId: MapId) {
  const common = [
    { x: 520, y: 520, size: 130 },
    { x: 940, y: 1440, size: 130 },
    { x: 2140, y: 2460, size: 180 },
    { x: 3380, y: 3160, size: 150 },
    { x: 3140, y: 3520, size: 210 },
  ];
  if (mapId === "bareDuel") return common.slice(0, 2);
  if (mapId === "openClaims") return [...common, { x: 2050, y: 700, size: 190 }];
  if (mapId === "campRush") return [...common.slice(1), { x: 1960, y: 780, size: 170 }];
  if (mapId === "wildMarches") return [...common, { x: 860, y: 2520, size: 190 }, { x: 3140, y: 1260, size: 170 }];
  if (mapId === "stagHollow") return [...common, { x: 1510, y: 1420, size: 210 }, { x: 2630, y: 2760, size: 180 }];
  if (mapId === "emberFen") return [...common, { x: 1590, y: 990, size: 190 }, { x: 2570, y: 2810, size: 180 }];
  if (mapId === "thornedDelta") return [...common, { x: 1040, y: 1870, size: 210 }, { x: 2990, y: 2260, size: 190 }];
  if (mapId === "silverRidge") return [...common, { x: 1270, y: 790, size: 220 }, { x: 2800, y: 3250, size: 210 }];
  if (mapId === "ashVale") return [...common, { x: 2090, y: 1070, size: 200 }, { x: 2730, y: 2740, size: 170 }];
  if (mapId === "reedBasin") return [...common, { x: 1200, y: 880, size: 200 }, { x: 2840, y: 2580, size: 180 }];
  if (mapId === "frostMeadow") return [...common, { x: 1610, y: 1020, size: 210 }, { x: 2740, y: 1630, size: 190 }];
  if (mapId === "sunkenOrchard") return [...common, { x: 1040, y: 1630, size: 210 }, { x: 2970, y: 2370, size: 190 }];
  if (mapId === "cedarPass") return [...common, { x: 1390, y: 1440, size: 210 }, { x: 2760, y: 2180, size: 200 }];
  if (mapId === "moonlitCauseway") return [...common, { x: 2050, y: 2010, size: 230 }, { x: 2740, y: 2690, size: 190 }];
  if (mapId === "briarToll") return [...common, { x: 940, y: 2100, size: 205 }, { x: 3080, y: 1550, size: 205 }];
  if (mapId === "amberReach") return [...common, { x: 2470, y: 1180, size: 210 }, { x: 1510, y: 2840, size: 185 }];
  if (mapId === "lichenCrown") return [...common, { x: 2040, y: 940, size: 205 }, { x: 2040, y: 3050, size: 205 }];
  if (mapId === "obsidianBrook") return [...common, { x: 2130, y: 1860, size: 230 }, { x: 2860, y: 2780, size: 195 }];
  if (mapId === "willowCircuit") return [...common, { x: 1210, y: 1990, size: 200 }, { x: 2870, y: 1990, size: 200 }];
  if (mapId === "quarrySong") return [...common, { x: 1260, y: 2510, size: 220 }, { x: 2800, y: 1370, size: 220 }];
  if (mapId === "mistHarbor") return [...common, { x: 1530, y: 1140, size: 190 }, { x: 2660, y: 2860, size: 210 }];
  if (mapId === "sableRun") return [...common, { x: 1230, y: 1860, size: 215 }, { x: 2960, y: 2330, size: 205 }];
  if (mapId === "fernBarrow") return [...common, { x: 2070, y: 1960, size: 225 }, { x: 1340, y: 2730, size: 195 }];
  if (mapId === "glassmereFord") return [...common, { x: 2020, y: 1760, size: 230 }, { x: 2610, y: 2560, size: 200 }];
  if (mapId === "cinderHeath") return [...common, { x: 2530, y: 990, size: 210 }, { x: 1470, y: 2950, size: 200 }];
  if (mapId === "runeMeadow") return [...common, { x: 1650, y: 1470, size: 205 }, { x: 2480, y: 2550, size: 205 }];
  if (mapId === "saltwindBasin") return [...common, { x: 1550, y: 1180, size: 210 }, { x: 2750, y: 2800, size: 205 }];
  if (mapId === "verdigrisSpire") return [...common, { x: 2080, y: 1070, size: 215 }, { x: 2090, y: 2310, size: 210 }];
  if (mapId === "pineTangle") return [...common, { x: 1110, y: 1630, size: 220 }, { x: 3040, y: 2190, size: 205 }];
  if (mapId === "pearlBog") return [...common, { x: 1430, y: 930, size: 205 }, { x: 2640, y: 2920, size: 210 }];
  if (mapId === "ironMoss") return [...common, { x: 1570, y: 1040, size: 220 }, { x: 2700, y: 2990, size: 220 }];
  if (mapId === "duskGrove") return [...common, { x: 940, y: 1970, size: 215 }, { x: 3060, y: 1400, size: 205 }];
  if (mapId === "hollowFord") return [...common, { x: 2000, y: 1660, size: 230 }, { x: 2760, y: 2510, size: 200 }];
  if (mapId === "copperWeald") return [...common, { x: 2520, y: 1220, size: 210 }, { x: 1470, y: 2800, size: 205 }];
  if (mapId === "opalFen") return [...common, { x: 1530, y: 1230, size: 210 }, { x: 2750, y: 2750, size: 205 }];
  if (isRichScoreMap(mapId)) return [...common, ...richGeneratedAnchors(mapId)];
  return common;
}

function richGeneratedAnchors(mapId: MapId) {
  const seed = hash(`anchor:${mapId}`);
  return [
    { x: 920 + (seed % 860), y: 840 + ((seed >>> 7) % 920), size: 175 + (seed % 55) },
    { x: 2360 + ((seed >>> 11) % 980), y: 2060 + ((seed >>> 17) % 980), size: 175 + ((seed >>> 5) % 65) },
  ];
}

function isRichScoreMap(mapId: MapId) {
  return (RICH_SCORE_MAP_IDS as readonly string[]).includes(mapId);
}

function strokeLength(stroke: TextureStroke) {
  let length = 0;
  for (let i = 1; i < stroke.points.length; i += 1) {
    const previous = stroke.points[i - 1]!;
    const point = stroke.points[i]!;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return length;
}

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
