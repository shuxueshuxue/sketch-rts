import { spawn } from "node:child_process";
import { SketchRtsSdk } from "../src/sdk/client";
import { seconds } from "../src/shared/time";

const port = Number(process.env.SDK_SMOKE_PORT ?? 5174);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
const host = { id: "sdk-smoke-host", name: "SDK Smoke Host" };
const roomId = `sdk-smoke-${Date.now().toString(36)}`;
let server: ReturnType<typeof spawn> | undefined;
let roomCreated = false;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  await waitForSdk();
  const catalog = await sdk.catalog();
  must(catalog.maps.some((map) => map.id === "wildMarches"), "catalog did not expose map scenarios");
  must(catalog.units.includes("summoner"), "catalog did not expose unit roster");
  must(catalog.buildings.includes("townHall"), "catalog did not expose buildable town hall");
  must(catalog.races.some((race) => race.id === "ember"), "catalog did not expose ember race slot");

  await sdk.createRoom({ id: roomId, host, mapId: "bareDuel", visibility: "private", humanCount: 1, aiCount: 1 });
  roomCreated = true;

  const startedWild = await sdk.resetRoom(roomId, "wildMarches");
  must(startedWild.snapshot.map.id === "wildMarches", "SDK room reset did not select wildMarches");

  const resetResult = await sdk.resetRoom(roomId, "bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });
  const reset = resetResult.snapshot;
  must(reset.map.id === "bareDuel", "reset did not select bareDuel");
  must(reset.mercenaryCamps.length === 0, "bareDuel should reset without mercenary camps");
  must(reset.players.player.race === "grove" && reset.players.enemy.race === "ember", "SDK reset did not apply race setup options");

  const customResult = await sdk.resetRoom(roomId, "bareDuel", {
    aiPlayers: [],
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
  const custom = customResult.snapshot;
  must(custom.resources.some((resource) => resource.id === "gold-agent-pocket" && resource.amount === 1234), "SDK custom scenario did not add resource");
  must(custom.mercenaryCamps.some((camp) => camp.id === "merc-agent-pocket" && camp.stock === 2), "SDK custom scenario did not add mercenary camp");
  must(custom.units.some((unit) => unit.id === "unit-agent-wildling" && unit.kind === "wildling" && unit.hp === unit.maxHp), "SDK custom scenario did not construct unit");
  must(custom.units.some((unit) => unit.id === "unit-agent-wounded" && unit.kind === "footman" && unit.hp === 37), "SDK custom scenario did not preserve bounded unit hp");
  must(custom.buildings.some((building) => building.id === "building-agent-farm" && building.kind === "farm" && building.complete), "SDK custom scenario did not construct building");
  must(custom.map.landmarks.some((landmark) => landmark.id === "landmark-agent-banner"), "SDK custom scenario did not add landmark");
  must(custom.players.player.supplyCap > reset.players.player.supplyCap, "SDK custom scenario building did not affect supply");

  const miningStartResult = await sdk.resetRoom(roomId, "bareDuel", { aiPlayers: ["enemy"], races: { player: "grove", enemy: "ember" } });
  const miningStart = miningStartResult.snapshot;
  const worker = miningStart.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
  const mine = miningStart.resources.find((resource) => resource.id === "gold-player-main");
  must(worker, "reset snapshot did not contain a player worker");
  must(mine, "reset snapshot did not contain player main gold mine");

  const afterMineCommand = await sdk.roomCommand(roomId, "player", { type: "mine", unitIds: [worker.id], resourceId: mine.id });
  const orderedWorker = afterMineCommand.units.find((unit) => unit.id === worker.id);
  must(orderedWorker?.order.type === "mine", "SDK mine command did not set worker mine order");

  const fast = await sdk.tickRoomUntil(roomId, {
    until: (snapshot) => snapshot.players.player.gold > miningStart.players.player.gold,
    maxTicks: 1400,
    chunkTicks: 140,
    maxElapsedMs: 750,
    maxCpuMs: 750,
  });
  const lastSample = fast.samples.at(-1);
  must(fast.snapshot.players.player.gold > miningStart.players.player.gold, "SDK fast-forward did not progress mining economy");
  must(fast.totalTicks > 0, "SDK fast-forward did not advance ticks");
  must(fast.elapsedMs >= 0 && fast.cpuMs >= 0, "SDK fast-forward did not accumulate timing observations");
  must(Boolean(lastSample?.memory && lastSample.memory.rssBytes > 0 && lastSample.memory.heapUsedBytes > 0), "SDK fast-forward did not expose memory observations");

  const snapshot = await sdk.roomSnapshot(roomId);
  must(snapshot.tick >= fast.snapshot.tick, "SDK snapshot did not observe current server state");

  const duelStartResult = await sdk.resetRoom(roomId, "bareDuel", { aiPlayers: ["player", "enemy"], races: { player: "grove", enemy: "ember" } });
  const duelStart = duelStartResult.snapshot;
  const duel = await sdk.tickRoomUntil(roomId, {
    until: (sample) => sample.match.stats.goldSpent.player > 1_500 && sample.match.stats.goldSpent.enemy > 1_500,
    maxTicks: 36_000,
    chunkTicks: 2_000,
    maxElapsedMs: 3_000,
    maxCpuMs: 4_000,
  });
  must(duel.snapshot.match.stats.goldSpent.player > 1_500 && duel.snapshot.match.stats.goldSpent.enemy > 1_500, "SDK full-match fast-forward did not exercise spending AI");
  must(duel.samples.every((sample) => sample.memory.rssBytes > 0 && sample.memory.heapUsedBytes > 0), "SDK full-match fast-forward missed memory observations");
  must(rate(duel.totalTicks, duel.elapsedMs) >= 4, "SDK full-match fast-forward is too slow for agent-speed testing");
  must(rate(duel.totalTicks, duel.cpuMs) >= 4, "SDK full-match fast-forward is too CPU-heavy for agent-speed testing");

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        baseUrl,
        map: snapshot.map.id,
        tick: snapshot.tick,
        playerGold: snapshot.players.player.gold,
        races: { player: snapshot.players.player.race, enemy: snapshot.players.enemy.race },
        customScenario: {
          resources: custom.resources.some((resource) => resource.id === "gold-agent-pocket"),
          mercenaryCamps: custom.mercenaryCamps.some((camp) => camp.id === "merc-agent-pocket"),
          units: custom.units.some((unit) => unit.id === "unit-agent-wildling"),
          woundedUnitHp: custom.units.find((unit) => unit.id === "unit-agent-wounded")?.hp,
          buildings: custom.buildings.some((building) => building.id === "building-agent-farm"),
          landmarks: custom.map.landmarks.some((landmark) => landmark.id === "landmark-agent-banner"),
        },
        totalTicks: fast.totalTicks,
        elapsedMs: Number(fast.elapsedMs.toFixed(3)),
        cpuMs: Number(fast.cpuMs.toFixed(3)),
        ticksPerElapsedMs: Number(rate(fast.totalTicks, fast.elapsedMs).toFixed(3)),
        ticksPerCpuMs: Number(rate(fast.totalTicks, fast.cpuMs).toFixed(3)),
        lastMemory: lastSample?.memory,
        duel: {
          startedAtTick: duelStart.tick,
          winner: duel.snapshot.match.winner,
          endedAtTick: duel.snapshot.match.endedAtTick,
          totalTicks: duel.totalTicks,
          elapsedMs: Number(duel.elapsedMs.toFixed(3)),
          cpuMs: Number(duel.cpuMs.toFixed(3)),
          ticksPerElapsedMs: Number(rate(duel.totalTicks, duel.elapsedMs).toFixed(3)),
          ticksPerCpuMs: Number(rate(duel.totalTicks, duel.cpuMs).toFixed(3)),
          samples: duel.samples.length,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (roomCreated) await sdk.closeRoom(roomId, host.id);
  if (server && !server.killed) {
    server.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function waitForSdk() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      await sdk.catalog();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw new Error(`SDK server did not become ready at ${baseUrl}`);
}

function must<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (!value) throw new Error(message);
}

function rate(ticks: number, ms: number) {
  return ticks / Math.max(ms, 1);
}
