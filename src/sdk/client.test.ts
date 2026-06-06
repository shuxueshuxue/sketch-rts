import { describe, expect, it } from "vitest";
import { seconds } from "../shared/time";
import { SketchRtsSdk } from "./client";
import { SketchRtsBrowserDebug } from "./browser";

describe("SketchRtsSdk", () => {
  it("dogfoods typed helpers for catalog and room-scoped gameplay calls", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const room = makeRoom("room-1");
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === "/api/catalog") {
        return json({ units: ["worker"], buildings: ["townHall"], races: [{ id: "grove", name: "Grove Kin", note: "Test race" }], maps: [{ id: "bareDuel", name: "Bare Duel", note: "Test", tags: ["4096"] }] });
      }
      if (url.pathname === "/api/rooms" && method === "POST") return json(room);
      if (url.pathname === "/api/rooms/room-1/start") return json({ ...room, status: "inMatch" });
      if (url.pathname === "/api/rooms/room-1/reset") return json({ room: { ...room, status: "inMatch" }, snapshot: makeSnapshot() });
      if (url.pathname === "/api/rooms/room-1/snapshot") return json(makeSnapshot());
      if (url.pathname === "/api/rooms/room-1/command") return json(makeSnapshot());
      if (url.pathname === "/api/rooms/room-1/tick") return json({ ticks: 120, elapsedMs: 3, cpuMs: 1.2, memory: { rssBytes: 1000, heapUsedBytes: 500, heapDeltaBytes: 12 }, snapshot: makeSnapshot(), room: { ...room, status: "inMatch" } });
      return new Response("missing", { status: 404 });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    const catalog = await sdk.catalog();
    await sdk.createRoom({ id: "room-1", host: { id: "user-1", name: "Host" }, mapId: "bareDuel", visibility: "private", humanCount: 1, aiCount: 1 });
    await sdk.startRoom("room-1");
    const reset = await sdk.resetRoom("room-1", "bareDuel");
    const snapshot = await sdk.roomSnapshot("room-1");
    const afterCommand = await sdk.roomCommand("room-1", "player", { type: "move", unitIds: ["worker"], x: 10, y: 20 });
    const fastForward = await sdk.tickRoom("room-1", 120);

    expect(catalog.maps[0]?.id).toBe("bareDuel");
    expect(catalog.races[0]?.id).toBe("grove");
    expect(reset.snapshot.map.id).toBe("bareDuel");
    expect(snapshot.players.player.supplyCap).toBe(10);
    expect(afterCommand.map.width).toBe(4096);
    expect(fastForward.ticks).toBe(120);
    expect(fastForward.elapsedMs).toBeLessThan(50);
    expect(fastForward.cpuMs).toBeLessThan(10);
    expect(fastForward.memory.heapDeltaBytes).toBe(12);
    expect(calls).toEqual([
      { path: "/api/catalog", method: "GET" },
      { path: "/api/rooms", method: "POST", body: { id: "room-1", host: { id: "user-1", name: "Host" }, mapId: "bareDuel", visibility: "private", humanCount: 1, aiCount: 1 } },
      { path: "/api/rooms/room-1/start", method: "POST", body: {} },
      { path: "/api/rooms/room-1/reset", method: "POST", body: { mapId: "bareDuel" } },
      { path: "/api/rooms/room-1/snapshot", method: "GET" },
      { path: "/api/rooms/room-1/command", method: "POST", body: { playerId: "player", command: { type: "move", unitIds: ["worker"], x: 10, y: 20 } } },
      { path: "/api/rooms/room-1/tick", method: "POST", body: { ticks: 120 } },
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

    await sdk.resetRoom("room-1", "bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });

    expect(calls).toEqual([
      {
        path: "/api/rooms/room-1/reset",
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

    await sdk.resetRoom("room-1", "bareDuel", {
      scenario: {
        addResources: [{ id: "gold-agent-pocket", kind: "goldMine", x: 1500, y: 1380, amount: 1234 }],
        addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: seconds(4.5), cooldownRemaining: 0 }],
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
        path: "/api/rooms/room-1/reset",
        method: "POST",
        body: {
          mapId: "bareDuel",
          options: {
            scenario: {
              addResources: [{ id: "gold-agent-pocket", kind: "goldMine", x: 1500, y: 1380, amount: 1234 }],
              addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: seconds(4.5), cooldownRemaining: 0 }],
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

  it("can request the viewer-scoped room list for private room ownership", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(`${url.pathname}${url.search}`);
      return json({ rooms: [] });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await sdk.listRooms({ userId: "user 1" });

    expect(calls).toEqual(["/api/rooms?userId=user%201"]);
  });

  it("runs guarded room speed control through SDK tick chunks", async () => {
    const calls: unknown[] = [];
    let currentTick = 0;
    const room = { ...makeRoom("room-1"), status: "inMatch" as const };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/rooms/room-1/tick");
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      currentTick += body.ticks;
      return json({
        ticks: body.ticks,
        elapsedMs: 4,
        cpuMs: 2,
        memory: { rssBytes: 1200, heapUsedBytes: 700, heapDeltaBytes: 10 },
        snapshot: makeSnapshot(currentTick, currentTick >= 300),
        room,
      });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    const result = await sdk.tickRoomUntil("room-1", {
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

  it("fails loudly when a guarded room speed-control run burns too much CPU", async () => {
    const room = { ...makeRoom("room-1"), status: "inMatch" as const };
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      return json({
        ticks: body.ticks,
        elapsedMs: 2,
        cpuMs: 9,
        memory: { rssBytes: 1200, heapUsedBytes: 700, heapDeltaBytes: 10 },
        snapshot: makeSnapshot(body.ticks, false),
        room,
      });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await expect(
      sdk.tickRoomUntil("room-1", {
        until: (snapshot) => snapshot.match.winner !== null,
        maxTicks: 1000,
        chunkTicks: 200,
        maxCpuMs: 8,
      }),
    ).rejects.toThrow("CPU budget exceeded");
  });

  it("fails loudly when a guarded room speed-control run makes no tick progress", async () => {
    let calls = 0;
    const room = { ...makeRoom("room-1"), status: "inMatch" as const };
    const fetcher: typeof fetch = async () => {
      calls += 1;
      if (calls > 3) throw new Error("test guard: SDK kept ticking without progress");
      return json({
        ticks: 0,
        elapsedMs: 1,
        cpuMs: 1,
        memory: { rssBytes: 1200, heapUsedBytes: 700, heapDeltaBytes: 0 },
        snapshot: makeSnapshot(0, false),
        room,
      });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    await expect(
      sdk.tickRoomUntil("room-1", {
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
    const replay = { schemaVersion: 1, id: "trace-1", label: "debug", initialSave: save, frames: [], checkpoints: [] };
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

    await sdk.createRoom({ id: "room-1", host: { id: "user-1", name: "Host" }, mapId: "bareDuel", visibility: "private", humanCount: 1, aiCount: 3 });
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
      { path: "/api/rooms", method: "POST", body: { id: "room-1", host: { id: "user-1", name: "Host" }, mapId: "bareDuel", visibility: "private", humanCount: 1, aiCount: 3 } },
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

  it("validates save and debug replay payloads before sending SDK requests", async () => {
    const calls: string[] = [];
    const sdk = new SketchRtsSdk("http://game.test", async (input) => {
      calls.push(String(input));
      return json({});
    });

    await expect(sdk.saveRoom("room-1", { id: "" })).rejects.toThrow("Malformed savegame input");
    await expect(sdk.enableDebugReplay("room-1", { id: "trace-1", label: 12 } as never)).rejects.toThrow("Malformed debug replay input");
    await expect(sdk.saveDebugReplayFrame("room-1", 65, { label: "missing id" } as never)).rejects.toThrow("Malformed replay frame save input");
    expect(calls).toEqual([]);
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

  it("pauses a live room and steps until a room effect appears", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    let tickCalls = 0;
    const room = { ...makeRoom("room-1"), status: "inMatch" as const };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: url.pathname, method, body });
      if (url.pathname === "/api/rooms/room-1/pause") return json({ ...room, autoTick: false });
      if (url.pathname === "/api/rooms/room-1/snapshot") return json(makeSnapshot(0));
      if (url.pathname === "/api/rooms/room-1/tick") {
        tickCalls += 1;
        return json({
          ticks: 1,
          elapsedMs: 1,
          cpuMs: 0.4,
          memory: { rssBytes: 1, heapUsedBytes: 2, heapDeltaBytes: 0 },
          snapshot: makeSnapshot(tickCalls, false, {
            effects: tickCalls < 2 ? [] : [{ id: "effect-storm", type: "storm", x: 1200, y: 1200, remaining: 30, duration: 60 }],
          }),
          room: { ...room, autoTick: false },
        });
      }
      return new Response("missing", { status: 404 });
    };
    const sdk = new SketchRtsSdk("http://game.test", fetcher);

    const capture = await sdk.waitForRoomEffect({ roomId: "room-1", effectType: "storm", maxTicks: 5 });

    expect(capture.effect.type).toBe("storm");
    expect(capture.snapshot.tick).toBe(2);
    expect(calls).toEqual([
      { path: "/api/rooms/room-1/pause", method: "POST", body: {} },
      { path: "/api/rooms/room-1/snapshot", method: "GET" },
      { path: "/api/rooms/room-1/tick", method: "POST", body: { ticks: 1 } },
      { path: "/api/rooms/room-1/tick", method: "POST", body: { ticks: 1 } },
    ]);
  });

  it("uses a browser adapter for room screenshots instead of open-coded Playwright scripts", async () => {
    const page = new FakeDebugPage();
    const sdk = new SketchRtsSdk("http://game.test", async () => json(makeSnapshot()));
    const browser = new SketchRtsBrowserDebug(sdk, page);

    const shot = await browser.captureRoomScreenshot({
      roomId: "room-1",
      path: "/tmp/effect.png",
      width: 1440,
      height: 900,
      user: { id: "user-1", name: "Host" },
      hidePointerLockGate: true,
    });

    expect(shot.path).toBe("/tmp/effect.png");
    expect(page.calls).toEqual([
      ["setViewportSize", { width: 1440, height: 900 }],
      ["goto", "http://game.test"],
      ["evaluate", "localStorage"],
      ["reload"],
      ["click", "[data-open-room-browser]"],
      ["click", "[data-room-id=\"room-1\"]"],
      ["waitForSelector", ".game-shell:not(.menu-open)"],
      ["evaluate", "hidePointerLockGate"],
      ["screenshot", { path: "/tmp/effect.png", fullPage: false }],
    ]);
  });
});

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeSnapshot(tick = 0, winner = false, patch: Record<string, unknown> = {}) {
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
    ...patch,
  };
}

function makeRoom(id: string) {
  return {
    id,
    name: "Room",
    hostUserId: "user-1",
    mapId: "bareDuel",
    status: "open",
    autoTick: true,
    slots: [
      { id: "slot-1", playerId: "player", controller: "human", userId: "user-1", name: "Host", team: "north", race: "grove", ready: true },
      { id: "slot-2", playerId: "enemy", controller: "ai", name: "AI", team: "south", race: "ember", ready: true },
    ],
  };
}

class FakeDebugPage {
  calls: unknown[][] = [];

  async setViewportSize(size: { width: number; height: number }) {
    this.calls.push(["setViewportSize", size]);
  }

  async goto(url: string) {
    this.calls.push(["goto", url]);
  }

  async evaluate(fn: unknown) {
    this.calls.push(["evaluate", String(fn).includes("localStorage") ? "localStorage" : "hidePointerLockGate"]);
  }

  async reload() {
    this.calls.push(["reload"]);
  }

  locator(selector: string) {
    return {
      click: async () => {
        this.calls.push(["click", selector]);
      },
    };
  }

  async waitForSelector(selector: string) {
    this.calls.push(["waitForSelector", selector]);
  }

  async waitForFunction(_fn: unknown, arg: unknown) {
    this.calls.push(["waitForFunction", arg]);
  }

  async screenshot(options: { path: string; fullPage: boolean }) {
    this.calls.push(["screenshot", options]);
    return Buffer.from("fake-png");
  }
}
