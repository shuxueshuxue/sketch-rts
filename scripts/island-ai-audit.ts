import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createGame, snapshotGame, restoreSnapshotIntoGame } from "../src/shared/sim";
import { readFileSync } from 'node:fs';
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "../src/ai/runtime";
import { CommandFrameRuntime } from "../src/shared/sim/command-frame-runtime";
import { seconds, SIM_TICKS_PER_SECOND } from "../src/shared/time";
import { poolMap } from "../src/shared/map-pool";
import { distance } from "../src/ai/policy/spatial";
import type { AiScriptVersion } from "../src/ai/policy";

// The shipped map, planner, command admission and physics. No starting bonuses,
// teleports or forced victories; report actual mine occupation and ship losses.
const mapId = process.argv[2] ?? "sapphireArchipelago";
const duration = Number(process.argv[3] ?? 1800);
const out = process.argv[4] ?? ".art-build/island-audit.json";
const owners = Array.from({ length: poolMap(mapId)?.players ?? 4 }, (_, i) => `ai-${i}`);
const versions = Object.fromEntries(owners.map((id, i) => [id, ["v5", "v7", "v8"][i % 3] as AiScriptVersion]));
const game = createGame(mapId, { players: owners, aiPlayers: owners,
  teams: Object.fromEntries(owners.map(id => [id, id])),
  races: Object.fromEntries(owners.map((id, i) => [id, i % 2 ? "ember" : "grove"])) });
const ai = createAiRuntime(owners, { versions });
if(process.argv[5]){
  const checkpoint=JSON.parse(readFileSync(process.argv[5],'utf8')).checkpoint;
  restoreSnapshotIntoGame(game,checkpoint.snapshot,checkpoint.nextId);
  ai.memories=checkpoint.memories;ai.lastThink=checkpoint.lastThink;
}
const runtime = new CommandFrameRuntime({ game, roomId: "island-audit", rejectionLabel: "island-audit",
  aiPlanner: createPresetAiRuntimeFramePlanner(game, ai) });
const timeline: unknown[] = [], losses: unknown[] = [];
let ships = new Map(game.units.filter(u => u.sailing).map(u => [u.id, u]));
const record = () => timeline.push({ seconds: game.tick / SIM_TICKS_PER_SECOND,
  mines: game.resources.map(m => ({ id: m.id, x: m.x, y: m.y, gold: m.amount,
    halls: game.buildings.filter(b => b.kind === "townHall" && distance(b, m) < 320).map(b => ({ owner: b.owner, complete: b.complete })),
    guards: game.units.filter(u => u.owner === "neutral" && distance(u, m) < 450).map(u => ({ kind: u.kind, hp: u.hp })) })),
  owners: owners.map(owner => ({ owner, version: versions[owner], gold: game.players[owner].gold,
    population: [game.players[owner].supplyUsed,game.players[owner].supplyCap],
    army: Object.fromEntries([...new Set(game.units.filter(u=>u.owner===owner).map(u=>u.kind))].map(kind=>[kind,game.units.filter(u=>u.owner===owner&&u.kind===kind).length])),
    buildings: game.buildings.filter(b=>b.owner===owner).map(b=>({kind:b.kind,complete:b.complete,queue:b.queue})),
    halls: game.buildings.filter(b => b.owner === owner && b.kind === "townHall" && b.complete).length,
    workers: game.units.filter(u => u.owner === owner && u.kind === "worker" && !u.deck).length,
    navy: game.units.filter(u => u.owner === owner && u.sailing).map(u => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, hp: u.hp,
      order: u.order, guns: game.items.filter(i => i.shipId === u.id && i.mountId).map(i => i.kind) })),
    naval: ai.memories[owner].naval })) });
const started = performance.now();
record();
for (let i = 0; i < seconds(duration) && !game.match.winner; i++) {
  runtime.tick();
  const next = new Map(game.units.filter(u => u.sailing).map(u => [u.id, u]));
  for (const [id, ship] of ships) if (!next.has(id)) losses.push({ seconds: game.tick / SIM_TICKS_PER_SECOND,
    owner: ship.owner, kind: ship.kind, x: ship.x, y: ship.y,
    threats: [...game.units, ...game.buildings].filter(u => u.owner !== ship.owner && distance(u, ship) < 700)
      .map(u => ({ kind: u.kind, owner: u.owner, hp: u.hp })) });
  ships = next;
  if (game.tick % seconds(60) === 0) record();
}
record();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ mapId, duration, versions, cpuMs: performance.now() - started, timeline, losses,
  checkpoint:{snapshot:snapshotGame(game),nextId:game.nextId,memories:ai.memories,lastThink:ai.lastThink} }, null, 2));
console.log(JSON.stringify({ out, seconds: game.tick / SIM_TICKS_PER_SECOND, cpuMs: performance.now() - started, losses: losses.length }));
