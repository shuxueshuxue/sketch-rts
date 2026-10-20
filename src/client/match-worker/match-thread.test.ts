import { describe, expect, it, vi } from "vitest";
import { createAiRuntime } from "../../ai/runtime";
import { createGame, snapshotGame } from "../../shared/sim";
import { RULES_VERSION } from "../../shared/rules-version";
import type { GameSetupOptions } from "../../shared/types";
import { LocalGameAdapter } from "../net/local-adapter";
import { MatchThreadGameAdapter, type MatchThreadPort } from "./adapter";
import { createMatchThreadHost } from "./host";
import type { MatchThreadEvent, MatchThreadInit } from "./protocol";

// A thread of its own in all but the thread: every message is copied as postMessage copies it.
function copiedThread(): MatchThreadPort {
  const port: MatchThreadPort = {
    onmessage: null,
    postMessage: (message) => host.handle(structuredClone(message)),
  };
  const host = createMatchThreadHost((event: MatchThreadEvent) => port.onmessage?.({ data: structuredClone(event) }));
  return port;
}

const options: GameSetupOptions = { aiPlayers: ["enemy"], races: { player: "grove", enemy: "ember" } };

function startThreaded(now: () => number, extra: Partial<ConstructorParameters<typeof MatchThreadGameAdapter>[3]> = {}) {
  const init: MatchThreadInit = { type: "local", playerId: "player", mapId: "bareDuel", options, aiPlayers: ["enemy"], tickMs: 50, now: now() };
  return new MatchThreadGameAdapter(copiedThread(), init, snapshotGame(createGame("bareDuel", options)), { playerId: "player", checkCommands: true, now, ...extra });
}

describe("match thread", () => {
  it("draws the same match as one simulated on the page, command for command", () => {
    let now = 0;
    const page = new LocalGameAdapter(createGame("bareDuel", options), "player", { now: () => now, tickMs: 50, aiRuntime: createAiRuntime(["enemy"]) });
    const threaded = startThreaded(() => now);
    expect(threaded.currentSnapshot()).toEqual(page.currentSnapshot());
    const initialTerrain = threaded.currentSnapshot().map.terrain, initialLandmarks = threaded.currentSnapshot().map.landmarks;
    const worker = page.currentSnapshot().units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;

    for (let tick = 1; tick <= 400; tick += 1) {
      if (tick === 20) for (const adapter of [page, threaded]) adapter.sendCommand({ type: "move", unitIds: [worker.id], x: worker.x + 120, y: worker.y });
      now += 50;
      page.updateToRenderTime();
      threaded.updateToRenderTime();
      if (tick % 100 === 0) expect(threaded.currentSnapshot()).toEqual(page.currentSnapshot());
    }
    expect(threaded.currentSnapshot().tick).toBe(400);
    // The page keeps one ground object for the whole match: its drawing caches are keyed by it.
    expect(threaded.currentSnapshot().map.terrain).toBe(initialTerrain);
    expect(threaded.currentSnapshot().map.landmarks).toBe(initialLandmarks);
    expect(threaded.currentSnapshot().units.find((unit) => unit.id === worker.id)!.x).toBeGreaterThan(worker.x + 60);
  });

  it("runs the ticks a slow frame made due before the next frame, one budget slice after another", async () => {
    // Each update's time budget runs out after a single tick.
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (elapsed += 10));
    try {
      const events: MatchThreadEvent[] = [];
      const host = createMatchThreadHost((event) => events.push(event));
      const ticks = () => events.flatMap((event) => (event.type === "snapshot" ? [event.snapshot.tick] : []));
      host.handle({ type: "local", playerId: "player", mapId: "bareDuel", options, aiPlayers: ["enemy"], tickMs: 50, now: 0 });
      // A frame 150 ms after the last: three ticks are due, and its own update has budget for one.
      host.handle({ type: "advance", now: 150 });
      expect(ticks()).toEqual([1]);
      for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      // The other two ran without another frame; the page heard once more, when the run ended.
      expect(ticks()).toEqual([1, 3]);
      // Nothing more is due until the page's clock moves on: a page that sends no frames still pauses the match.
      for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ticks()).toEqual([1, 3]);
      host.handle({ type: "advance", now: 200 });
      expect(ticks()).toEqual([1, 3, 4]);
      host.handle({ type: "close" });
    } finally {
      vi.restoreAllMocks();
    }
  });

  // @@@restore-redraws: no frame follows a checkpoint in a paused room; the page still draws what it restored.
  it("hands the page a restored checkpoint on its next frame, with no tick after it", () => {
    const lockstepOptions: GameSetupOptions = { aiPlayers: [] };
    const page = new MatchThreadGameAdapter(copiedThread(), { type: "lockstep", roomId: "room-1", playerId: "player", mapId: "bareDuel", options: lockstepOptions },
      snapshotGame(createGame("bareDuel", lockstepOptions)), { playerId: "player", now: () => 0 });
    const restored = createGame("bareDuel", lockstepOptions);
    restored.tick = 40;
    restored.players.player.gold = 8744;

    page.forward({ type: "checkpoint", rulesVersion: RULES_VERSION, checkpoint: { roomId: "room-1", tick: 40, snapshot: snapshotGame(restored), nextId: restored.nextId }, epoch: 0 });
    page.updateToRenderTime();

    expect(page.currentSnapshot().tick).toBe(40);
    expect(page.currentSnapshot().players.player.gold).toBe(8744);
  });

  it("preserves a structured refusal across a worker admission race without adding effects", () => {
    const setup: GameSetupOptions = { aiPlayers: [], scenario: { players: { player: { gold: 0 } } } };
    const initial = snapshotGame(createGame("bareDuel", setup));
    const hall = initial.buildings.find(building => building.owner === "player" && building.kind === "townHall")!;
    // The page is one snapshot behind; only the worker knows the money was already spent.
    initial.players.player!.gold = 500;
    const onError = vi.fn();
    const adapter = new MatchThreadGameAdapter(copiedThread(), { type: "local", playerId: "player", mapId: "bareDuel", options: setup,
      aiPlayers: [], tickMs: 50, now: 0 }, initial, { playerId: "player", checkCommands: true, now: () => 0, onError });
    adapter.sendCommand({ type: "train", buildingId: hall.id, unitKind: "worker" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("gold"), { reason: "gold", detail: { required: 75, available: 0 } });
    expect(adapter.currentSnapshot().effects.some(effect => effect.refusal)).toBe(false);
    adapter.close();
  });

  it("refuses a command the latest snapshot refuses, as it is given", () => {
    const threaded = startThreaded(() => 0);
    const townHall = threaded.currentSnapshot().buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    expect(() => threaded.sendCommand({ type: "train", buildingId: townHall.id, unitKind: "footman" })).toThrow(/Local command rejected: townHall cannot train footman/);
  });

  it("hands the page the final world when the match ends, and stops once closed", () => {
    let now = 0;
    const defaults = createGame("bareDuel", { aiPlayers: [] });
    // Only the player's buildings: the enemy has nothing left, so the match ends on its first tick.
    const ending: GameSetupOptions = { aiPlayers: [], scenario: { replaceDefaultBuildings: true, addBuildings: defaults.buildings.filter((building) => building.owner === "player")
      .map((building) => ({ id: building.id, owner: building.owner as "player", kind: building.kind, x: building.x, y: building.y })) } };
    const onEnded = vi.fn(), onClose = vi.fn();
    const room = { id: "threaded-end", status: "inMatch" } as never;
    const threaded = new MatchThreadGameAdapter(copiedThread(), {
      type: "local", room, playerId: "player", mapId: "bareDuel", options: ending, aiPlayers: [], tickMs: 50, now: 0,
    }, snapshotGame(createGame("bareDuel", ending)), { playerId: "player", now: () => now, onEnded, onClose });
    now = 200;
    threaded.updateToRenderTime();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onEnded.mock.calls[0]![0].match.winner).toBe("player");
    threaded.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(threaded.updateToRenderTime()).toBe(false);
    expect(() => threaded.sendCommand({ type: "stop", unitIds: [] })).toThrow(/closed/);
  });
});
