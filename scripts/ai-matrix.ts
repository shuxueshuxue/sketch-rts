import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "../src/ai/runtime";
import { createGame, type CreateGameOptions, type Game } from "../src/shared/sim";
import { CommandFrameRuntime } from "../src/shared/sim/command-frame-runtime";
import type { MapId, PlayerId, RaceId } from "../src/shared/types";

type MatrixCase = {
  name: string;
  mapId: MapId;
  options: CreateGameOptions;
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

const MAX_TICKS = 36_000;
const DUEL_RACES: Partial<Record<PlayerId, RaceId>> = { player: "grove", enemy: "grove" };
const THREE_PLAYER_RACES: Partial<Record<PlayerId, RaceId>> = { player: "grove", enemy: "grove", enemy2: "grove" };
const cases: MatrixCase[] = [
  {
    name: "1v1 no-expansion no-neutral",
    mapId: "bareDuel",
    options: { aiPlayers: ["player", "enemy"], races: DUEL_RACES },
    expectExpansion: false,
    expectNeutral: false,
    expectMercenary: false,
    minGoldSpent: 1_500,
  },
  {
    name: "1v1 expansion no-neutral",
    mapId: "openClaims",
    options: { aiPlayers: ["player", "enemy"], races: DUEL_RACES },
    expectExpansion: true,
    expectNeutral: false,
    expectMercenary: false,
    minGoldSpent: 1_500,
  },
  {
    name: "1v1 no-expansion neutral",
    mapId: "campRush",
    options: { aiPlayers: ["player", "enemy"], races: DUEL_RACES },
    expectExpansion: false,
    expectNeutral: true,
    expectMercenary: true,
    minGoldSpent: 1_500,
  },
  {
    name: "1v2 expansion neutral",
    mapId: "wildMarches",
    options: { players: ["player", "enemy", "enemy2"], aiPlayers: ["player", "enemy", "enemy2"], teams: { player: "north", enemy: "south", enemy2: "south" }, races: THREE_PLAYER_RACES },
    expectExpansion: true,
    expectNeutral: true,
    expectMercenary: true,
    minGoldSpent: 1_000,
  },
  {
    name: "1v1v1 expansion neutral",
    mapId: "wildMarches",
    options: { players: ["player", "enemy", "enemy2"], aiPlayers: ["player", "enemy", "enemy2"], races: THREE_PLAYER_RACES },
    expectExpansion: true,
    expectNeutral: true,
    expectMercenary: true,
    minGoldSpent: 1_500,
  },
];

const matrixStarted = performance.now();
const cpuStarted = process.cpuUsage();
const reports = cases.map(runCase);
const cpu = process.cpuUsage(cpuStarted);
const memory = process.memoryUsage();

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      totalElapsedMs: Number((performance.now() - matrixStarted).toFixed(3)),
      totalCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      reports,
    },
    null,
    2,
  )}\n`,
);

function runCase(testCase: MatrixCase) {
  const game = createGame(testCase.mapId, testCase.options);
  const runtime = createAiRuntime(testCase.options.aiPlayers ?? []);
  const frameRuntime = new CommandFrameRuntime({
    game,
    roomId: "ai-matrix",
    rejectionLabel: "AI matrix command rejected",
    aiPlanner: createPresetAiRuntimeFramePlanner(game, runtime),
  });
  const expansionProof = createExpansionProof();
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  sampleExpansionProof(game, expansionProof);
  for (let i = 0; i < MAX_TICKS && !game.match.winner; i += 1) {
    frameRuntime.tick();
    if (game.tick % 45 === 0) sampleExpansionProof(game, expansionProof);
  }
  sampleExpansionProof(game, expansionProof);
  const cpu = process.cpuUsage(cpuStarted);
  const elapsedMs = performance.now() - started;

  assertCase(game, testCase, elapsedMs, expansionProof);
  return {
    name: testCase.name,
    mapId: testCase.mapId,
    tick: game.tick,
    winner: game.match.winner,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    unitsKilled: game.match.stats.unitsKilled,
    unitsLost: game.match.stats.unitsLost,
    goldSpent: game.match.stats.goldSpent,
    races: Object.fromEntries(game.activePlayers.map((owner) => [owner, game.players[owner].race])),
    nonBaseBuildingsDestroyed: game.match.stats.nonBaseBuildingsDestroyed,
    neutralUnitsKilled: game.match.stats.neutralUnitsKilled,
    mercenaryKills: game.match.stats.mercenaryKills,
    losingArmies: losingArmies(game),
    expansionProof,
    expansionTeamsWithMining: expansionTeamsWithMining(game, expansionProof),
  };
}

function assertCase(game: Game, testCase: MatrixCase, elapsedMs: number, expansionProof: ExpansionProof) {
  must(game.match.winner !== null, `${testCase.name}: no winner`);
  must(game.match.endedAtTick !== null && game.match.endedAtTick <= MAX_TICKS, `${testCase.name}: exceeded tick budget`);
  must(elapsedMs < 2_500, `${testCase.name}: sim loop too slow: ${elapsedMs.toFixed(1)}ms`);
  for (const owner of game.activePlayers) {
    must(game.players[owner].race === "grove" || game.players[owner].race === "ember", `${testCase.name}: ${owner} has invalid race`);
    must(game.match.stats.goldSpent[owner] > testCase.minGoldSpent, `${testCase.name}: ${owner} floated economy, spent ${game.match.stats.goldSpent[owner]}`);
  }
  must(new Set(game.activePlayers.map((owner) => game.players[owner].race)).size >= 2, `${testCase.name}: mixed-race matrix case did not exercise the new race slot`);
  must(sumPlayerStats(game.match.stats.unitsKilled) > 15, `${testCase.name}: not enough combat kills`);
  must(sumPlayerStats(game.match.stats.unitsLost) > 15, `${testCase.name}: not enough casualties`);
  must(sumPlayerStats(game.match.stats.nonBaseBuildingsDestroyed) > 0, `${testCase.name}: no non-base buildings destroyed`);
  must(Math.max(...Object.values(losingArmies(game))) <= 3, `${testCase.name}: defeated side kept a large unused army`);

  if (testCase.expectExpansion) {
    must(game.match.stats.buildingsDestroyed.player + game.match.stats.buildingsDestroyed.enemy + game.match.stats.buildingsDestroyed.enemy2 > 3, `${testCase.name}: expansion layout did not produce enough base/building pressure`);
    const expectedTeams = new Set(game.activePlayers.map((owner) => game.teams[owner]));
    const teamsWithMining = new Set(expansionTeamsWithMining(game, expansionProof));
    must(teamsWithMining.size === expectedTeams.size, `${testCase.name}: not every active team occupied a mining expansion; proof=${JSON.stringify(expansionProof)}`);
  } else {
    const expansionMines = game.resources.filter((resource) => !resource.id.endsWith("-main"));
    must(expansionMines.length === 0, `${testCase.name}: expected no expansion mines`);
  }
  if (testCase.expectNeutral) {
    must(sumPlayerStats(game.match.stats.neutralUnitsKilled) > 0, `${testCase.name}: neutral camps were not cleared`);
  } else {
    must(sumPlayerStats(game.match.stats.neutralUnitsKilled) === 0, `${testCase.name}: expected no neutral kills`);
  }
  if (testCase.expectMercenary) {
    must(sumPlayerStats(game.match.stats.mercenaryKills) > 0, `${testCase.name}: mercenaries did not join combat`);
  } else {
    must(sumPlayerStats(game.match.stats.mercenaryKills) === 0, `${testCase.name}: expected no mercenary kills`);
  }
}

function createExpansionProof(): ExpansionProof {
  return {
    player: { maxExpansionTownHalls: 0, maxExpansionMiners: 0, sampledMiningTicks: 0, minedResourceIds: [] },
    enemy: { maxExpansionTownHalls: 0, maxExpansionMiners: 0, sampledMiningTicks: 0, minedResourceIds: [] },
    enemy2: { maxExpansionTownHalls: 0, maxExpansionMiners: 0, sampledMiningTicks: 0, minedResourceIds: [] },
  };
}

function sampleExpansionProof(game: Game, proof: ExpansionProof) {
  for (const owner of game.activePlayers) {
    const resourceIds = new Set(game.resources.filter((resource) => !resource.id.endsWith("-main")).map((resource) => resource.id));
    const mainMine = game.resources.find((resource) => resource.id === `gold-${owner}-main`);
    const expansionTownHalls = game.buildings.filter(
      (building) =>
        building.owner === owner &&
        building.kind === "townHall" &&
        building.complete &&
        (!mainMine || distance(building, mainMine) > 650),
    );
    const expansionMiners = game.units.filter(
      (unit) =>
        unit.owner === owner &&
        unit.kind === "worker" &&
        unit.order.type === "mine" &&
        resourceIds.has(unit.order.resourceId),
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

function expansionTeamsWithMining(game: Game, proof: ExpansionProof) {
  return [
    ...new Set(
      game.activePlayers
        .filter((owner) => proof[owner].maxExpansionTownHalls > 0 && proof[owner].maxExpansionMiners > 0)
        .map((owner) => game.teams[owner]),
    ),
  ];
}

function losingArmies(game: Game) {
  const winnerTeam = game.match.winner ? game.teams[game.match.winner] : "";
  return Object.fromEntries(
    game.activePlayers
      .filter((owner) => game.teams[owner] !== winnerTeam)
      .map((owner) => [owner, game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length]),
  ) as Record<PlayerId, number>;
}

function sumPlayerStats(record: Record<PlayerId, number>) {
  return record.player + record.enemy + record.enemy2;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
