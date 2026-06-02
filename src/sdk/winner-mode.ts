import type { Game } from "../shared/sim";
import type { PlayerId } from "../shared/types";

export type SdkWinnerMode = "match" | "combatElimination";

export function normalizeWinnerForMode(game: Game, teams: Record<PlayerId, string>, winnerMode: SdkWinnerMode) {
  if (winnerMode === "match") return;
  if (winnerMode === "combatElimination") {
    const winner = combatEliminationWinner(game, teams);
    game.match.winner = winner;
    game.match.endedAtTick = winner ? game.tick : null;
    return;
  }
  return assertNever(winnerMode);
}

function combatEliminationWinner(game: Game, teams: Record<PlayerId, string>): PlayerId | null {
  const combatOwnersByTeam = new Map<string, PlayerId[]>();
  for (const unit of game.units) {
    if (unit.owner === "neutral" || unit.kind === "worker") continue;
    const team = teams[unit.owner];
    if (!team) throw new Error(`Missing team for combat owner ${unit.owner}`);
    combatOwnersByTeam.set(team, [...(combatOwnersByTeam.get(team) ?? []), unit.owner]);
  }
  if (combatOwnersByTeam.size !== 1) return null;
  return [...combatOwnersByTeam.values()][0]?.[0] ?? null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled winner mode ${JSON.stringify(value)}`);
}
