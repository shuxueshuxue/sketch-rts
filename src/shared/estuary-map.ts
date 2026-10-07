import { createBuilding, createUnit } from "./map";
import { fractalNoise, seedHash } from "./environment/noise";
import { detSin, detCos } from "./det-math";
import { ecologicalDressing, prepareEcology } from "./map-dressing";
import type { GeneratedMap } from "./generated-map";
import type { GeneratedLayoutOptions, PlayerId } from "./types";
/** A large, mirrored river layout: three broad fords connect both banks while
 * the deep channel remains navigable. Roads guarantee access to each mine. */
export function estuaryMap(
  options: GeneratedLayoutOptions,
  players: PlayerId[],
): GeneratedMap {
  const size = options.size ?? 8192,
    cell = 32,
    cols = Math.ceil(size / cell),
    middle = size / 2;
  const quarter =
    [...options.seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 2 === 0;
  const project = (x: number, y: number) =>
    quarter ? { x: y, y: x } : { x, y };
  const homes = players.map((owner, index) => ({
    owner,
    side: index < players.length / 2 ? 1 : -1,
    x: index < players.length / 2 ? size * 0.155 : size * 0.845,
    y:
      size *
      (0.17 +
        ((index % (players.length / 2)) * 0.66) / (players.length / 2 - 1)),
  }));
  const fords = [size * 0.18, middle, size * 0.82];
  const anchors = homes.flatMap((home) => [
    project(home.x, home.y),
    project(home.x - home.side * 165, home.y),
    project(home.x + home.side * 760, home.y + 110),
    project(home.x + home.side * 1720, home.y - 100),
  ]);
  const routes = homes.flatMap((home) => {
    const y = fords.reduce(
      (best, y) => (Math.abs(y - home.y) < Math.abs(best - home.y) ? y : best),
      fords[0]!,
    );
    return [{ a: project(home.x, home.y), b: project(middle, y) }];
  });
  const nearRoad = (at: { x: number; y: number }) =>
    routes.some(({ a, b }) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        );
      return Math.hypot(at.x - a.x - dx * t, at.y - a.y - dy * t) < 120;
    });
  const seed = seedHash(options.seed);
  let cells = "";
  for (let row = 0; row < cols; row++)
    for (let col = 0; col < cols; col++) {
      const at = { x: (col + 0.5) * cell, y: (row + 0.5) * cell },
        p = quarter ? { x: at.y, y: at.x } : at;
      const river = middle + detSin((p.y / size) * Math.PI * 3) * 120,
        gap = Math.abs(p.x - river);
      const ford = fords.some((y) => Math.abs(p.y - y) < 100);
      const protectedGround =
        anchors.some(
          (point) => Math.hypot(at.x - point.x, at.y - point.y) < 380,
        ) ||
        nearRoad(at) ||
        Math.hypot(at.x - middle, at.y - middle) < 260;
      const patch = fractalNoise(seed, Math.abs(p.x - middle), p.y, 900, 50);
      cells +=
        gap < 135
          ? ford
            ? ","
            : "~"
          : gap < 220
            ? ","
            : protectedGround
              ? "."
              : patch > .65
                ? "T"
                : patch < .25
                  ? "#"
                  : gap < 370 && patch < .45
                    ? "m"
                    : ".";
    }
  const result: GeneratedMap = {
    kind: "sides",
    idea: "riverValley",
    size,
    starts: {},
    buildings: [],
    units: [],
    resources: [],
    mercenaryCamps: [],
    items: [],
    landmarks: [],
    terrain: { cell, cols, rows: cols, cells },
    camps: [],
    sites: [],
    obstacles: [],
  };
  homes.forEach((home, index) => {
    const at = project(home.x, home.y),
      mine = project(home.x - home.side * 165, home.y);
    result.starts[home.owner] = {
      baseX: at.x,
      baseY: at.y,
      mineX: mine.x,
      mineY: mine.y,
    };
    result.buildings.push(
      createBuilding(
        `building-${home.owner}-townhall`,
        home.owner,
        "townHall",
        at.x,
        at.y,
        true,
      ),
    );
    for (let i = 0; i < 3; i++)
      result.units.push(
        createUnit(
          `unit-${home.owner}-worker-${i + 1}`,
          home.owner,
          "worker",
          at.x - 55 + i * 50,
          at.y + 90,
        ),
      );
    result.resources.push({
      id: `gold-${home.owner}-main`,
      kind: "goldMine",
      ...mine,
      amount: 6000,
    });
    for (const [rank, offset, dy] of [
      [1, 760, 110],
      [2, 1720, -100],
    ]) {
      const at = project(home.x + home.side * offset!, home.y + dy!);
      result.resources.push({
        id: `gold-${home.owner}-${rank}`,
        kind: "goldMine",
        ...at,
        amount: rank === 1 ? 7500 : 9500,
      });
      result.units.push(
        createUnit(
          `guard-${index}-${rank}`,
          "neutral",
          rank === 1 ? "murlocPeon" : "ogreWarrior",
          at.x + 85,
          at.y + 90,
        ),
      );
      result.camps.push({
        ...at,
        tier: rank === 1 ? "green" : "orange",
        habitat: "open",
      });
    }
  });
  result.sites.push({ kind: "shop", x: middle, y: middle });
  prepareEcology(result.terrain, options.seed, project(middle, size));
  result.landmarks.push(
    ...ecologicalDressing(result.terrain, anchors, options.seed),
  );
  for (const mine of result.resources)
    result.landmarks.push({
      id: `scar-${mine.id}`,
      kind: "mineScar",
      x: mine.x,
      y: mine.y,
      size: 160,
      rotation: 0,
    });
  for (const y of fords)
    result.landmarks.push({
      id: `river-ruin-${y}`,
      kind: "ruin",
      ...project(middle - 250, y + 180),
      size: 150,
      rotation: 0,
    });
  return result;
}
