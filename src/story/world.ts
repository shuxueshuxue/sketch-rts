import { createSquadMemory, planSquad, type SquadIntent, type SquadOptions, type SquadReport } from "../ai/squad/squad";
import { createBuilding } from "../shared/map";
import { canReceiveHealing } from "../shared/healing";
import { resolveVariant, type UnitVariantDef, type VariantRules } from "../shared/catalog";
import { addWorldEffect, issuePlayerCommand, refreshUnitStats, removeUnit, spawnVariantUnit, strikeUnit, type Game } from "../shared/sim";
import type { Building, BuildingKind, GameCommand, Owner, PlayerId, Unit, UnitKind, UnitOrder, WorldEffect } from "../shared/types";
import type { CastBook, CastMember } from "./cast";
import { ensure, spawn, type Operation, type Task } from "./kernel";
import { until, wait } from "./ops";
import { distance, ring, type Point, type Region } from "./region";
import type { Stage } from "./stage";
import { seconds, type Duration } from "./time";

// @@@story-world - What a story script may do to the world: a capability object, handed to the story and to nobody else
// (the player's side gets only commands; see director). Reading is plain (units, distances, regions); changing goes
// through the sim's own doors (commands for orders, the story hooks for everything a player cannot do), so a script
// never leaves the game in a state the sim could not have reached by itself.

export type Who = Unit | string;
export type UnitFilter = { owner?: Owner | readonly Owner[]; variant?: string | readonly string[]; kind?: UnitKind | readonly UnitKind[]; within?: { at: Point; radius: number }; in?: Region };

export type Squad = {
  readonly task: Task<never>;
  intent: SquadIntent;
  options: SquadOptions;
  // The latest think's read of the fight (see ai/squad): odds, state, who it focuses.
  readonly report: SquadReport | undefined;
  readonly unitIds: string[];
  alive(): Unit[];
  add(...units: Unit[]): void;
  // Waits until every unit of the squad has fallen (or left). The brain lives in the task that started the squad, so a
  // task that hands a band its orders and has nothing else to do waits here: returning would halt the brain with it.
  defeated(): Operation<void>;
};

export class World {
  constructor(
    readonly game: Game,
    readonly stage: Stage,
    readonly cast: CastBook,
    private readonly random: () => number,
  ) {}

  get tick() {
    return this.game.tick;
  }

  // ---- Reading.

  unit(who: Who): Unit | undefined {
    const id = typeof who === "string" ? who : who.id;
    return this.game.units.find((unit) => unit.id === id && unit.hp > 0);
  }

  alive(who: Who): boolean {
    return this.unit(who) !== undefined;
  }

  units(filter: UnitFilter = {}): Unit[] {
    return this.game.units.filter((unit) => unit.hp > 0 && fits(unit, filter));
  }

  buildings(owner?: PlayerId, kind?: BuildingKind): Building[] {
    return this.game.buildings.filter((building) => (owner === undefined || building.owner === owner) && (kind === undefined || building.kind === kind));
  }

  // Whether two sides fight: different teams, or anyone against the wild.
  hostile(a: Owner, b: Owner): boolean {
    if (a === b) return false;
    if (a === "neutral" || b === "neutral") return true;
    return (this.game.teams[a] ?? a) !== (this.game.teams[b] ?? b);
  }

  // The living foes (or friends, the unit itself left out) of a unit within a distance of a point (the unit, by default).
  foesOf(who: Unit, radius: number, around: Point = who): Unit[] {
    return this.game.units.filter((unit) => unit.hp > 0 && this.hostile(who.owner, unit.owner) && distance(unit, around) <= radius);
  }

  alliesOf(who: Unit, radius: number, around: Point = who): Unit[] {
    return this.game.units.filter((unit) => unit.hp > 0 && unit.id !== who.id && !this.hostile(who.owner, unit.owner) && distance(unit, around) <= radius);
  }

  inside(who: Who, region: Region): boolean {
    const unit = this.unit(who);
    return unit !== undefined && region.contains(unit);
  }

  distance(a: Who | Point, b: Who | Point): number {
    const from = this.pointOf(a);
    const to = this.pointOf(b);
    return from && to ? distance(from, to) : Number.POSITIVE_INFINITY;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Nothing to pick from");
    return items[Math.floor(this.random() * items.length)]!;
  }

  roll(): number {
    return this.random();
  }

  // ---- Who is on the field.

  // Brings a campaign unit (or a catalog unit) onto the field.
  spawn(member: CastMember | UnitKind, owner: Owner, at: Point, options: { id?: string; order?: UnitOrder; hpShare?: number } = {}): Unit {
    const unit =
      typeof member === "string"
        ? this.spawnKind(member, owner, at, options.id)
        : spawnVariantUnit(this.game, owner, this.memberRules(member), at.x, at.y, options.id);
    if (options.order) unit.order = { ...options.order };
    if (options.hpShare !== undefined) unit.hp = Math.max(1, Math.round(unit.maxHp * options.hpShare));
    if (typeof member !== "string" && member.color) this.stage.cast(unit, { name: member.name, color: member.color });
    return unit;
  }

  // A group of the same unit gathered around a point.
  spawnGroup(member: CastMember | UnitKind, owner: Owner, at: Point, count: number, options: { spread?: number; order?: UnitOrder } = {}): Unit[] {
    const spread = options.spread ?? 30 * Math.sqrt(count);
    return Array.from({ length: count }, (_, index) => this.spawn(member, owner, ring(at, spread, index, count), options.order ? { order: options.order } : {}));
  }

  // Units that leave the stage (quietly, not dying) when the current task ends: a scene's extras.
  *extras(member: CastMember | UnitKind, owner: Owner, at: Point, count: number, options: { spread?: number; order?: UnitOrder } = {}): Operation<Unit[]> {
    const units = this.spawnGroup(member, owner, at, count, options);
    yield* ensure(() => units.forEach((unit) => removeUnit(this.game, unit.id)));
    return units;
  }

  building(kind: BuildingKind, owner: PlayerId, at: Point, options: { id?: string; complete?: boolean; hpShare?: number } = {}): Building {
    const id = options.id ?? `building-${owner}-${kind}-${this.game.nextId++}`;
    const building = createBuilding(id, owner, kind, at.x, at.y, options.complete ?? true);
    if (options.hpShare !== undefined) building.hp = Math.max(1, Math.round(building.maxHp * options.hpShare));
    this.game.buildings.push(building);
    return building;
  }

  remove(who: Who) {
    const unit = this.unit(who);
    if (unit) removeUnit(this.game, unit.id);
  }

  removeBuilding(building: Building) {
    this.game.buildings = this.game.buildings.filter((candidate) => candidate.id !== building.id);
  }

  // Sets a unit down somewhere else (between scenes: "three days later, at the ford").
  place(who: Who, at: Point) {
    const unit = this.unit(who);
    if (!unit) return;
    unit.x = at.x;
    unit.y = at.y;
    unit.homeX = at.x;
    unit.homeY = at.y;
    unit.order = { type: "idle" };
    unit.orderQueue = [];
  }

  // ---- Orders (through the sim's commands, as the unit's owner would give them).

  order(units: readonly Who[], command: (unitIds: string[]) => GameCommand) {
    const byOwner = new Map<PlayerId, string[]>();
    for (const who of units) {
      const unit = this.unit(who);
      if (!unit || unit.owner === "neutral") continue;
      byOwner.set(unit.owner, [...(byOwner.get(unit.owner) ?? []), unit.id]);
    }
    for (const [owner, unitIds] of byOwner) issuePlayerCommand(this.game, owner, command(unitIds));
  }

  move(units: readonly Who[], to: Point) {
    this.order(units, (unitIds) => ({ type: "move", unitIds, x: to.x, y: to.y }));
  }

  attackMove(units: readonly Who[], to: Point) {
    this.order(units, (unitIds) => ({ type: "attackMove", unitIds, x: to.x, y: to.y }));
  }

  attack(units: readonly Who[], target: Who | Building) {
    const id = typeof target === "string" ? target : target.id;
    this.order(units, (unitIds) => ({ type: "attack", unitIds, targetId: id }));
  }

  // Walks a group to a place in formation and waits until they are all there (or gone).
  *walk(units: readonly Who[], to: Point, options: { spread?: number; limit?: Duration } = {}): Operation<void> {
    const live = units.map((who) => this.unit(who)).filter((unit): unit is Unit => unit !== undefined);
    live.forEach((unit, index) => this.move([unit], ring(to, options.spread ?? 24 * Math.sqrt(live.length), index, live.length)));
    const deadline = this.tick + (options.limit ?? seconds(60));
    yield* until(() => this.tick >= deadline || live.every((unit) => !this.alive(unit) || unit.order.type === "idle"));
  }

  // ---- Powers of the story's own.

  strike(source: Unit | Building | { id: string; owner: PlayerId; x: number; y: number }, target: Who | Building, damage: number, style: "melee" | "ranged" | "spell" = "spell") {
    const victim = typeof target === "string" ? this.unit(target) : "order" in target ? this.unit(target) : target;
    if (!victim || victim.hp <= 0) return;
    strikeUnit(this.game, source, victim, damage, style);
  }

  heal(who: Who, amount: number, options: { effect?: boolean } = {}) {
    const unit = this.unit(who);
    if (!unit || !canReceiveHealing(unit, this.game)) return;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    if (options.effect ?? true) this.effect("heal", unit, seconds(1.6));
  }

  effect(type: WorldEffect["type"], at: Point, span: Duration, vectors?: Parameters<typeof addWorldEffect>[5]) {
    addWorldEffect(this.game, type, at.x, at.y, Math.max(1, span), vectors);
  }

  // A status on a unit for a while: guardian (takes no damage), curse (weakened blows) or scorch.
  afflict(who: Who, type: "curse" | "guardian" | "scorch", span: Duration, damageMultiplier?: number) {
    const unit = this.unit(who);
    if (!unit) return;
    unit.effects = unit.effects.filter((effect) => effect.type !== type);
    unit.effects.push({ type, remaining: Math.max(1, span), ...(damageMultiplier !== undefined ? { damageMultiplier } : {}) });
  }

  gold(owner: PlayerId, delta: number) {
    const player = this.game.players[owner];
    if (!player) throw new Error(`Unknown player ${owner}`);
    player.gold = Math.max(0, player.gold + delta);
  }

  grantXp(who: Who, amount: number) {
    const unit = this.unit(who);
    if (unit) unit.xp += amount;
  }

  // ---- Rules the story rewrites (a hero's growth; see rpg).

  rules(variant: string): VariantRules {
    const rules = this.game.variants?.[variant];
    if (!rules) throw new Error(`Unknown unit variant ${variant}`);
    return rules;
  }

  // Replaces a variant's rules and re-derives every unit that plays by them.
  rewrite(variant: string, def: UnitVariantDef) {
    if (!this.game.variants) throw new Error("This game has no campaign units");
    this.game.variants[variant] = resolveVariant(def);
    for (const unit of this.game.units) if (unit.variant === variant) refreshUnitStats(this.game, unit);
  }

  // ---- Behaviour.

  // Hands units to the squad brain (ai/squad) for as long as the current task runs: every `think` it weighs the fight
  // and gives the orders a careful player would for its intent. The intent and options can be changed at any time.
  *squad(owner: PlayerId, units: readonly Unit[], intent: SquadIntent, options: SquadOptions & { think?: Duration } = {}): Operation<Squad> {
    const unitIds = units.map((unit) => unit.id);
    const memory = createSquadMemory();
    const world = this;
    let report: SquadReport | undefined;
    const think = options.think ?? seconds(0.5);
    const handle = {
      intent,
      options,
      unitIds,
      get report() {
        return report;
      },
      alive: () => unitIds.map((id) => world.unit(id)).filter((unit): unit is Unit => unit !== undefined),
      add: (...more: Unit[]) => void unitIds.push(...more.map((unit) => unit.id)),
      *defeated() {
        yield* until(() => unitIds.every((id) => !world.alive(id)));
      },
    } as Omit<Squad, "task"> & { task?: Task<never> };
    handle.task = yield* spawn(function* squadBrain(): Operation<never> {
      for (;;) {
        const live = unitIds.filter((id) => world.alive(id));
        if (live.length > 0) {
          const plan = planSquad(world.game, owner, live, handle.intent, memory, handle.options);
          report = plan.report;
          for (const command of plan.commands) issuePlayerCommand(world.game, owner, command);
        }
        yield* wait(think);
      }
    }, `squad:${owner}`);
    return handle as Squad;
  }

  // Runs `body` for as long as the unit lives: when it falls (or leaves), the body is halted, and with it whatever the
  // body started. A unit's powers, a boss's phases, a companion's banter all live this way.
  *life(who: Who, body: (unit: Unit) => Operation<void>, label = "life"): Operation<Task<void>> {
    const unit = this.unit(who);
    const world = this;
    return yield* spawn(function* lifetime(): Operation<void> {
      if (!unit) return;
      const task = yield* spawn(() => body(unit), label);
      yield* until(() => !world.alive(unit) || task.state !== "running");
      task.halt();
    }, label);
  }

  // A catalog unit takes the game's own next id; a unit the story names is a cast member.
  private spawnKind(kind: UnitKind, owner: Owner, at: Point, id: string | undefined): Unit {
    if (id !== undefined) throw new Error(`Only cast members take a chosen id (${id}); a ${kind} takes the game's next`);
    return this.game.spawnUnit(owner, kind, at.x, at.y);
  }

  private memberRules(member: CastMember): string {
    if (!this.game.variants?.[member.id]) throw new Error(`${member.id} is not enlisted in this game (see cast.enlist)`);
    return member.id;
  }

  private pointOf(value: Who | Point): Point | undefined {
    if (typeof value === "string") return this.unit(value);
    return value;
  }
}

function fits(unit: Unit, filter: UnitFilter): boolean {
  if (filter.owner !== undefined && !(typeof filter.owner === "string" ? unit.owner === filter.owner : filter.owner.includes(unit.owner))) return false;
  if (filter.variant !== undefined && !(typeof filter.variant === "string" ? unit.variant === filter.variant : unit.variant !== undefined && filter.variant.includes(unit.variant))) return false;
  if (filter.kind !== undefined && !(typeof filter.kind === "string" ? unit.kind === filter.kind : filter.kind.includes(unit.kind))) return false;
  if (filter.within && distance(unit, filter.within.at) > filter.within.radius) return false;
  if (filter.in && !filter.in.contains(unit)) return false;
  return true;
}
