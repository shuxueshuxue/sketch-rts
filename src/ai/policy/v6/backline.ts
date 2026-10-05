import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { enemyBuildings, hostileCombatUnits, units } from "../snapshot";
import { averagePoint, distance, withinRangeOf, type Point } from "../spatial";
import type { V6PolicyMemory } from "../../memory";
import type { AiPolicyContext, PresetAiPolicyOptions } from "../types";
import { AUTO_ACQUIRE_RANGE } from "../../../shared/sim";
import { isV6Policy, isV8Policy, isV9Policy } from "../versions";
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

// @@@v8-caster-reach - V8's casters heal and curse, and a heal is cast on a wounded unit within 220, a curse on an enemy
// within 260: stood where V6 keeps its summoners, behind the front and out of every shooter's reach (90 beyond the 399 of
// V5's archers), V8's priests and witches watched its footmen fight 400 paces away and never cast (mallowRun, 8:30). V8's
// casters keep a short step behind the front, inside the shooters' and towers' reach along with it.
const V8_SCREEN_DEPTH = 110;

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
  const casters = units(snapshot, owner).filter(isBacklineKind);
  if (casters.length === 0) return [];
  const front = units(snapshot, owner).filter((unit) => unit.kind !== "worker" && !isBacklineKind(unit));
  const enemies = hostileCombatUnits(snapshot, owner, options.teams);
  const towers = enemyBuildings(snapshot, owner, options.teams).filter((building) => building.complete && building.attackDamage > 0);
  const home = mainBase(snapshot, owner);
  const post = generalPost(v6Memory(options).general, home);
  const frontNear = withinRangeOf(front, FRONT_GROUP_RANGE);
  const threatsNear = withinRangeOf(enemies, THREAT_RANGE);
  const commands: GameCommand[] = [];
  for (const caster of casters) {
    // @@@v9-caster-stand - With no front left and only soldiers that fight at arm's length within the reach every idle
    // unit engages at (no shooter, see inReach, and nothing summoned), a V9 caster stops and fights where it stands rather
    // than walking home: riders (4.1) ran priests and witches (3.0) down from behind, four of them walked for 20 s without a
    // shot at a knight 38 away (the V9 exam's S3, gullIsland). From shooters, which outreach it, and from spirits, gone in
    // 60 s, it still walks: standing against them too, V9 won 336 of 500 games against three where it had won 348.
    const on = threatsNear(caster).filter((enemy) => distance(enemy, caster) <= AUTO_ACQUIRE_RANGE);
    if (isV9Policy(options) && frontNear(caster).length < MIN_SCREEN && on.length > 0 && on.every((enemy) => enemy.attackRange <= 100 && enemy.expiresTick === undefined)) {
      if (caster.order.type === "move") commands.push({ type: "stop", unitIds: [caster.id] });
      continue;
    }
    const anchor = screenAnchor(caster, frontNear, threatsNear, towers, home, post, isV8Policy(options));
    if (!anchor || distance(caster, anchor) <= REPOSITION_SLACK) continue;
    commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [caster.id], x: anchor.x, y: anchor.y }, options));
  }
  return commands;
}

// A front of one or two spirits chasing something is no screen: with fewer than three bodies nearby the casters go back to
// the general's post instead of following them across the map (they did, and died 1300 from home).
// frontNear, threatsNear: the front line within FRONT_GROUP_RANGE and the enemies within THREAT_RANGE of a point, in order.
function screenAnchor(caster: Unit, frontNear: (point: Point) => Unit[], threatsNear: (point: Point) => Unit[], towers: { x: number; y: number; attackRange: number }[], home: Point, post: Point, close: boolean): Point | undefined {
  const screen = frontNear(caster);
  const front = screen.length >= MIN_SCREEN ? averagePoint(screen) : undefined;
  const threats = threatsNear(front ?? caster);
  if (threats.length === 0) return front ? step(front, home, FOLLOW_DEPTH) : post;
  const threat = averagePoint(threats);
  if (close && front) return step(front, away(front, threat), V8_SCREEN_DEPTH);
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
