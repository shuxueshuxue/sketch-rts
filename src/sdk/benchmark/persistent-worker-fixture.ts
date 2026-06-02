import type { BenchmarkMatchInput, BenchmarkMatchReport } from "./core";
import type { SdkGameAgent } from "../game-runner";

let callIndex = 0;

export function runBenchmarkParallelMatch(match: BenchmarkMatchInput<SdkGameAgent>): BenchmarkMatchReport {
  callIndex += 1;
  return {
    name: match.name,
    elapsedMs: 0,
    cpuMs: 0,
    setup: {
      map: {
        id: match.mapId ?? "bareDuel",
        name: match.mapId ?? "bareDuel",
        width: 0,
        height: 0,
        goldMineCount: 0,
        goldMines: [],
        neutralCamps: {
          mapId: match.mapId ?? "bareDuel",
          players: 0,
          carriedItems: 0,
          camps: [],
          freeCamps: 0,
          guardedCamps: 0,
          bands: { green: 0, orange: 0, red: 0 },
          totalPower: 0,
          totalBounty: 0,
        },
        mercenaryCamps: [],
        items: { total: 0, byKind: {} },
      },
      players: {},
    },
    result: {
      tick: 0,
      gameSecond: 0,
      winner: null,
      winnerTeam: "none",
      timeout: false,
      players: {},
      trackers: { callIndex },
    },
  };
}
