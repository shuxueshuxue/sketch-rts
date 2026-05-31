import type { MapId } from "../shared/types";

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

const RECIPES: Record<MapId, SceneRecipe> = {
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
  const recipe = RECIPES[request.mapId];
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
  return common;
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
