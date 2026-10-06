import { createGame } from "../src/shared/sim";
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "../src/ai/runtime";
import { CommandFrameRuntime } from "../src/shared/sim/command-frame-runtime";
import { seconds, SIM_TICKS_PER_SECOND } from "../src/shared/time";

// Run the product planner/admission/simulation together; inspect completed
// journeys rather than treating a high ship count as evidence of working AI.
const owners = ["ai-v5", "ai-v7", "ai-v8"];
const players = ["player", ...owners];
const game = createGame("brokenSea", { players, aiPlayers: owners,
  teams: Object.fromEntries(players.map(id => [id, id])),
  races: { player: "grove", "ai-v5": "grove", "ai-v7": "ember", "ai-v8": "grove" } });
const ai = createAiRuntime(owners, { versions: { "ai-v5": "v5", "ai-v7": "v7", "ai-v8": "v8" } });
const runtime = new CommandFrameRuntime({ game, roomId: "naval-behavior", rejectionLabel: "naval-behavior",
  aiPlanner: createPresetAiRuntimeFramePlanner(game, ai) });
const report = () => console.log(JSON.stringify({ seconds: game.tick / SIM_TICKS_PER_SECOND,
  owners: owners.map(owner => ({ owner, gold: game.players[owner].gold,
    halls: game.buildings.filter(b => b.owner === owner && b.kind === "townHall").map(b => ({ id: b.id, x: b.x, y: b.y, complete: b.complete })),
    navy: game.units.filter(u => u.owner === owner && u.sailing).map(u => ({ id: u.id, kind: u.kind,
      x: Math.round(u.x), y: Math.round(u.y), hp: u.hp, parts: u.shipParts,
      heading: u.sailing!.heading, route: u.sailing!.route, order: u.order,
      crew: game.units.filter(c => c.deck?.shipId === u.id).map(c => ({ id: c.id, kind: c.kind, order: c.order })),
      weapons: game.items.filter(i => i.shipId === u.id && i.mountId).map(i => i.kind) })),
    workers: game.units.filter(u => u.owner === owner && u.kind === "worker").map(u => ({ id: u.id,
      x: Math.round(u.x), y: Math.round(u.y), deck: u.deck, order: u.order })), naval: ai.memories[owner].naval })) }));
report();
for (let i = 0; i < seconds(Number(process.argv[2] ?? 900)) && !game.match.winner; i++) {
  runtime.tick();
  if (game.tick % seconds(30) === 0) report();
}
