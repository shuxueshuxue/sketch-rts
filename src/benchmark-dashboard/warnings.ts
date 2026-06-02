import type { BenchmarkMatchReport } from "../sdk/benchmark";

export function matchWarnings(match: BenchmarkMatchReport) {
  const warnings: string[] = [];
  if (!match.result.timeout) {
    const winners = Object.values(match.result.players).filter((player) => player.team === match.result.winnerTeam);
    if (winners.length > 0 && winners.every((player) => player.firstEnemyEngagementSecond === null)) warnings.push("winner no first fight");
    const losers = Object.values(match.result.players).filter((player) => player.team !== match.result.winnerTeam);
    if (losers.some((player) => player.unitsLost > 0 && player.unitsKilledByNeutral >= player.unitsLost)) warnings.push("opponent neutral deaths");
  }
  return warnings;
}
