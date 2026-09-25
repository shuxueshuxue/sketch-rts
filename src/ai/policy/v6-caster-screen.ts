import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { resolveAiCommandIntent } from "./commands";
import { enemyBuildings, hostileCombatUnits, units } from "./snapshot";
import { averagePoint, distance, type Point } from "./spatial";
import type { PresetAiPolicyOptions } from "./types";
import { isV6Policy } from "./versions";
import { mainBase } from "./world-model";

// @@@v6-caster-screen - V6's summoners are its army's engine and its weak point: 95 hp, and the shared focus fire hunts
// casters first. Traced over V6's lost games, 3 in 4 summoner deaths came from the shared scripts walking a wounded
// summoner home alone, away from its spirits and past the enemy shooters. The screen owns the summoners: they stand behind
// their own spirits, on the side away from the enemy and out of its shooters' reach, and fall back toward home when no
// spirits are left to hide behind. The spirits do the fighting under the ordinary army scripts.

const SPIRIT_GROUP_RANGE = 700;
const THREAT_RANGE = 900;
const SCREEN_DEPTH = 200;
const FOLLOW_DEPTH = 120;
const FALLBACK_STEP = 320;
const SHOOTER_MARGIN = 90;
const REPOSITION_SLACK = 60;

export function isSummonerKind(unit: Unit) {
  return unit.kind === "summoner" || unit.kind === "pyreCaller";
}

export function v6ScreenedCasterIds(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ReadonlySet<string> {
  if (!isV6Policy(options)) return new Set();
  return new Set(units(snapshot, owner).filter(isSummonerKind).map((unit) => unit.id));
}

export function planV6CasterScreen(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  if (!isV6Policy(options)) return [];
  const casters = units(snapshot, owner).filter(isSummonerKind);
  if (casters.length === 0) return [];
  const spirits = units(snapshot, owner).filter((unit) => unit.kind === "spirit");
  const enemies = hostileCombatUnits(snapshot, owner, options.teams);
  const towers = enemyBuildings(snapshot, owner, options.teams).filter((building) => building.complete && building.attackDamage > 0);
  const home = mainBase(snapshot, owner);
  const commands: GameCommand[] = [];
  for (const caster of casters) {
    const anchor = screenAnchor(caster, spirits, enemies, towers, home);
    if (!anchor || distance(caster, anchor) <= REPOSITION_SLACK) continue;
    commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [caster.id], x: anchor.x, y: anchor.y }, options));
  }
  return commands;
}

function screenAnchor(caster: Unit, spirits: Unit[], enemies: Unit[], towers: { x: number; y: number; attackRange: number }[], home: Point): Point | undefined {
  const screen = spirits.filter((spirit) => distance(spirit, caster) <= SPIRIT_GROUP_RANGE);
  const front = screen.length > 0 ? averagePoint(screen) : undefined;
  const threats = enemies.filter((enemy) => distance(enemy, front ?? caster) <= THREAT_RANGE);
  if (threats.length === 0) return front ? step(front, home, FOLLOW_DEPTH) : undefined;
  const threat = averagePoint(threats);
  let anchor = front ? step(front, away(front, threat), SCREEN_DEPTH) : step(caster, home, FALLBACK_STEP);
  // Behind the spirits is not enough if a shooter or tower still reaches that spot: keep backing off toward home.
  for (let tries = 0; tries < 4 && inReach(anchor, threats, towers); tries += 1) anchor = step(anchor, home, FALLBACK_STEP / 2);
  return anchor;
}

function inReach(point: Point, threats: Unit[], towers: { x: number; y: number; attackRange: number }[]) {
  return threats.some((enemy) => enemy.attackRange > 100 && distance(enemy, point) <= enemy.attackRange + SHOOTER_MARGIN) || towers.some((tower) => distance(tower, point) <= tower.attackRange + SHOOTER_MARGIN);
}

function away(from: Point, threat: Point): Point {
  return { x: from.x * 2 - threat.x, y: from.y * 2 - threat.y };
}

function step(from: Point, toward: Point, length: number): Point {
  const gap = distance(from, toward);
  if (gap < 1) return from;
  const ratio = Math.min(1, length / gap);
  return { x: from.x + (toward.x - from.x) * ratio, y: from.y + (toward.y - from.y) * ratio };
}
