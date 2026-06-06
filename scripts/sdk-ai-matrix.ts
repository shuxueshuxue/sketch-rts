import { spawn } from "node:child_process";
import { SketchRtsSdk, type RoomTickResult } from "../src/sdk/client";
import type { GameSetupOptions, GameSnapshot, MapId, PlayerId, RaceId } from "../src/shared/types";

type SdkMatrixCase = {
  name: string;
  mapId: MapId;
  options: GameSetupOptions;
  activePlayers: PlayerId[];
  requireExpansionByTeam: boolean;
  expectExpansion: boolean;
  expectNeutral: boolean;
  expectMercenary: boolean;
  minGoldSpent: number;
};

type ExpansionOwnerProof = {
  maxExpansionTownHalls: number;
  maxExpansionMiners: number;
  sampledMiningTicks: number;
  minedResourceIds: string[];
};

type ExpansionProof = Record<PlayerId, ExpansionOwnerProof>;

const port = Number(process.env.SDK_AI_MATRIX_PORT ?? 5175);
const baseUrl = `http://127.0.0.1:${port}`;
const sdk = new SketchRtsSdk(baseUrl);
const host = { id: "sdk-ai-matrix-host", name: "SDK AI Matrix Host" };
const runId = Date.now().toString(36);
const MAX_TICKS = 36_000;
const DUEL_RACES: Partial<Record<PlayerId, RaceId>> = { player: "grove", enemy: "grove" };
const THREE_PLAYER_RACES: Partial<Record<PlayerId, RaceId>> = { player: "grove", enemy: "grove", enemy2: "grove" };
const cases: SdkMatrixCase[] = [
  {
    name: "sdk 1v1 no-expansion no-neutral",
    mapId: "bareDuel",
    options: { aiPlayers: ["player", "enemy"], races: DUEL_RACES },
    activePlayers: ["player", "enemy"],
    requireExpansionByTeam: false,
    expectExpansion: false,
    expectNeutral: false,
    expectMercenary: false,
    minGoldSpent: 1_500,
  },
  {
    name: "sdk 1v1 expansion no-neutral",
    mapId: "openClaims",
    options: { aiPlayers: ["player", "enemy"], races: DUEL_RACES },
    activePlayers: ["player", "enemy"],
    requireExpansionByTeam: false,
    expectExpansion: true,
    expectNeutral: false,
    expectMercenary: false,
    minGoldSpent: 1_500,
  },
  {
    name: "sdk 1v1 no-expansion neutral",
    mapId: "campRush",
    options: { aiPlayers: ["player", "enemy"], races: DUEL_RACES },
    activePlayers: ["player", "enemy"],
    requireExpansionByTeam: false,
    expectExpansion: false,
    expectNeutral: true,
    expectMercenary: true,
    minGoldSpent: 1_500,
  },
  {
    name: "sdk 1v2 expansion neutral",
    mapId: "wildMarches",
    options: { players: ["player", "enemy", "enemy2"], aiPlayers: ["player", "enemy", "enemy2"], teams: { player: "north", enemy: "south", enemy2: "south" }, races: THREE_PLAYER_RACES },
    activePlayers: ["player", "enemy", "enemy2"],
    requireExpansionByTeam: true,
    expectExpansion: true,
    expectNeutral: true,
    expectMercenary: true,
    minGoldSpent: 1_000,
  },
  {
    name: "sdk 1v1v1 expansion neutral",
    mapId: "wildMarches",
    options: { players: ["player", "enemy", "enemy2"], aiPlayers: ["player", "enemy", "enemy2"], races: THREE_PLAYER_RACES },
    activePlayers: ["player", "enemy", "enemy2"],
    requireExpansionByTeam: false,
    expectExpansion: true,
    expectNeutral: true,
    expectMercenary: true,
    minGoldSpent: 1_500,
  },
];

let server: ReturnType<typeof spawn> | undefined;

try {
  server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  await waitForSdk();
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  const reports = [];
  for (const testCase of cases) {
    reports.push(await runCase(testCase));
  }
  const cpu = process.cpuUsage(cpuStarted);
  const memory = process.memoryUsage();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        baseUrl,
        totalElapsedMs: Number((performance.now() - started).toFixed(3)),
        totalCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        reports,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (server && !server.killed) {
    server.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function runCase(testCase: SdkMatrixCase) {
  const expansionProof = createExpansionProof();
  const caseStarted = performance.now();
  const roomId = `sdk-ai-matrix-${runId}-${slug(testCase.name)}`;
  await sdk.createRoom({
    id: roomId,
    host,
    mapId: testCase.mapId,
    visibility: "private",
    humanCount: 1,
    aiCount: Math.max(1, testCase.activePlayers.length - 1),
  });
  await sdk.resetRoom(roomId, testCase.mapId, testCase.options);
  const result = await sdk.tickRoomUntil(roomId, {
    until: (snapshot) => snapshot.match.winner !== null,
    maxTicks: MAX_TICKS,
    chunkTicks: 45,
    maxElapsedMs: 6_000,
    maxCpuMs: 7_000,
  });
  for (const sample of result.samples) sampleExpansionProof(sample.snapshot, testCase.activePlayers, expansionProof);
  sampleExpansionProof(result.snapshot, testCase.activePlayers, expansionProof);
  assertCase(testCase, result, expansionProof);
  return {
    name: testCase.name,
    mapId: testCase.mapId,
    winner: result.snapshot.match.winner,
    endedAtTick: result.snapshot.match.endedAtTick,
    totalTicks: result.totalTicks,
    elapsedMs: Number(result.elapsedMs.toFixed(3)),
    cpuMs: Number(result.cpuMs.toFixed(3)),
    wallElapsedMs: Number((performance.now() - caseStarted).toFixed(3)),
    samples: result.samples.length,
    lastMemory: result.samples.at(-1)?.memory,
    races: Object.fromEntries(testCase.activePlayers.map((owner) => [owner, result.snapshot.players[owner].race])),
    unitsKilled: result.snapshot.match.stats.unitsKilled,
    unitsLost: result.snapshot.match.stats.unitsLost,
    goldSpent: result.snapshot.match.stats.goldSpent,
    neutralUnitsKilled: result.snapshot.match.stats.neutralUnitsKilled,
    mercenaryKills: result.snapshot.match.stats.mercenaryKills,
    nonBaseBuildingsDestroyed: result.snapshot.match.stats.nonBaseBuildingsDestroyed,
    losingArmies: losingArmies(result.snapshot, testCase),
    expansionProof,
  };
}

function assertCase(testCase: SdkMatrixCase, result: { snapshot: GameSnapshot; totalTicks: number; elapsedMs: number; cpuMs: number; samples: RoomTickResult[] }, expansionProof: ExpansionProof) {
  const snapshot = result.snapshot;
  must(snapshot.match.winner !== null, `${testCase.name}: no winner`);
  must(snapshot.match.endedAtTick !== null && snapshot.match.endedAtTick <= MAX_TICKS, `${testCase.name}: exceeded 30-minute tick budget`);
  must(result.totalTicks <= MAX_TICKS, `${testCase.name}: SDK tick loop exceeded max ticks`);
  must(result.elapsedMs < 6_000, `${testCase.name}: SDK tick loop too slow`);
  must(result.cpuMs < 7_000, `${testCase.name}: SDK tick loop too CPU-heavy`);
  must(result.samples.every((sample) => sample.memory.rssBytes > 0 && sample.memory.heapUsedBytes > 0), `${testCase.name}: missing SDK memory observations`);
  must(new Set(testCase.activePlayers.map((owner) => snapshot.players[owner].race)).size >= 2, `${testCase.name}: did not exercise mixed race slots`);
  for (const owner of testCase.activePlayers) {
    must(snapshot.match.stats.goldSpent[owner] > testCase.minGoldSpent, `${testCase.name}: ${owner} did not spend enough gold`);
  }
  must(sumOwners(testCase.activePlayers, snapshot.match.stats.unitsKilled) > 15, `${testCase.name}: not enough kills`);
  must(sumOwners(testCase.activePlayers, snapshot.match.stats.unitsLost) > 15, `${testCase.name}: not enough losses`);
  must(sumOwners(testCase.activePlayers, snapshot.match.stats.nonBaseBuildingsDestroyed) > 0, `${testCase.name}: no non-base buildings destroyed`);
  must(Math.max(...Object.values(losingArmies(snapshot, testCase))) <= 3, `${testCase.name}: defeated side kept a large unused army`);

  if (testCase.expectExpansion) {
    if (testCase.requireExpansionByTeam) {
      const expectedTeams = new Set(testCase.activePlayers.map((owner) => teamFor(testCase, owner)));
      const teamsWithMining = new Set(expansionTeamsWithMining(testCase, expansionProof));
      must(teamsWithMining.size === expectedTeams.size, `${testCase.name}: not every active team occupied a mining expansion; proof=${JSON.stringify(expansionProof)}`);
    } else {
      for (const owner of testCase.activePlayers) {
        must(expansionProof[owner].maxExpansionTownHalls > 0, `${testCase.name}: ${owner} never completed an expansion town hall`);
        must(expansionProof[owner].maxExpansionMiners > 0, `${testCase.name}: ${owner} never mined an expansion`);
      }
    }
  }
  if (testCase.expectNeutral) {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.neutralUnitsKilled) > 0, `${testCase.name}: no neutral camps cleared`);
  } else {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.neutralUnitsKilled) === 0, `${testCase.name}: unexpected neutral kills`);
  }
  if (testCase.expectMercenary) {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.mercenaryKills) > 0, `${testCase.name}: no mercenary kills`);
  } else {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.mercenaryKills) === 0, `${testCase.name}: unexpected mercenary kills`);
  }
}

function createExpansionProof(): ExpansionProof {
  return {
    player: { maxExpansionTownHalls: 0, maxExpansionMiners: 0, sampledMiningTicks: 0, minedResourceIds: [] },
    enemy: { maxExpansionTownHalls: 0, maxExpansionMiners: 0, sampledMiningTicks: 0, minedResourceIds: [] },
    enemy2: { maxExpansionTownHalls: 0, maxExpansionMiners: 0, sampledMiningTicks: 0, minedResourceIds: [] },
  };
}

function sampleExpansionProof(snapshot: GameSnapshot, activePlayers: PlayerId[], proof: ExpansionProof) {
  const expansionResourceIds = new Set(snapshot.resources.filter((resource) => !resource.id.endsWith("-main")).map((resource) => resource.id));
  for (const owner of activePlayers) {
    const mainMine = snapshot.resources.find((resource) => resource.id === `gold-${owner}-main`);
    const expansionTownHalls = snapshot.buildings.filter(
      (building) =>
        building.owner === owner &&
        building.kind === "townHall" &&
        building.complete &&
        (!mainMine || distance(building, mainMine) > 650),
    );
    const expansionMiners = snapshot.units.filter(
      (unit) =>
        unit.owner === owner &&
        unit.kind === "worker" &&
        unit.order.type === "mine" &&
        expansionResourceIds.has(unit.order.resourceId),
    );
    proof[owner].maxExpansionTownHalls = Math.max(proof[owner].maxExpansionTownHalls, expansionTownHalls.length);
    proof[owner].maxExpansionMiners = Math.max(proof[owner].maxExpansionMiners, expansionMiners.length);
    if (expansionMiners.length > 0) proof[owner].sampledMiningTicks += 1;
    for (const miner of expansionMiners) {
      if (miner.order.type === "mine" && !proof[owner].minedResourceIds.includes(miner.order.resourceId)) {
        proof[owner].minedResourceIds.push(miner.order.resourceId);
      }
    }
  }
}

function losingArmies(snapshot: GameSnapshot, testCase: SdkMatrixCase) {
  const winnerTeam = snapshot.match.winner ? teamFor(testCase, snapshot.match.winner) : "";
  return Object.fromEntries(
    testCase.activePlayers
      .filter((owner) => teamFor(testCase, owner) !== winnerTeam)
      .map((owner) => [owner, snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length]),
  ) as Record<PlayerId, number>;
}

function expansionTeamsWithMining(testCase: SdkMatrixCase, proof: ExpansionProof) {
  return [
    ...new Set(
      testCase.activePlayers
        .filter((owner) => proof[owner].maxExpansionTownHalls > 0 && proof[owner].maxExpansionMiners > 0)
        .map((owner) => teamFor(testCase, owner)),
    ),
  ];
}

function teamFor(testCase: SdkMatrixCase, owner: PlayerId) {
  return testCase.options.teams?.[owner] ?? owner;
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
  throw new Error(`SDK AI matrix server did not become ready at ${baseUrl}`);
}

function sumOwners(owners: PlayerId[], record: Record<PlayerId, number>) {
  return owners.reduce((total, owner) => total + record[owner], 0);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
