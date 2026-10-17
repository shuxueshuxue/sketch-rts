// Collision probe over every pool map: structures that overlap at generation, ground units may stand on, and
// building placements the rules accept on top of a shop / mercenary camp / gold mine.
import { buildingPlacementBlocker, terrainBlocksPlacement } from "../repo/src/shared/build-placement";
import { MAP_POOL } from "../repo/src/shared/map-pool";
import { GOLD_MINE_RULES } from "../repo/src/shared/mining";
import { createRoom, roomToGameSetup } from "../repo/src/shared/rooms";
import { createGame, issueCommand, stepGame } from "../repo/src/shared/sim";
import { isOpenGround, snapToFootprint } from "../repo/src/shared/terrain";
import { createUnit } from "../repo/src/shared/map";

const out: Record<string, unknown>[] = [];
for (const spec of MAP_POOL) {
  const { options } = roomToGameSetup(createRoom({ id: `p-${spec.id}`, host: { id: "host", name: "Host" }, mapId: spec.id, humanCount: 1, aiCount: spec.players - 1 }));
  const game = createGame(spec.id, { ...options, aiPlayers: [] });
  stepGame(game, 1);
  const things = [
    ...game.resources.map(r => ({ tag: "mine", id: r.id, x: r.x, y: r.y, r: GOLD_MINE_RULES.radius })),
    ...(game.shops ?? []).map(s => ({ tag: "shop", id: s.id, x: s.x, y: s.y, r: s.radius })),
    ...(game.mercenaryCamps ?? []).map(c => ({ tag: "camp", id: c.id, x: c.x, y: c.y, r: c.radius })),
  ];
  const solids = [...game.buildings.map(b => ({ tag: "bld:" + b.kind, id: b.id, x: b.x, y: b.y, r: b.radius })), ...(game.obstacles ?? []).map(o => ({ tag: "obstacle", id: o.id, x: o.x, y: o.y, r: o.radius }))];
  const overlaps: string[] = [];
  const all = [...things, ...solids];
  for (let i = 0; i < things.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = things[i]!, b = all[j]!;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < a.r + b.r) overlaps.push(`${a.tag}:${a.id}~${b.tag}:${b.id} d=${Math.round(d)} r=${a.r}+${b.r}`);
  }
  const walkable = (t: { x: number; y: number }) => isOpenGround(game.map, t.x, t.y);
  const standOn = things.filter(walkable).map(t => t.tag);
  const buildOn: string[] = [];
  for (const t of things.filter(t => t.tag !== "mine")) {
    for (const kind of ["farm", "barracks", "watchTower", "groveHall", "emberForge"] as const) {
      try {
        const at = snapToFootprint(game.map, 40, t);
        if (!buildingPlacementBlocker(game, kind as never, t) && !terrainBlocksPlacement(game.map, kind as never, t)) { buildOn.push(`${kind}@${t.tag}:${t.id}`); break; }
      } catch {}
    }
  }
  // Walk a worker straight through each shop / camp / mine and record the closest it came to the centre.
  const walks: string[] = [];
  for (const t of things.slice(0, 40)) {
    const g = createGame(spec.id, { ...options, aiPlayers: [] });
    stepGame(g, 1);
    const off = t.r + 40;
    const from = [{ x: t.x - off, y: t.y }, { x: t.x, y: t.y - off }].find(walkable);
    const to = from && { x: 2 * t.x - from.x, y: 2 * t.y - from.y };
    if (!from || !to || !walkable(to)) continue;
    const u = createUnit(`probe-${t.id}`, "player", "worker", from.x, from.y);
    g.units.push(u);
    issueCommand(g, { type: "move", unitIds: [u.id], x: to.x, y: to.y });
    let closest = Infinity;
    for (let k = 0; k < 200; k++) { stepGame(g, 1); closest = Math.min(closest, Math.hypot(u.x - t.x, u.y - t.y)); }
    if (closest < t.r) walks.push(`${t.tag}:${t.id} closest=${Math.round(closest)} r=${t.r}`);
  }
  out.push({ map: spec.id, counts: { mines: game.resources.length, shops: game.shops?.length ?? 0, camps: game.mercenaryCamps?.length ?? 0 }, overlaps, standOnCenter: standOn.length + "/" + things.length, buildOn, walkedThrough: walks.length + ": " + walks.slice(0, 4).join(" | ") });
}
console.log(JSON.stringify(out, null, 1));
