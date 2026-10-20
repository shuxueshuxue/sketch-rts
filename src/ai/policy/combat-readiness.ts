import { UNIT_DEFS, unitMover } from "../../shared/catalog";
import { strikeReach } from "../../shared/combat-geometry";
import { canReach } from "../../shared/naval";
import { canTakeStance } from "../../shared/push";
import type { GameCommand, GameSnapshot, MeleeStance, PlayerId } from "../../shared/types";
import { isOpponentOwner } from "./ownership";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { SHOOTER_UNIT_KINDS } from "./versions";

type ReadinessCommand = Extract<GameCommand, { type: "aim" | "setStance" }>;
type ReadinessResult = { commands: ReadinessCommand[]; aimed: Set<string> };
type ReadinessEntry = {
  snapshot: GameSnapshot;
  owner: PlayerId;
  teams: AiPolicyContext["teams"];
  teamValues: Array<[PlayerId, string | undefined]>;
  mode: string | undefined;
  hasTarget: boolean;
  targetX: number | undefined;
  targetY: number | undefined;
  result: ReadinessResult;
};
type ReadinessScope = { entry?: ReadinessEntry };

const readinessScopes = new WeakMap<AiPolicyContext, ReadinessScope>();

// The script runner owns this synchronous scope. It shares only one immutable
// world frame (the existing @@@query-memo contract); memory and team options can
// change between claims and execution, so readiness checks their values too.
// Standalone calls have no scope. Even a retained context stops reusing results
// when the runner returns or throws, and nested scopes restore their caller.
export function withCombatReadinessReuse<T>(options: AiPolicyContext, run: () => T): T {
  const previous = readinessScopes.get(options);
  readinessScopes.set(options, {});
  try {
    return run();
  } finally {
    if (previous) readinessScopes.set(options, previous);
    else readinessScopes.delete(options);
  }
}

function readinessPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadinessResult {
  const scope = readinessScopes.get(options);
  if (!scope) return computeReadinessPlan(snapshot, owner, options);
  const general = options.memory.v6?.general;
  const entry = scope.entry;
  const hasTarget = !!general?.target;
  const targetX = general?.target?.x, targetY = general?.target?.y;
  if (entry && entry.snapshot === snapshot && entry.owner === owner && entry.teams === options.teams
    && entry.mode === general?.mode && entry.hasTarget === hasTarget
    && Object.is(entry.targetX, targetX) && Object.is(entry.targetY, targetY)
    && entry.teamValues.every(([id, team]) => Object.is(options.teams?.[id], team))) return entry.result;
  const result = computeReadinessPlan(snapshot, owner, options);
  // Capture all owners readiness tests, rather than just own keys of a partial
  // team map. Deleting a mapping or changing an inherited value also matters.
  const teamOwners = new Set<PlayerId>([owner]);
  for (const unit of snapshot.units) teamOwners.add(unit.owner);
  scope.entry = { snapshot, owner, teams: options.teams, mode: general?.mode, hasTarget, targetX, targetY,
    teamValues: [...teamOwners].map((id): [PlayerId, string | undefined] => [id, options.teams?.[id]]), result };
  return result;
}

function computeReadinessPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadinessResult {
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land");
  const foes = snapshot.units.filter(unit => unit.kind !== "worker" && isOpponentOwner(snapshot, owner, unit.owner, options));
  const commands: ReadinessCommand[] = [];
  const aimed = new Set<string>();
  const stances = new Map<MeleeStance, string[]>();
  const general = options.memory.v6?.general;
  for (const unit of own) {
    if (["board", "cast", "charge", "move"].includes(unit.order.type)) continue;
    const nearby = foes.filter(enemy => distance(unit, enemy) < 300 && canReach(snapshot.map, unit, enemy));
    if (canTakeStance(unit)) {
      const order = unit.order;
      const target = order.type === "attack" || order.type === "attackMove" ? snapshot.units.find(enemy => enemy.id === order.targetId) : undefined;
      const protectedFriend = own.some(friend => friend !== unit && friend.attackRange > 100 && distance(friend, unit) < 140
        && nearby.some(enemy => enemy.attackRange <= 100 && distance(enemy, friend) < 140));
      const stance: MeleeStance = protectedFriend && nearby.some(enemy => distance(enemy, unit) <= unit.attackRange + 30) ? "brace"
        : target && target.attackRange > 100 && unit.speed >= 70 && unit.hp > unit.maxHp * .75 && !nearby.some(enemy => enemy.attackRange <= 100 && distance(enemy, unit) < 160) ? "shock" : "pursue";
      if ((unit.stance ?? "pursue") !== stance) stances.set(stance, [...(stances.get(stance) ?? []), unit.id]);
    }
    if (!(SHOOTER_UNIT_KINDS.has(unit.kind) || UNIT_DEFS[unit.kind].weapon) || unit.attackRange <= 100 || unit.hp < unit.maxHp * .6) continue;
    if (!general?.target || !["guard", "hold", "defend"].includes(general.mode) || distance(unit, general.target) > 200) continue;
    if (!["idle", "hold", "aim"].includes(unit.order.type) || nearby.some(enemy => distance(unit, enemy) <= strikeReach(unit, enemy))) continue;
    const approaching = foes.filter(enemy => {
      const gap = distance(unit, enemy);
      return gap > strikeReach(unit, enemy) && gap <= Math.min(900, unit.attackRange + enemy.speed * 4) && canReach(snapshot.map, unit, enemy);
    }).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    if (!approaching) continue;
    const gap = distance(unit, approaching);
    const reach = unit.attackRange * .85;
    const point = { x: unit.x + (approaching.x - unit.x) * reach / gap, y: unit.y + (approaching.y - unit.y) * reach / gap };
    aimed.add(unit.id);
    if (unit.order.type !== "aim" || distance(unit.order, point) > 40) commands.push({ type: "aim", unitIds: [unit.id], ...point });
  }
  for (const [stance, unitIds] of stances) commands.push({ type: "setStance", unitIds, stance });
  return { commands, aimed };
}

export function planCombatReadiness(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const result = readinessPlan(snapshot, owner, options);
  return readinessScopes.has(options) ? result.commands.map(command => ({ ...command, unitIds: [...command.unitIds] })) : result.commands;
}

export function readinessUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  const result = readinessPlan(snapshot, owner, options);
  return readinessScopes.has(options) ? new Set(result.aimed) : result.aimed;
}
