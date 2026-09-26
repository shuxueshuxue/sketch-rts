import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { enemyBuildings, hostileCombatUnits, units } from "../snapshot";
import { averagePoint, distance, type Point } from "../spatial";
import type { V6PolicyMemory } from "../../memory";
import type { AiPolicyContext, PresetAiPolicyOptions } from "../types";
import { isV6Policy, isV7Policy } from "../versions";
import { mainBase } from "../world-model";
import { v6Memory } from "./memory";

// @@@v6-caster-screen - V6's casters are its army's engine and its weak point: 80-95 hp, and the shared focus fire hunts
// casters first. Traced over V6's lost games, 3 in 4 summoner deaths came from the shared scripts walking a wounded
// summoner home alone, away from its spirits and past the enemy shooters. The backline owns the casters: they stand behind
// their own front line (melee and spirits), on the side away from the enemy and out of its shooters' reach, and fall back
// toward home when no front line is left to hide behind. The front does the fighting under the ordinary army scripts.

const FRONT_GROUP_RANGE = 700;
const THREAT_RANGE = 900;
const SCREEN_DEPTH = 200;
const FOLLOW_DEPTH = 120;
const FALLBACK_STEP = 320;
const SHOOTER_MARGIN = 90;
const REPOSITION_SLACK = 60;
const MIN_SCREEN = 3;
const HOLD_FIRE_MARGIN = 40;
// The step back outlasts the think gap by a little, so the caster is still moving (not shooting) when the next think comes.
const HOLD_FIRE_SLACK_TICKS = 3;

const BACKLINE_KINDS = new Set(["summoner", "pyreCaller", "priest", "witch", "emberAcolyte", "ashHexer", "fieldMedic"]);

export function isBacklineKind(unit: Unit) {
  return BACKLINE_KINDS.has(unit.kind);
}

export function v6ScreenedCasterIds(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): ReadonlySet<string> {
  if (!isV6Policy(options)) return new Set();
  return new Set(units(snapshot, owner).filter(isBacklineKind).map((unit) => unit.id));
}

export function planV6CasterScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV6Policy(options)) return [];
  // Read every think, casters or not, so the gap is the last think's and not the last one that had casters.
  const thinkGap = thinkGapTicks(snapshot, options);
  const casters = units(snapshot, owner).filter(isBacklineKind);
  if (casters.length === 0) return [];
  const front = units(snapshot, owner).filter((unit) => unit.kind !== "worker" && !isBacklineKind(unit));
  const enemies = hostileCombatUnits(snapshot, owner, options.teams);
  const towers = enemyBuildings(snapshot, owner, options.teams).filter((building) => building.complete && building.attackDamage > 0);
  const home = mainBase(snapshot, owner);
  const post = generalPost(v6Memory(options).general, home);
  const commands: GameCommand[] = [];
  for (const caster of casters) {
    const hold = isV7Policy(options) && thinkGap !== undefined ? holdFireStep(caster, enemies, thinkGap) : undefined;
    if (hold) {
      commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [caster.id], x: hold.x, y: hold.y }, options));
      continue;
    }
    const anchor = screenAnchor(caster, front, enemies, towers, home, post);
    if (!anchor || distance(caster, anchor) <= REPOSITION_SLACK) continue;
    commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [caster.id], x: anchor.x, y: anchor.y }, options));
  }
  return commands;
}

// @@@v7-hold-fire - A caster's spell and its weapon share one cooldown, and a weapon with a target in reach fires on the
// tick the cooldown runs out. A caster in a fight therefore swings its staff (7-8 damage) every time its spell comes back
// and never casts again: traced by hand, five witches standing among enemy spirits cursed four times in a whole battle.
// V7's casters hold their fire instead. One whose cooldown runs out before the next think steps back from the nearest foe
// (a moving unit does not shoot), and the next think finds it ready and casts: a witch kills a spirit every 7.5s, a
// summoner recasts every 40s. How soon the next think comes is read off the gap between the last two, not assumed.
function holdFireStep(caster: Unit, enemies: Unit[], thinkGap: number): Point | undefined {
  if (caster.cooldown <= 0 || caster.cooldown > thinkGap) return undefined;
  const foe = enemies.filter((enemy) => distance(enemy, caster) <= caster.attackRange + HOLD_FIRE_MARGIN).sort((a, b) => distance(a, caster) - distance(b, caster))[0];
  if (!foe) return undefined;
  return step(caster, away(caster, foe), caster.speed * (thinkGap + HOLD_FIRE_SLACK_TICKS));
}

function thinkGapTicks(snapshot: GameSnapshot, options: AiPolicyContext): number | undefined {
  const memory = v6Memory(options);
  const last = memory.backline?.lastThinkTick;
  const gap = last !== undefined && snapshot.tick > last ? snapshot.tick - last : memory.backline?.thinkGap;
  memory.backline = { lastThinkTick: snapshot.tick, ...(gap !== undefined ? { thinkGap: gap } : {}) };
  return gap;
}

// A front of one or two spirits chasing something is no screen: with fewer than three bodies nearby the casters go back to
// the general's post instead of following them across the map (they did, and died 1300 from home).
function screenAnchor(caster: Unit, frontLine: Unit[], enemies: Unit[], towers: { x: number; y: number; attackRange: number }[], home: Point, post: Point): Point | undefined {
  const screen = frontLine.filter((unit) => distance(unit, caster) <= FRONT_GROUP_RANGE);
  const front = screen.length >= MIN_SCREEN ? averagePoint(screen) : undefined;
  const threats = enemies.filter((enemy) => distance(enemy, front ?? caster) <= THREAT_RANGE);
  if (threats.length === 0) return front ? step(front, home, FOLLOW_DEPTH) : post;
  const threat = averagePoint(threats);
  let anchor = front ? step(front, away(front, threat), SCREEN_DEPTH) : step(post, home, FALLBACK_STEP / 2);
  // Behind the front is not enough if a shooter or tower still reaches that spot: keep backing off toward home.
  for (let tries = 0; tries < 4 && inReach(anchor, threats, towers); tries += 1) anchor = step(anchor, home, FALLBACK_STEP / 2);
  return anchor;
}

// With no real front to stand behind, casters wait where the general holds or guards, a step short of a camp it creeps, and at home
// while it defends (the defense point is the attackers themselves) or attacks with too few bodies near them.
function generalPost(general: V6PolicyMemory["general"], home: Point): Point {
  if (!general?.target) return home;
  if (general.mode === "hold" || general.mode === "guard") return general.target;
  if (general.mode === "creep") return step(general.target, home, SCREEN_DEPTH + FOLLOW_DEPTH);
  return home;
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
