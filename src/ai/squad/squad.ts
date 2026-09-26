import { UNIT_DEFS } from "../../shared/catalog";
import { autocastEnabled, canAutocast } from "../../shared/autocast";
import type { AbilityKind, Building, GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { averagePoint, distance, type Point } from "../policy/spatial";
import { combatRating, structureRating } from "../policy/v6/strength";

// @@@squad - One brain for any group of units, with nothing to set up: hand it the units and what they are there for
// (hold a point, attack a place, patrol, escort someone, hunt someone down) and every think it answers with the
// commands a careful player would give them. It weighs itself against the foes around it by what they fight with
// (hit points times damage, the same rating V7's creeping uses), fights when it holds the edge and falls back when it
// does not, puts its blows on one target at a time, steps its badly wounded out of the fight, and keeps every ability
// its units carry on autocast so the engine casts them (heals, curses, summons, charges, and whatever a map adds).
//
// It is a pure function of the snapshot plus a small memory the caller keeps (plain data: it can be saved, copied and
// compared), so the same squad plays the same way every run. It knows nothing of any AI version or strategy; the
// versions and campaign scripts decide what a squad is for, the squad decides how it fights.

export type SquadIntent =
  // Stand at `at`; fight what comes within `leash` of it.
  | { kind: "hold"; at: Point; leash?: number }
  // Go to `at`, fighting what it meets on the way.
  | { kind: "attack"; at: Point }
  // Walk the route in a loop, fighting what comes within `leash` of the group.
  | { kind: "patrol"; route: readonly Point[]; leash?: number }
  // Stay by one unit and fight what threatens it.
  | { kind: "escort"; unitId: string; leash?: number }
  // Chase these units down, whatever else is around.
  | { kind: "hunt"; targetIds: readonly string[] };

export type SquadOptions = {
  // The edge the squad wants before it fights: its strength over the foes'. Below RETREAT_SHARE of this it gives up a
  // fight it is in. 1 fights even odds; a Boss's guards might take 0.6, a timid scout 1.5.
  nerve?: number;
  // Where it falls back to. By default the point it holds, or where it first stood.
  retreatTo?: Point;
  // How far around an attacking or hunting group foes count (holding, patrolling and escorting squads use their leash).
  vision?: number;
  // Which units are foes. By default: units of another team, and neutral creeps only once they fight the squad.
  isFoe?: (unit: Unit) => boolean;
  // "auto" (the default) switches on every ability that can autocast; "leave" leaves the switches as they are.
  skills?: "auto" | "leave";
};

export type SquadState = "advance" | "fight" | "fallback";

// Plain data the caller keeps between thinks, one per squad.
export type SquadMemory = {
  state: SquadState;
  since: number;
  focusId?: string;
  waypoint?: number;
  start?: Point;
};

export type SquadReport = {
  state: SquadState;
  // Fighting strength (a fresh footman is 1) of the squad and of the foes it weighs itself against.
  own: number;
  foes: number;
  odds: number;
  alive: number;
  focusId?: string;
  // Where the squad is headed or standing.
  anchor: Point;
};

export type SquadPlan = { commands: GameCommand[]; report: SquadReport };

const DEFAULT_NERVE = 1;
const RETREAT_SHARE = 0.7;
const DEFAULT_VISION = 700;
const DEFAULT_LEASH = 450;
const ESCORT_LEASH = 250;
// A fallback lasts at least this long before the squad turns back: turning at every flicker of the count makes a
// group walk back and forth under fire.
const FALLBACK_TICKS = 5 * 20;
const WOUNDED_SHARE = 0.3;
const ORDER_SLACK = 100;
const WAYPOINT_REACHED = 150;
// While not fighting, a group spread wider than this gathers on its middle before it walks on.
const SPREAD = 550;
// A melee unit farther than this from the focus target fights whatever is nearest instead of walking through the line.
const MELEE_REACH = 200;
const RANGED = 90;

export function createSquadMemory(): SquadMemory {
  return { state: "advance", since: 0 };
}

export function planSquad(snapshot: GameSnapshot, owner: PlayerId, unitIds: readonly string[], intent: SquadIntent, memory: SquadMemory, options: SquadOptions = {}): SquadPlan {
  const ids = new Set(unitIds);
  const squad = snapshot.units.filter((unit) => ids.has(unit.id) && unit.owner === owner && unit.hp > 0);
  const nerve = options.nerve ?? DEFAULT_NERVE;
  if (squad.length === 0) return { commands: [], report: { state: memory.state, own: 0, foes: 0, odds: 0, alive: 0, anchor: memory.start ?? { x: 0, y: 0 } } };
  const center = averagePoint(squad);
  memory.start ??= { x: center.x, y: center.y };
  const anchor = anchorOf(snapshot, intent, memory, center);
  const retreat = options.retreatTo ?? (intent.kind === "hold" ? intent.at : memory.start);
  const assessment = assessSquad(snapshot, owner, squad, { ...options, vision: reachOf(intent, options), around: fightCenter(intent, anchor, center) });
  const { foes } = assessment;
  const odds = assessment.odds;

  // The fight state, with a gap between the odds that start a fight and the odds that end one.
  const cornered = intent.kind === "hold" && options.retreatTo === undefined;
  if (foes.length === 0) setState(memory, "advance", snapshot.tick);
  else if (memory.state === "fight") {
    if (odds < nerve * RETREAT_SHARE && !cornered) setState(memory, "fallback", snapshot.tick);
  } else if (memory.state === "fallback") {
    if (snapshot.tick - memory.since >= FALLBACK_TICKS && odds >= nerve) setState(memory, "fight", snapshot.tick);
  } else if (odds >= nerve || cornered) setState(memory, "fight", snapshot.tick);
  else setState(memory, "fallback", snapshot.tick);

  const commands: GameCommand[] = [...skillSwitches(squad, options)];
  if (memory.state === "fallback") {
    delete memory.focusId;
    commands.push(...moveAll(squad, retreat, "move"));
  } else if (memory.state === "fight") {
    commands.push(...fight(snapshot, squad, foes, retreat, memory, intent));
  } else {
    delete memory.focusId;
    const spread = Math.max(...squad.map((unit) => distance(unit, center)));
    commands.push(...moveAll(squad, spread > SPREAD ? center : anchor, "attackMove"));
  }
  const focusId = memory.focusId;
  return { commands, report: { state: memory.state, own: assessment.own, foes: assessment.foeStrength, odds, alive: squad.length, anchor, ...(focusId ? { focusId } : {}) } };
}

export type SquadAssessment = { own: number; foeStrength: number; odds: number; foes: Unit[]; towers: Building[] };

// The squad against the foes within `vision` of `around` (the squad's middle by default) and anyone already fighting it,
// towers included.
export function assessSquad(snapshot: GameSnapshot, owner: PlayerId, squad: readonly Unit[], options: SquadOptions & { around?: Point } = {}): SquadAssessment {
  const vision = options.vision ?? DEFAULT_VISION;
  const around = options.around ?? averagePoint([...squad]);
  const isFoe = options.isFoe ?? defaultFoe(snapshot, owner, squad);
  const ids = new Set(squad.map((unit) => unit.id));
  const foes = snapshot.units.filter((unit) => unit.hp > 0 && isFoe(unit) && (distance(unit, around) <= vision || targets(unit, ids)));
  const towers = snapshot.buildings.filter((building) => building.complete && building.attackDamage > 0 && building.owner !== owner && hostileOwner(snapshot, owner, building.owner) && distance(building, around) <= vision);
  const own = squad.reduce((total, unit) => total + combatRating(unit), 0);
  const foeStrength = foes.reduce((total, unit) => total + combatRating(unit), 0) + towers.reduce((total, tower) => total + structureRating(tower), 0);
  return { own, foeStrength, odds: foeStrength > 0 ? own / foeStrength : Number.POSITIVE_INFINITY, foes, towers };
}

function setState(memory: SquadMemory, state: SquadState, tick: number) {
  if (memory.state === state) return;
  memory.state = state;
  memory.since = tick;
}

// Where the squad is going, or standing, for its intent.
function anchorOf(snapshot: GameSnapshot, intent: SquadIntent, memory: SquadMemory, center: Point): Point {
  if (intent.kind === "hold" || intent.kind === "attack") return intent.at;
  if (intent.kind === "escort") {
    const ward = snapshot.units.find((unit) => unit.id === intent.unitId);
    return ward ? { x: ward.x, y: ward.y } : center;
  }
  if (intent.kind === "hunt") {
    const prey = snapshot.units.filter((unit) => intent.targetIds.includes(unit.id) && unit.hp > 0);
    return prey.sort((a, b) => distance(a, center) - distance(b, center))[0] ?? center;
  }
  if (intent.route.length === 0) return center;
  let index = (memory.waypoint ?? 0) % intent.route.length;
  if (distance(center, intent.route[index]!) <= WAYPOINT_REACHED) index = (index + 1) % intent.route.length;
  memory.waypoint = index;
  return intent.route[index]!;
}

// How far from its fight center the squad takes foes on: a holding, patrolling or escorting squad only those within its
// leash (it lets the rest walk by), an attacking or hunting one everything it sees.
function reachOf(intent: SquadIntent, options: SquadOptions) {
  if (intent.kind === "hold" || intent.kind === "patrol") return intent.leash ?? DEFAULT_LEASH;
  if (intent.kind === "escort") return intent.leash ?? ESCORT_LEASH;
  return options.vision ?? DEFAULT_VISION;
}

// A holding or escorting squad weighs the foes around what it guards; the others the foes around themselves.
function fightCenter(intent: SquadIntent, anchor: Point, center: Point): Point {
  return intent.kind === "hold" || intent.kind === "escort" ? anchor : center;
}

function defaultFoe(snapshot: GameSnapshot, owner: PlayerId, squad: readonly Unit[]) {
  const ids = new Set(squad.map((unit) => unit.id));
  return (unit: Unit) => {
    if (unit.owner === "neutral") return targets(unit, ids);
    return unit.owner !== owner && hostileOwner(snapshot, owner, unit.owner);
  };
}

function hostileOwner(snapshot: GameSnapshot, owner: PlayerId, other: string) {
  if (other === owner) return false;
  if (other === "neutral") return true;
  const teams = snapshot.teams ?? {};
  const mine = teams[owner] ?? owner;
  const theirs = teams[other as PlayerId] ?? other;
  return mine !== theirs;
}

function targets(unit: Unit, ids: ReadonlySet<string>) {
  const order = unit.order as { type: string; targetId?: string };
  return order.targetId !== undefined && ids.has(order.targetId);
}

// Every ability that can autocast is switched on (unless the caller keeps its own switches).
function skillSwitches(squad: readonly Unit[], options: SquadOptions): GameCommand[] {
  if (options.skills === "leave") return [];
  const off = new Map<AbilityKind, string[]>();
  for (const unit of squad) {
    for (const ability of UNIT_DEFS[unit.kind].abilities) {
      if (!canAutocast(ability) || autocastEnabled(unit, ability)) continue;
      off.set(ability, [...(off.get(ability) ?? []), unit.id]);
    }
  }
  return [...off].map(([ability, unitIds]): GameCommand => ({ type: "setAutocast", unitIds, ability, enabled: true }));
}

function fight(snapshot: GameSnapshot, squad: readonly Unit[], foes: readonly Unit[], retreat: Point, memory: SquadMemory, intent: SquadIntent): GameCommand[] {
  const commands: GameCommand[] = [];
  // The badly wounded step back while the rest fight on (a unit that dies with its blow unspent helps nobody).
  const wounded = squad.length > 2 ? squad.filter((unit) => unit.hp < unit.maxHp * WOUNDED_SHARE && unit.expiresTick === undefined) : [];
  commands.push(...moveAll(wounded, retreat, "move"));
  const fighters = squad.filter((unit) => !wounded.includes(unit) && unit.order.type !== "charge");
  const target = focusTarget(foes, fighters, memory, intent);
  if (!target) return commands;
  memory.focusId = target.id;
  const onFocus: string[] = [];
  const nearest = new Map<string, string[]>();
  for (const unit of fighters) {
    const current = (unit.order as { targetId?: string }).targetId;
    if (unit.attackRange > RANGED || distance(unit, target) <= MELEE_REACH + unit.attackRange) {
      if (!(unit.order.type === "attack" && current === target.id)) onFocus.push(unit.id);
      continue;
    }
    // A melee unit far from the focus fights what is in front of it.
    const near = [...foes].sort((a, b) => distance(a, unit) - distance(b, unit))[0]!;
    if (unit.order.type === "attack" && current === near.id) continue;
    nearest.set(near.id, [...(nearest.get(near.id) ?? []), unit.id]);
  }
  if (onFocus.length > 0) commands.push({ type: "attack", unitIds: onFocus, targetId: target.id });
  for (const [targetId, unitIds] of nearest) commands.push({ type: "attack", unitIds, targetId });
  return commands;
}

// The foe the squad kills first: the one whose death takes the most damage off the squad for the least work, a caster
// or healer a little ahead of its worth, and the one already under fire while it stays in reach. A hunting squad
// only ever picks its prey while any is in sight.
function focusTarget(foes: readonly Unit[], fighters: readonly Unit[], memory: SquadMemory, intent: SquadIntent): Unit | undefined {
  if (fighters.length === 0) return undefined;
  const center = averagePoint([...fighters]);
  const prey = intent.kind === "hunt" ? foes.filter((unit) => intent.targetIds.includes(unit.id)) : [];
  const pool = prey.length > 0 ? prey : foes;
  const kept = pool.find((unit) => unit.id === memory.focusId);
  if (kept && distance(kept, center) <= DEFAULT_VISION) return kept;
  return [...pool].sort((a, b) => targetScore(b, center) - targetScore(a, center))[0];
}

function targetScore(unit: Unit, center: Point) {
  const dps = unit.attackDamage / Math.max(1, unit.attackCooldown / 20);
  const caster = UNIT_DEFS[unit.kind].abilities.length > 0 ? 1.5 : 1;
  return ((dps * caster) / Math.max(1, unit.hp)) * 100 - distance(unit, center) / 200;
}

function moveAll(units: readonly Unit[], point: Point, type: "move" | "attackMove"): GameCommand[] {
  const walking = units.filter((unit) => {
    const order = unit.order as { type: string; x?: number; y?: number };
    if (distance(unit, point) <= ORDER_SLACK && (unit.order.type === "idle" || type === "attackMove")) return false;
    return !(order.type === type && order.x !== undefined && order.y !== undefined && distance({ x: order.x, y: order.y }, point) <= ORDER_SLACK);
  });
  return walking.length > 0 ? [{ type, unitIds: walking.map((unit) => unit.id), x: point.x, y: point.y }] : [];
}
