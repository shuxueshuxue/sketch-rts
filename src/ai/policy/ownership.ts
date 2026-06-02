import type { GameSnapshot, PlayerId } from "../../shared/types";
import { activePlayerIds, aiSnapshotQuery } from "./snapshot";

export type TeamPolicyOptions = {
  teams?: Partial<Record<PlayerId, string>>;
};

export function opponentPlayerIds(snapshot: GameSnapshot, owner: PlayerId, options: TeamPolicyOptions) {
  return activePlayerIds(snapshot).filter((candidate) => isOpponentOwner(snapshot, owner, candidate, options));
}

export function isEnemyOwner(snapshot: GameSnapshot, owner: PlayerId, other: string, options: TeamPolicyOptions) {
  if (other === "neutral") return true;
  return isOpponentOwner(snapshot, owner, other, options);
}

export function isOpponentOwner(snapshot: GameSnapshot, owner: PlayerId, other: string, options: TeamPolicyOptions) {
  if (other === "neutral") return false;
  return aiSnapshotQuery(snapshot, options.teams).isOpponent(owner, other);
}

export function teamFor(snapshot: GameSnapshot, owner: string, options: TeamPolicyOptions) {
  if (owner === "neutral") return "neutral";
  return options.teams?.[owner] ?? aiSnapshotQuery(snapshot, options.teams).teamFor(owner);
}
