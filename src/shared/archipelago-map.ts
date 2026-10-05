import { createBuilding, createUnit } from "./map";
import { detCos, detSin } from "./det-math";
import type { GeneratedMap } from "./generated-map";
import type { GeneratedLayoutOptions, PlayerId } from "./types";
/** A terrain generator only. Naval policy reads connectivity and resources, never this layout's identity. */
export function archipelagoMap(options: GeneratedLayoutOptions, players: PlayerId[]): GeneratedMap {
    const size = options.size ?? 6144;
    const cell = 32, cols = Math.ceil(size / cell);
    let seed = 2166136261;
    for (const c of options.seed)
        seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
    const rotation = (seed % 1000) / 1000 * Math.PI * 2;
    const center = { x: size / 2, y: size / 2 };
    const point = (angle: number, reach: number) => ({ x: center.x + detCos(angle) * reach, y: center.y + detSin(angle) * reach });
    const homes = players.map((owner, index) => ({ owner, at: point(rotation + index * Math.PI * 2 / players.length, size * .345), radius: size * .095 }));
    const mainland = { at: center, radius: size * .155 };
    const land = [mainland, ...homes];
    let cells = "";
    for (let row = 0; row < cols; row++)
        for (let col = 0; col < cols; col++) {
            const at = { x: col * cell + cell / 2, y: row * cell + cell / 2 };
            const gap = Math.min(...land.map(disk => Math.hypot(at.x - disk.at.x, at.y - disk.at.y) - disk.radius));
            cells += gap <= -64 ? "." : gap <= 48 ? "," : "~";
        }
    const result: GeneratedMap = { kind: "ring", idea: "islandStarts", size, starts: {}, buildings: [], units: [], resources: [], mercenaryCamps: [], items: [], landmarks: [], terrain: { cell, cols, rows: cols, cells, palette: "coastal" }, camps: [], sites: [], obstacles: [] };
    for (const { owner, at } of homes) {
        const mine = { x: at.x + 165, y: at.y };
        result.starts[owner] = { baseX: at.x, baseY: at.y, mineX: mine.x, mineY: mine.y };
        result.buildings.push(createBuilding(`building-${owner}-townhall`, owner, "townHall", at.x, at.y, true));
        for (let i = 0; i < 3; i++)
            result.units.push(createUnit(`unit-${owner}-worker-${i + 1}`, owner, "worker", at.x - 55 + i * 50, at.y + 90));
        result.resources.push({ id: `gold-${owner}-main`, kind: "goldMine", ...mine, amount: 6000 });
    }
    // Shoreward resources permit several independent bridgeheads; the mainland has no scripted owner or capture event.
    for (let index = 0; index < players.length * 2; index++) {
        const at = point(rotation + index * Math.PI / players.length, size * .095);
        result.resources.push({ id: `gold-mainland-${index}`, kind: "goldMine", ...at, amount: 9000 });
        result.units.push(createUnit(`guard-${index}`, "neutral", "ogreWarrior", at.x, at.y + 120));
        result.camps.push({ ...at, tier: "orange", habitat: "open" });
    }
    result.sites.push({ kind: "shop", ...center });
    return result;
}
