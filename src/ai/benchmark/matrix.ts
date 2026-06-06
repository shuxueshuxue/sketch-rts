import type { GameSetupOptions, GameSnapshot, MapId, PlayerId, RaceId } from "../../shared/types";

export type AiMatrixCase = {
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

export type ExpansionOwnerProof = {
  maxExpansionTownHalls: number;
  maxExpansionMiners: number;
  sampledMiningTicks: number;
  minedResourceIds: string[];
};

export type ExpansionProof = Record<PlayerId, ExpansionOwnerProof>;

export type AiMatrixRuntimeBudget = {
  maxTicks?: number;
  maxElapsedMs?: number;
  maxCpuMs?: number;
  requireMemorySamples?: boolean;
};

export type AiMatrixAssertionInput = {
  snapshot: GameSnapshot;
  totalTicks: number;
  elapsedMs?: number;
  cpuMs?: number;
  memorySamples?: { rssBytes: number; heapUsedBytes: number }[];
  expansionProof: ExpansionProof;
  budget?: AiMatrixRuntimeBudget;
};

export const AI_MATRIX_MAX_TICKS = 36_000;

const DUEL_RACES: Partial<Record<PlayerId, RaceId>> = { player: "grove", enemy: "grove" };
const THREE_PLAYER_RACES: Partial<Record<PlayerId, RaceId>> = { player: "grove", enemy: "grove", enemy2: "grove" };

export const AI_MATRIX_CASES: AiMatrixCase[] = [
  {
    name: "1v1 no-expansion no-neutral",
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
    name: "1v1 expansion no-neutral",
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
    name: "1v1 no-expansion neutral",
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
    name: "1v2 expansion neutral",
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
    name: "1v1v1 expansion neutral",
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

export function createExpansionProof(activePlayers: PlayerId[]): ExpansionProof {
  return Object.fromEntries(
    activePlayers.map((owner) => [
      owner,
      {
        maxExpansionTownHalls: 0,
        maxExpansionMiners: 0,
        sampledMiningTicks: 0,
        minedResourceIds: [],
      },
    ]),
  );
}

export function sampleExpansionProof(snapshot: GameSnapshot, activePlayers: PlayerId[], proof: ExpansionProof) {
  const expansionResourceIds = new Set(snapshot.resources.filter((resource) => !resource.id.endsWith("-main")).map((resource) => resource.id));
  for (const owner of activePlayers) {
    const ownerProof = proof[owner];
    if (!ownerProof) throw new Error(`Missing expansion proof owner ${owner}`);
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

    ownerProof.maxExpansionTownHalls = Math.max(ownerProof.maxExpansionTownHalls, expansionTownHalls.length);
    ownerProof.maxExpansionMiners = Math.max(ownerProof.maxExpansionMiners, expansionMiners.length);
    if (expansionMiners.length > 0) ownerProof.sampledMiningTicks += 1;
    for (const miner of expansionMiners) {
      if (miner.order.type === "mine" && !ownerProof.minedResourceIds.includes(miner.order.resourceId)) {
        ownerProof.minedResourceIds.push(miner.order.resourceId);
      }
    }
  }
}

export function assertAiMatrixCase(testCase: AiMatrixCase, input: AiMatrixAssertionInput) {
  const { snapshot, totalTicks, elapsedMs, cpuMs, memorySamples, expansionProof, budget = {} } = input;
  const maxTicks = budget.maxTicks ?? AI_MATRIX_MAX_TICKS;
  must(snapshot.match.winner !== null, `${testCase.name}: no winner`);
  must(snapshot.match.endedAtTick !== null && snapshot.match.endedAtTick <= maxTicks, `${testCase.name}: exceeded tick budget`);
  must(totalTicks <= maxTicks, `${testCase.name}: runner exceeded max ticks`);
  if (budget.maxElapsedMs !== undefined && elapsedMs !== undefined) {
    must(elapsedMs < budget.maxElapsedMs, `${testCase.name}: runner too slow: ${elapsedMs.toFixed(1)}ms`);
  }
  if (budget.maxCpuMs !== undefined && cpuMs !== undefined) {
    must(cpuMs < budget.maxCpuMs, `${testCase.name}: runner too CPU-heavy: ${cpuMs.toFixed(1)}ms`);
  }
  if (budget.requireMemorySamples) {
    must(memorySamples !== undefined && memorySamples.every((sample) => sample.rssBytes > 0 && sample.heapUsedBytes > 0), `${testCase.name}: missing memory observations`);
  }

  for (const owner of testCase.activePlayers) {
    const player = playerState(snapshot, owner);
    must(player.race === "grove" || player.race === "ember", `${testCase.name}: ${owner} has invalid race`);
    must(statFor(snapshot.match.stats.goldSpent, owner) > testCase.minGoldSpent, `${testCase.name}: ${owner} did not spend enough gold`);
  }
  must(new Set(testCase.activePlayers.map((owner) => playerState(snapshot, owner).race)).size >= 2, `${testCase.name}: did not exercise mixed race slots`);
  must(sumOwners(testCase.activePlayers, snapshot.match.stats.unitsKilled) > 15, `${testCase.name}: not enough kills`);
  must(sumOwners(testCase.activePlayers, snapshot.match.stats.unitsLost) > 15, `${testCase.name}: not enough losses`);
  must(sumOwners(testCase.activePlayers, snapshot.match.stats.nonBaseBuildingsDestroyed) > 0, `${testCase.name}: no non-base buildings destroyed`);
  must(Math.max(...Object.values(losingArmies(snapshot, testCase))) <= 3, `${testCase.name}: defeated side kept a large unused army`);

  if (testCase.expectExpansion) {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.buildingsDestroyed) > 3, `${testCase.name}: expansion layout did not produce enough base/building pressure`);
    if (testCase.requireExpansionByTeam) {
      const expectedTeams = new Set(testCase.activePlayers.map((owner) => teamFor(snapshot, testCase, owner)));
      const teamsWithMining = new Set(expansionTeamsWithMining(snapshot, testCase, expansionProof));
      must(teamsWithMining.size === expectedTeams.size, `${testCase.name}: not every active team occupied a mining expansion; proof=${JSON.stringify(expansionProof)}`);
    } else {
      for (const owner of testCase.activePlayers) {
        const ownerProof = proofFor(expansionProof, owner);
        must(ownerProof.maxExpansionTownHalls > 0, `${testCase.name}: ${owner} never completed an expansion town hall`);
        must(ownerProof.maxExpansionMiners > 0, `${testCase.name}: ${owner} never mined an expansion`);
      }
    }
  } else {
    const expansionMines = snapshot.resources.filter((resource) => !resource.id.endsWith("-main"));
    must(expansionMines.length === 0, `${testCase.name}: expected no expansion mines`);
  }
  if (testCase.expectNeutral) {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.neutralUnitsKilled) > 0, `${testCase.name}: neutral camps were not cleared`);
  } else {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.neutralUnitsKilled) === 0, `${testCase.name}: expected no neutral kills`);
  }
  if (testCase.expectMercenary) {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.mercenaryKills) > 0, `${testCase.name}: mercenaries did not join combat`);
  } else {
    must(sumOwners(testCase.activePlayers, snapshot.match.stats.mercenaryKills) === 0, `${testCase.name}: expected no mercenary kills`);
  }
}

export function expansionTeamsWithMining(snapshot: GameSnapshot, testCase: AiMatrixCase, proof: ExpansionProof) {
  return [
    ...new Set(
      testCase.activePlayers
        .filter((owner) => {
          const ownerProof = proofFor(proof, owner);
          return ownerProof.maxExpansionTownHalls > 0 && ownerProof.maxExpansionMiners > 0;
        })
        .map((owner) => teamFor(snapshot, testCase, owner)),
    ),
  ];
}

export function losingArmies(snapshot: GameSnapshot, testCase: AiMatrixCase) {
  const winnerTeam = snapshot.match.winner ? teamFor(snapshot, testCase, snapshot.match.winner) : "";
  return Object.fromEntries(
    testCase.activePlayers
      .filter((owner) => teamFor(snapshot, testCase, owner) !== winnerTeam)
      .map((owner) => [owner, snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length]),
  ) as Record<PlayerId, number>;
}

export function sumOwners(owners: PlayerId[], record: Record<PlayerId, number>) {
  return owners.reduce((total, owner) => total + statFor(record, owner), 0);
}

function teamFor(snapshot: GameSnapshot, testCase: AiMatrixCase, owner: PlayerId) {
  return snapshot.teams?.[owner] ?? testCase.options.teams?.[owner] ?? owner;
}

function playerState(snapshot: GameSnapshot, owner: PlayerId) {
  const player = snapshot.players[owner];
  if (!player) throw new Error(`Missing AI matrix player ${owner}`);
  return player;
}

function proofFor(proof: ExpansionProof, owner: PlayerId) {
  const ownerProof = proof[owner];
  if (!ownerProof) throw new Error(`Missing expansion proof owner ${owner}`);
  return ownerProof;
}

function statFor(record: Record<PlayerId, number>, owner: PlayerId) {
  const value = record[owner];
  if (value === undefined) throw new Error(`Missing AI matrix stat owner ${owner}`);
  return value;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function must(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
