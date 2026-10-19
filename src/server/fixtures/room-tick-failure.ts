import assert from "node:assert/strict";
import { createAiThinkClientExecutor } from "../../ai/think-worker/client";
import type { AiThinkReply } from "../../ai/think-worker/protocol";
import { RULES_VERSION } from "../../shared/rules-version";
import type { ServerNetMessage } from "../../shared/net/types";
import type { Game } from "../../shared/sim";
import { PLANNER_COMMAND_DELAY_TICKS } from "../../shared/sim/planner-schedule";
import { createRoomHost } from "../room-host";
import { RoomNetHub, type RoomNetSocket } from "../room-net";

// Runs in its own process: an uncaught timer exception must fail this regression, not Vitest's process.
const mode = process.argv[2];
const games: Game[] = [];
const closed: string[] = [];
const host = createRoomHost({
  aiThinkExecutor(runtime, game) {
    const session = games.length === 0 ? "broken" : "healthy";
    games.push(game);
    let replies: AiThinkReply[] = [];
    return createAiThinkClientExecutor(runtime, game, {
      send(message) {
        if (message.type !== "think") return;
        replies.push(session === "broken"
          ? { session, deliveryTick: message.deliveryTick, error: "Error: injected AI failure\n    at injectedPlanner (fixture:1:1)" }
          : { session, deliveryTick: message.deliveryTick, commands: [], thinkMs: 0 });
      },
      drain() { const result = replies; replies = []; return result; },
      close() { closed.push(session); },
    }, session);
  },
});
for (const id of ["broken", "healthy"]) {
  host.createRoom({ id, host: { id: "host", name: "Host" }, mapId: "bareDuel", humanCount: 1, aiCount: 1 });
  host.startRoom(id);
}
const hub = new RoomNetHub({ roomHost: host });
class Socket implements RoomNetSocket {
  messages: ServerNetMessage[] = [];
  receive: (raw: string) => void = () => {};
  send(raw: string) { this.messages.push(JSON.parse(raw) as ServerNetMessage); }
  on(event: "message" | "close", handler: ((raw: string) => void) | (() => void)) {
    if (event === "message") this.receive = handler;
  }
}
function join(id: string) {
  const socket = new Socket();
  hub.connect(id, socket);
  socket.receive(JSON.stringify({ type: "join", rulesVersion: RULES_VERSION, roomId: id, playerId: "player" }));
  return socket;
}
const socket = mode === "connected" ? join("broken") : undefined;
if (mode === "connected") join("healthy");
let turns = 0;
const timer = setInterval(() => {
  if (mode === "api") {
    // REST catches the request error, but the failed room still must be frozen and recorded.
    if (turns <= PLANNER_COMMAND_DELAY_TICKS) {
      try { host.tickRoom("broken", 1); }
      catch (error) { assert.match(String(error), /injected AI failure/); }
    }
    host.tickRoom("healthy", 1);
  } else {
    // The same two drivers as index.ts's automatic ticker, with no process-level exception handler.
    hub.tickConnectedRooms();
    host.tickActiveRooms(1, { excludeRoomIds: hub.transportOwnedRoomIds() });
  }
  if (++turns < 20) return;
  clearInterval(timer);
  assert.equal(host.getRoom("broken").status, "errored");
  assert.equal(host.getRoom("broken").error?.tick, PLANNER_COMMAND_DELAY_TICKS);
  assert.match(host.getRoom("broken").error?.message ?? "", /injectedPlanner/);
  assert.equal(games[0]!.tick, PLANNER_COMMAND_DELAY_TICKS);
  assert.equal(host.snapshot("broken").tick, PLANNER_COMMAND_DELAY_TICKS);
  assert.equal(host.currentTick("healthy"), turns);
  assert.deepEqual(closed, ["broken"]);
  assert.throws(() => host.resumeRoom("broken"), /reset/);
  assert.throws(() => host.tickRoom("broken", 1), /not in a live match/);
  assert.throws(() => host.admitCommands("broken", []), /not in a live match/);
  const messages = (socket ?? join("broken")).messages;
  assert(messages.some(message => message.type === "room" && message.room.status === "errored"));
  assert(messages.some(message => message.type === "error" && /stopped at tick.*injected AI failure/s.test(message.message)));
  const reset = host.resetRoom("broken", "bareDuel", { aiPlayers: [] });
  assert.equal(reset.room.error, undefined);
  host.tickRoom("broken", 1);
  assert.equal(host.currentTick("broken"), 1);
  console.log(JSON.stringify({ mode, failedTick: games[0]!.tick, healthyTick: host.currentTick("healthy"), resetTick: 1 }));
}, 1);
