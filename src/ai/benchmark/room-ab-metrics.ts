import { unitMover, UNIT_DEFS } from '../../shared/catalog';
import { observeSimulation, type Game } from '../../shared/sim';
import { groundWholeAt } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, Unit } from '../../shared/types';
import type { AiDeathThinkContext } from '../death-ledger-context';
import type { AiDeathTask } from '../death-ledger-types';

export type Clearing = { owner: string; id: string; mineId: string; memberIds: string[]; unitIds: string[];
  start: number | null; complete: number | null; otherActors: string[] };
type Response = { owner: string; buildingId: string; start: number; lastDamage: number; arrival: number | null;
  ended: number | null; endReason: 'arrived' | 'destroyed' | 'quiet' | 'match-end' | null };
export type RoomSeatMetrics = {
  idleArmyUnitSeconds: number; armyUnitSeconds: number; abaSwitches: number;
  pressureSeconds: number; observedSeconds: number;
  firstExpansion: number | null; firstIslandClearStart: number | null; firstIslandClearComplete: number | null;
  firstEnemySortie: number | null;
  completed: { expansions: number; islandSettlements: number; islandClears: number; enemyMiningHalls: number };
  completedBy15m: { expansions: number; islandSettlements: number; islandClears: number; enemyMiningHalls: number };
  sitesDestroyed: number; sitesDestroyedWithArmyElsewhere: number;
  preemptions: null; preemptionReasons: null;
  buildingPresenceSeconds: number; hasBuildings: boolean; lastBuildingLossTick: number | null; revivals: number;
};
const army = (unit: Pick<Unit, 'kind'>) => unit.kind !== 'worker' && (UNIT_DEFS[unit.kind].attackDamage > 0 || UNIT_DEFS[unit.kind].abilities.length > 0);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const empty = (): RoomSeatMetrics => ({ idleArmyUnitSeconds: 0, armyUnitSeconds: 0, abaSwitches: 0,
  pressureSeconds: 0, observedSeconds: 0, firstExpansion: null, firstIslandClearStart: null, firstIslandClearComplete: null,
  firstEnemySortie: null, completed: { expansions: 0, islandSettlements: 0, islandClears: 0, enemyMiningHalls: 0 },
  completedBy15m: { expansions: 0, islandSettlements: 0, islandClears: 0, enemyMiningHalls: 0 }, sitesDestroyed: 0,
  sitesDestroyedWithArmyElsewhere: 0, preemptions: null, preemptionReasons: null, buildingPresenceSeconds: 0,
  hasBuildings: true, lastBuildingLossTick: null, revivals: 0 });

/** Versioned, read-only behavioural measurements. Cohorts never affect the simulation or this observer. */
export class RoomAbMetrics {
  readonly seats: Record<string, RoomSeatMetrics>;
  readonly clearings = new Map<string, Clearing>();
  readonly responses: Response[] = [];
  readonly events: unknown[] = [];
  readonly errors: string[] = [];
  private readonly contexts = new Map<string, AiDeathThinkContext>();
  private readonly taskByUnit = new Map<string, AiDeathTask[]>();
  private readonly histories = new Map<string, string[]>();
  private readonly home = new Map<string, { x: number; y: number }[]>();
  private readonly ground = new Map<string, number | undefined>();
  private readonly completed = new Set<string>();
  private readonly camps: string[][] = [];
  private readonly stop: () => void;
  constructor(private readonly game: Game, owners: readonly string[]) {
    // Freeze original neutral camp membership so deaths cannot split one achievement into several.
    const unseen = new Set(game.units.filter(u => u.owner === 'neutral' && u.attackDamage > 0));
    const home = (u: Unit) => ({ x: u.homeX ?? u.x, y: u.homeY ?? u.y });
    while (unseen.size) {
      const members = [unseen.values().next().value!]; unseen.delete(members[0]!);
      for (let i = 0; i < members.length; i++) for (const other of unseen) if (distance(home(members[i]!), home(other)) <= 300) {
        members.push(other); unseen.delete(other);
      }
      this.camps.push(members.map(u => u.id).sort());
    }
    this.seats = Object.fromEntries(owners.map(owner => [owner, empty()]));
    for (const owner of owners) {
      const halls = game.buildings.filter(b => b.owner === owner && b.kind === 'townHall' && b.complete);
      this.home.set(owner, halls.map(b => ({ x: b.x, y: b.y })));
      this.ground.set(owner, halls[0] ? groundWholeAt(game.map, halls[0], 'land') : undefined);
      this.seats[owner]!.hasBuildings = game.buildings.some(b => b.owner === owner && b.hp > 0);
    }
    for (const b of game.buildings) if (b.complete) this.completed.add(b.id);
    this.stop = observeSimulation(game, { label: 'RoomAbMetrics-v1',
      buildingDamage: event => {
        if (!(event.damage > 0) || event.target.kind !== 'townHall' || !this.seats[event.target.owner]
          || !this.hostile(event.target.owner, event.source.owner, true)) return;
        let response = this.responses.find(r => r.buildingId === event.target.id && r.ended === null);
        if (!response) {
          response = { owner: event.target.owner, buildingId: event.target.id, start: event.tick,
            lastDamage: event.tick, arrival: null, ended: null, endReason: null };
          this.responses.push(response);
        }
        response.lastDamage = event.tick;
        this.respond(response);
      },
      buildingKill: event => {
        const b = event.building, metric = this.seats[b.owner];
        this.events.push({ type: 'building-killed', ...event });
        if (metric && b.kind === 'townHall') {
          metric.sitesDestroyed++;
          const soldiers = this.game.units.filter(u => u.owner === b.owner && u.hp > 0 && army(u));
          if (soldiers.length && !soldiers.some(u => !u.deck && !u.garrison && unitMover(u.kind) !== 'sea' && distance(u, b) <= 650))
            metric.sitesDestroyedWithArmyElsewhere++;
          for (const response of this.responses) if (response.buildingId === b.id && response.ended === null) {
            response.ended = event.tick; response.endReason = 'destroyed';
          }
        }
        if (b.kind === 'townHall' && this.seats[event.source.owner] && this.hostile(event.source.owner, b.owner, false))
          this.goal(event.source.owner, 'enemyMiningHalls', event.tick);
      }, error: error => this.errors.push(String(error)),
    });
  }
  private hostile(owner: string, other: string, neutral: boolean) {
    return owner !== other && (neutral || other !== 'neutral')
      && (this.game.teams[owner] ?? owner) !== (this.game.teams[other] ?? other);
  }
  private goal(owner: string, kind: keyof RoomSeatMetrics['completed'], tick: number) {
    this.seats[owner]!.completed[kind]++;
    if (tick <= 18_000) this.seats[owner]!.completedBy15m[kind]++;
    this.events.push({ type: 'goal-completed', owner, kind, tick });
  }
  recordThink(facts: AiDeathThinkContext) {
    this.contexts.set(facts.owner, facts);
    for (const [id, tasks] of facts.tasks) this.taskByUnit.set(id, tasks);
    // Clear expired membership rather than accidentally retaining a completed claim forever.
    const current = new Map(facts.tasks);
    for (const unit of facts.units) this.taskByUnit.set(unit.id, current.get(unit.id) ?? []);
    for (const [id, tasks] of facts.tasks) {
      const task = tasks[0]; if (!task) continue;
      const history = this.histories.get(id) ?? [];
      if (history.at(-1) !== task.id) {
        if (history.length >= 2 && history.at(-2) === task.id) this.seats[facts.owner]!.abaSwitches++;
        history.push(task.id); if (history.length > 3) history.shift(); this.histories.set(id, history);
      }
      for (const island of tasks) if (island.kind === 'island' && island.targetId && island.clearingTargetIds?.length) {
        const ids = this.camps.find(camp => island.clearingTargetIds!.some(id => camp.includes(id))) ?? [...island.clearingTargetIds].sort();
        const key = `${facts.owner}/${island.targetId}/${ids.join(',')}`;
        let clearing = this.clearings.get(key);
        if (!clearing) { clearing = { owner: facts.owner, id: key, mineId: island.targetId, memberIds: ids,
          unitIds: [], start: null, complete: null, otherActors: [] }; this.clearings.set(key, clearing); }
        if (!clearing.unitIds.includes(id)) clearing.unitIds.push(id);
      }
    }
  }
  recordCommand(tick: number, owner: string, command: GameCommand) {
    const metric = this.seats[owner]; if (!metric) return;
    const ids = 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
    // Camp orders are never enemy sorties, including auto-acquired camp targets at the step boundary.
    const campOrder = command.type === 'attack' && this.game.units.some(u => u.id === command.targetId && u.owner === 'neutral')
      || ids.some(id => this.taskByUnit.get(id)?.some(t => t.clearing));
    if (campOrder) return;
    const context = this.contexts.get(owner), general = context?.general;
    const generalStrike = general?.mode === 'attack' && general.stage !== 'gather' && (command.type === 'attackMove' || command.type === 'attack');
    const buildings = this.game.buildings.filter(b => b.hp > 0 && this.hostile(owner, b.owner, false));
    const direct = command.type === 'attack' && buildings.some(b => b.id === command.targetId)
      || command.type === 'attackMove' && buildings.some(b => distance(b, command) <= 1);
    const assault = ids.some(id => this.taskByUnit.get(id)?.some(t => t.kind === 'transport' && t.stage === 'assault:sailing'
      && buildings.some(b => b.id === t.targetId)) && this.game.units.some(u => u.deck?.shipId === id && u.owner === owner && army(u)));
    if (generalStrike || direct || assault) metric.firstEnemySortie ??= tick;
  }
  private respond(response: Response) {
    if (response.arrival !== null) return;
    const building = this.game.buildings.find(b => b.id === response.buildingId && b.hp > 0);
    if (building && this.game.units.some(u => u.owner === response.owner && u.hp > 0 && army(u)
      && !u.deck && !u.garrison && unitMover(u.kind) !== 'sea' && distance(u, building) <= 650)) {
      response.arrival = this.game.tick;
    }
  }
  step() {
    const game = this.game;
    const soldiers = new Map<string, Unit[]>();
    for (const u of game.units) if (u.hp > 0 && this.seats[u.owner] && army(u)) {
      const list = soldiers.get(u.owner) ?? []; list.push(u); soldiers.set(u.owner, list);
    }
    for (const [owner, metric] of Object.entries(this.seats)) {
      metric.observedSeconds += 1 / 20;
      const has = game.buildings.some(b => b.owner === owner && b.hp > 0);
      if (has) metric.buildingPresenceSeconds += 1 / 20;
      if (metric.hasBuildings && !has) metric.lastBuildingLossTick = game.tick;
      if (!metric.hasBuildings && has) metric.revivals++;
      metric.hasBuildings = has;
      let pressure = false;
      for (const u of soldiers.get(owner) ?? []) {
        metric.armyUnitSeconds += 1 / 20;
        const tasks = this.taskByUnit.get(u.id) ?? [], general = this.contexts.get(owner)?.general;
        const generalAssigned = general?.group?.includes(u.id) && ['attack', 'defend', 'guard', 'creep'].includes(general.mode);
        const physical = ['attack', 'attackMove', 'board', 'garrison', 'repair', 'repairUnit', 'repairShip', 'cast'].includes(u.order.type) || !!u.deck || !!u.garrison;
        if (!tasks.length && !generalAssigned && !physical) metric.idleArmyUnitSeconds += 1 / 20;
        if (tasks.some(t => ['attack', 'raid', 'naval-combat'].includes(t.kind) && !t.clearing && !['defense', 'expansion', 'gather'].includes(t.stage ?? ''))
          || general?.mode === 'attack' && general.group?.includes(u.id)) pressure = true;
      }
      if (pressure) metric.pressureSeconds += 1 / 20;
    }
    for (const b of game.buildings) if (b.complete && b.hp > 0 && !this.completed.has(b.id)) {
      this.completed.add(b.id);
      if (b.kind !== 'townHall' || !this.seats[b.owner] || !this.home.get(b.owner)?.every(home => distance(home, b) > 300)) continue;
      this.seats[b.owner]!.firstExpansion ??= game.tick;
      const island = groundWholeAt(game.map, b, 'land') !== this.ground.get(b.owner);
      this.goal(b.owner, island ? 'islandSettlements' : 'expansions', game.tick);
    }
    for (const clearing of this.clearings.values()) {
      if (clearing.complete !== null) continue;
      // Native orders include automatic target acquisition, not just explicit planner commands.
      const attackers = game.units.filter(u => u.hp > 0 && army(u) && u.order.type === 'attack' && clearing.memberIds.includes(u.order.targetId));
      if (attackers.some(u => u.owner === clearing.owner)) {
        clearing.start ??= game.tick; this.seats[clearing.owner]!.firstIslandClearStart ??= game.tick;
      }
      for (const u of attackers) if (u.owner !== clearing.owner && !clearing.otherActors.includes(u.owner)) clearing.otherActors.push(u.owner);
      if (!game.units.some(u => u.hp > 0 && clearing.memberIds.includes(u.id))) {
        clearing.complete = game.tick;
        if (clearing.start !== null) {
          this.seats[clearing.owner]!.firstIslandClearComplete ??= game.tick;
          this.goal(clearing.owner, 'islandClears', game.tick);
        }
      }
    }
    for (const response of this.responses) if (response.ended === null) {
      this.respond(response);
      if (response.ended === null && game.tick - response.lastDamage >= 300) { response.ended = game.tick; response.endReason = response.arrival === null ? 'quiet' : 'arrived'; }
    }
  }
  finish() {
    for (const response of this.responses) if (response.ended === null) { response.ended = this.game.tick; response.endReason = 'match-end'; }
    this.stop();
    return { version: 1, provenance: 'retained-task-facts-and-native-observation', seats: this.seats,
      clearings: [...this.clearings.values()], responses: this.responses, events: this.events, errors: this.errors };
  }
}
