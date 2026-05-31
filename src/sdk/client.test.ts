import { describe, expect, it } from "vitest";
import { SketchRtsSdk } from "./client";

describe("SketchRtsSdk", () => {
  it("dogfoods typed helpers for catalog, reset, snapshot, and command calls", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === "/api/catalog") {
        return json({ units: ["worker"], buildings: ["townHall"], races: [{ id: "grove", name: "Grove Kin", note: "Test race" }], maps: [{ id: "bareDuel", name: "Bare Duel", note: "Test", tags: ["4096"] }] });
      }
      if (url.pathname === "/api/tick") {
        return json({ ticks: 120, elapsedMs: 3, cpuMs: 1.2, memory: { rssBytes: 1000, heapUsedBytes: 500, heapDeltaBytes: 12 }, snapshot: makeSnapshot() });
      }
      if (url.pathname === "/api/reset" || url.pathname === "/api/snapshot" || url.pathname === "/api/command") {
        return json(makeSnapshot());
      }
      return new Response("missing", { status: 404 });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    const catalog = await sdk.catalog();
    const reset = await sdk.reset("bareDuel");
    const snapshot = await sdk.snapshot();
    const afterCommand = await sdk.command({ type: "startMap", mapId: "bareDuel" });
    const fastForward = await sdk.fastForward(120);

    expect(catalog.maps[0]?.id).toBe("bareDuel");
    expect(catalog.races[0]?.id).toBe("grove");
    expect(reset.map.id).toBe("bareDuel");
    expect(snapshot.players.player.supplyCap).toBe(10);
    expect(afterCommand.map.width).toBe(4096);
    expect(fastForward.ticks).toBe(120);
    expect(fastForward.elapsedMs).toBeLessThan(50);
    expect(fastForward.cpuMs).toBeLessThan(10);
    expect(fastForward.memory.heapDeltaBytes).toBe(12);
    expect(calls).toEqual([
      { path: "/api/catalog", method: "GET" },
      { path: "/api/reset", method: "POST", body: { mapId: "bareDuel" } },
      { path: "/api/snapshot", method: "GET" },
      { path: "/api/command", method: "POST", body: { type: "startMap", mapId: "bareDuel" } },
      { path: "/api/tick", method: "POST", body: { ticks: 120 } },
    ]);
  });

  it("sends typed reset setup options for race-aware external control", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json(makeSnapshot());
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await sdk.reset("bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });

    expect(calls).toEqual([
      {
        path: "/api/reset",
        method: "POST",
        body: { mapId: "bareDuel", options: { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } } },
      },
    ]);
  });

  it("sends typed scenario overrides for API-agent custom matches", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json(makeSnapshot());
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await sdk.reset("bareDuel", {
      scenario: {
        addResources: [{ id: "gold-agent-pocket", kind: "goldMine", x: 1500, y: 1380, amount: 1234 }],
        addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: 90, cooldownRemaining: 0 }],
        addUnits: [
          { id: "unit-agent-wildling", owner: "neutral", kind: "wildling", x: 1600, y: 1460 },
          { id: "unit-agent-wounded", owner: "enemy", kind: "footman", x: 1660, y: 1460, hp: 37 },
        ],
        addBuildings: [{ id: "building-agent-farm", owner: "player", kind: "farm", x: 620, y: 640, complete: true }],
        addLandmarks: [{ id: "landmark-agent-banner", kind: "bannerStone", x: 1500, y: 1500, size: 96, rotation: 0.25 }],
      },
    });

    expect(calls).toEqual([
      {
        path: "/api/reset",
        method: "POST",
        body: {
          mapId: "bareDuel",
          options: {
            scenario: {
              addResources: [{ id: "gold-agent-pocket", kind: "goldMine", x: 1500, y: 1380, amount: 1234 }],
              addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: 90, cooldownRemaining: 0 }],
              addUnits: [
                { id: "unit-agent-wildling", owner: "neutral", kind: "wildling", x: 1600, y: 1460 },
                { id: "unit-agent-wounded", owner: "enemy", kind: "footman", x: 1660, y: 1460, hp: 37 },
              ],
              addBuildings: [{ id: "building-agent-farm", owner: "player", kind: "farm", x: 620, y: 640, complete: true }],
              addLandmarks: [{ id: "landmark-agent-banner", kind: "bannerStone", x: 1500, y: 1500, size: 96, rotation: 0.25 }],
            },
          },
        },
      },
    ]);
  });

  it("runs guarded full-match speed control through SDK tick chunks", async () => {
    const calls: unknown[] = [];
    let currentTick = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      currentTick += body.ticks;
      return json({
        ticks: body.ticks,
        elapsedMs: 4,
        cpuMs: 2,
        memory: { rssBytes: 1200, heapUsedBytes: 700, heapDeltaBytes: 10 },
        snapshot: makeSnapshot(currentTick, currentTick >= 300),
      });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    const result = await sdk.fastForwardUntil({
      until: (snapshot) => snapshot.match.winner !== null,
      maxTicks: 1000,
      chunkTicks: 120,
      maxElapsedMs: 50,
      maxCpuMs: 10,
    });

    expect(result.totalTicks).toBe(360);
    expect(result.elapsedMs).toBe(12);
    expect(result.cpuMs).toBe(6);
    expect(result.samples.length).toBe(3);
    expect(result.snapshot.match.winner).toBe("player");
    expect(calls).toEqual([{ ticks: 120 }, { ticks: 120 }, { ticks: 120 }]);
  });

  it("fails loudly when a guarded SDK speed-control run burns too much CPU", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      return json({
        ticks: body.ticks,
        elapsedMs: 2,
        cpuMs: 9,
        memory: { rssBytes: 1200, heapUsedBytes: 700, heapDeltaBytes: 10 },
        snapshot: makeSnapshot(body.ticks, false),
      });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await expect(
      sdk.fastForwardUntil({
        until: (snapshot) => snapshot.match.winner !== null,
        maxTicks: 1000,
        chunkTicks: 200,
        maxCpuMs: 8,
      }),
    ).rejects.toThrow("CPU budget exceeded");
  });

  it("fails loudly when a guarded SDK speed-control run makes no tick progress", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      if (calls > 3) throw new Error("test guard: SDK kept ticking without progress");
      return json({
        ticks: 0,
        elapsedMs: 1,
        cpuMs: 1,
        memory: { rssBytes: 1200, heapUsedBytes: 700, heapDeltaBytes: 0 },
        snapshot: makeSnapshot(0, false),
      });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await expect(
      sdk.fastForwardUntil({
        until: (snapshot) => snapshot.match.winner !== null,
        maxTicks: 1000,
        chunkTicks: 200,
      }),
    ).rejects.toThrow("non-positive tick progress");
  });

  it("dogfoods room and savegame APIs through typed helpers", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const room = makeRoom("room-1");
    const save = { schemaVersion: 1, id: "save-1", label: "opening", createdAt: "2026-05-31T00:00:00.000Z", room, snapshot: makeSnapshot(), runtime: { nextId: 1001, activePlayers: ["player", "enemy"], teams: { player: "north", enemy: "south" }, aiPlayers: ["enemy"] } };
    const replay = { schemaVersion: 1, id: "trace-1", label: "debug", initialSave: save, batches: [], checkpoints: [] };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: url.pathname, method, body });
      if (url.pathname === "/api/rooms" && method === "GET") return json({ rooms: [room] });
      if (url.pathname === "/api/rooms" && method === "POST") return json(room);
      if (url.pathname === "/api/rooms/room-1/slots/slot-2") return json(room);
      if (url.pathname === "/api/rooms/room-1/start") return json({ ...room, status: "inMatch" });
      if (url.pathname === "/api/rooms/room-1/reset") return json({ room: { ...room, mapId: "bareDuel", status: "inMatch" }, snapshot: makeSnapshot() });
      if (url.pathname === "/api/rooms/room-1/snapshot") return json(makeSnapshot());
      if (url.pathname === "/api/rooms/room-1/command") return json(makeSnapshot());
      if (url.pathname === "/api/rooms/room-1/commands") return json(makeSnapshot());
      if (url.pathname === "/api/rooms/room-1/tick") return json({ ticks: 20, elapsedMs: 1, cpuMs: 0.4, memory: { rssBytes: 1, heapUsedBytes: 2, heapDeltaBytes: 0 }, snapshot: makeSnapshot(20), room: { ...room, status: "inMatch" } });
      if (url.pathname === "/api/rooms/room-1/command-tick") return json({ ticks: 45, elapsedMs: 2, cpuMs: 0.8, memory: { rssBytes: 1, heapUsedBytes: 2, heapDeltaBytes: 0 }, snapshot: makeSnapshot(65), room: { ...room, status: "inMatch" } });
      if (url.pathname === "/api/rooms/room-1/save") return json(save);
      if (url.pathname === "/api/rooms/room-1/debug-replay" && method === "POST") return json(replay);
      if (url.pathname === "/api/rooms/room-1/debug-replay" && method === "GET") return json(replay);
      if (url.pathname === "/api/rooms/room-1/debug-replay/ticks/65") return json(makeSnapshot(65));
      if (url.pathname === "/api/rooms/room-1/debug-replay/ticks/65/save") return json({ ...save, id: "save-frame-65", label: "frame 65", snapshot: makeSnapshot(65) });
      if (url.pathname === "/api/savegames" && method === "GET") return json({ saves: [save] });
      if (url.pathname === "/api/savegames/save-1") return json(save);
      if (url.pathname === "/api/savegames/save-1/continue") return json({ ...room, id: "room-resumed", status: "inMatch" });
      return new Response("missing", { status: 404 });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await sdk.createRoom({ id: "room-1", host: { id: "user-1", name: "Host" }, slotCount: 2 });
    await sdk.updateRoomSlot("room-1", "slot-2", { controller: "ai", team: "south" });
    await sdk.startRoom("room-1");
    await sdk.resetRoom("room-1", "bareDuel", { aiPlayers: [] });
    await sdk.roomSnapshot("room-1");
    await sdk.roomCommand("room-1", "player", { type: "move", unitIds: ["unit-player-worker-1"], x: 900, y: 900 });
    await sdk.roomCommands("room-1", [{ playerId: "player", command: { type: "move", unitIds: ["unit-player-worker-1"], x: 910, y: 900 } }]);
    await sdk.tickRoom("room-1", 20);
    await sdk.commandTickRoom("room-1", [{ playerId: "player", command: { type: "move", unitIds: ["unit-player-worker-1"], x: 920, y: 900 } }], 45);
    await sdk.saveRoom("room-1", { id: "save-1", label: "opening" });
    await sdk.enableDebugReplay("room-1", { id: "trace-1", label: "debug" });
    await sdk.readDebugReplay("room-1");
    await sdk.replayDebugToTick("room-1", 65);
    await sdk.saveDebugReplayFrame("room-1", 65, { id: "save-frame-65", label: "frame 65" });
    await sdk.listSavegames();
    await sdk.readSavegame("save-1");
    await sdk.continueSavegame("save-1", { roomId: "room-resumed" });

    expect(calls).toEqual([
      { path: "/api/rooms", method: "POST", body: { id: "room-1", host: { id: "user-1", name: "Host" }, slotCount: 2 } },
      { path: "/api/rooms/room-1/slots/slot-2", method: "POST", body: { controller: "ai", team: "south" } },
      { path: "/api/rooms/room-1/start", method: "POST", body: {} },
      { path: "/api/rooms/room-1/reset", method: "POST", body: { mapId: "bareDuel", options: { aiPlayers: [] } } },
      { path: "/api/rooms/room-1/snapshot", method: "GET" },
      { path: "/api/rooms/room-1/command", method: "POST", body: { playerId: "player", command: { type: "move", unitIds: ["unit-player-worker-1"], x: 900, y: 900 } } },
      { path: "/api/rooms/room-1/commands", method: "POST", body: { commands: [{ playerId: "player", command: { type: "move", unitIds: ["unit-player-worker-1"], x: 910, y: 900 } }] } },
      { path: "/api/rooms/room-1/tick", method: "POST", body: { ticks: 20 } },
      { path: "/api/rooms/room-1/command-tick", method: "POST", body: { commands: [{ playerId: "player", command: { type: "move", unitIds: ["unit-player-worker-1"], x: 920, y: 900 } }], ticks: 45 } },
      { path: "/api/rooms/room-1/save", method: "POST", body: { id: "save-1", label: "opening" } },
      { path: "/api/rooms/room-1/debug-replay", method: "POST", body: { id: "trace-1", label: "debug" } },
      { path: "/api/rooms/room-1/debug-replay", method: "GET" },
      { path: "/api/rooms/room-1/debug-replay/ticks/65", method: "GET" },
      { path: "/api/rooms/room-1/debug-replay/ticks/65/save", method: "POST", body: { id: "save-frame-65", label: "frame 65" } },
      { path: "/api/savegames", method: "GET" },
      { path: "/api/savegames/save-1", method: "GET" },
      { path: "/api/savegames/save-1/continue", method: "POST", body: { roomId: "room-resumed" } },
    ]);
  });

  it("creates configurable grand stress rooms through a typed helper", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json({ ...makeRoom("grand"), name: "Grand Thirty 15v15", mapId: "grandThirty", slots: [] });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    const room = await sdk.createGrandThirtyRoom({ id: "user-host", name: "Host" }, "grand", { humanCount: 20, aiCount: 10 });

    expect(room.mapId).toBe("grandThirty");
    expect(calls).toEqual([{ path: "/api/rooms/grand-thirty", method: "POST", body: { id: "grand", host: { id: "user-host", name: "Host" }, humanCount: 20, aiCount: 10 } }]);
  });
});

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeSnapshot(tick = 0, winner = false) {
  return {
    tick,
    match: {
      winner: winner ? "player" : null,
      endedAtTick: winner ? tick : null,
      stats: {
        unitsKilled: { player: 0, enemy: 0, enemy2: 0, neutral: 0 },
        unitsLost: { player: 0, enemy: 0, enemy2: 0, neutral: 0 },
        buildingsDestroyed: { player: 0, enemy: 0, enemy2: 0 },
        nonBaseBuildingsDestroyed: { player: 0, enemy: 0, enemy2: 0 },
        goldSpent: { player: 0, enemy: 0, enemy2: 0 },
        mercenaryKills: { player: 0, enemy: 0, enemy2: 0 },
        neutralUnitsKilled: { player: 0, enemy: 0, enemy2: 0 },
      },
    },
    map: { id: "bareDuel", name: "Bare Duel", width: 4096, height: 4096, landmarks: [] },
    players: {
      player: { race: "grove", gold: 500, supplyUsed: 3, supplyCap: 10 },
      enemy: { race: "ember", gold: 620, supplyUsed: 3, supplyCap: 10 },
      enemy2: { race: "grove", gold: 620, supplyUsed: 0, supplyCap: 0 },
    },
    units: [],
    buildings: [],
    resources: [],
    mercenaryCamps: [],
    effects: [],
  };
}

function makeRoom(id: string) {
  return {
    id,
    name: "Room",
    hostUserId: "user-1",
    mapId: "bareDuel",
    status: "open",
    slots: [
      { id: "slot-1", playerId: "player", controller: "human", userId: "user-1", name: "Host", team: "north", race: "grove", ready: true },
      { id: "slot-2", playerId: "enemy", controller: "ai", name: "AI", team: "south", race: "ember", ready: true },
    ],
  };
}
