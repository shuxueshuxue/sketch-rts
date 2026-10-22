import type { SdkGameCommandPlanner } from '../../../../sdk/game-runner';
import { UNIT_DEFS } from '../../../../shared/catalog';
import { observeSimulation } from '../../../../shared/sim';
import type { SimulationDamageEvent, SimulationKillEvent, SimulationRemovalEvent } from '../../../../shared/sim/observation';
import type { GameCommand, Unit } from '../../../../shared/types';
import type { DisruptionCase, DisruptionWorld } from './scenes';

type Trigger = { tick: number; targetId: string; point: { x: number; y: number }; passengerIds: string[]; rule: string };
export type InterferenceRecord = {
  trigger: Trigger | null; firstCampDamageTick: number | null;
  loss: { tick: number; targetId: string; point: { x: number; y: number }; actualKill: SimulationKillEvent | null } | null;
  damage: SimulationDamageEvent[]; kills: SimulationKillEvent[]; removed: SimulationRemovalEvent[];
  commands: { tick: number; command: GameCommand }[];
};
/** A fixed opponent policy. It only submits native commands, and never mutates
 * entities or invokes the owner's planner/ledger. All triggers read the world. */
export function createInterference(puzzle: DisruptionCase, world: DisruptionWorld,
  record: (kind: string, value: unknown) => void = () => {}) {
  const { game, opponent, owner } = world;
  const original = world.transport && { x: world.transport.x, y: world.transport.y };
  const originalArmy = new Set(world.mainForce), attackers = new Set(world.interceptors);
  const camp = new Set(world.guards.map(u => u.id));
  const state: InterferenceRecord = { trigger: null, firstCampDamageTick: null, loss: null,
    damage: [], kills: [], removed: [], commands: [] };
  const active = () => game.units.filter(u => attackers.has(u.id) && u.hp > 0);
  const carriedBy = (u: Unit, id: string) => u.deck?.shipId === id || u.cabin?.shipId === id;
  const stop = observeSimulation(game, {
    damage(e) {
      if (originalArmy.has(e.source.id) && camp.has(e.target.id) && e.damage > 0 && state.firstCampDamageTick === null)
        state.firstCampDamageTick = e.tick;
      if (attackers.has(e.source.id) || attackers.has(e.target.id)) { state.damage.push(e); record('damage', e); }
    },
    kill(e) { if (attackers.has(e.source.id) || e.unit.id === state.trigger?.targetId) {
      state.kills.push(e); record('kill', e);
    } },
    removed(e) {
      if (e.unit.owner === owner || attackers.has(e.unit.id)) { state.removed.push(e); record('removed', e); }
      if (e.unit.id === state.trigger?.targetId && e.reason === 'death') {
        state.loss = { tick: e.tick, targetId: e.unit.id, point: { x: e.unit.x, y: e.unit.y },
          actualKill: state.kills.find(k => k.unit.id === e.unit.id) ?? null };
        record('confirmed-victim-loss', state.loss);
      }
    },
  });
  function chooseTrigger() {
    if (state.trigger || !active().length) return;
    let victim: Unit | undefined;
    if (puzzle.key === 'transport-sunk') {
      const ship = world.transport;
      if (!ship || !game.units.includes(ship) || !original || Math.hypot(ship.x - original.x, ship.y - original.y) < 128) return;
      const aboard = game.units.filter(u => carriedBy(u, ship.id));
      const towardEmbark = Math.hypot(ship.x - world.departure.x, ship.y - world.departure.y)
        < Math.hypot(original.x - world.departure.x, original.y - world.departure.y) - 96;
      if (puzzle.variant === 'empty' ? !aboard.length && towardEmbark : aboard.some(u => originalArmy.has(u.id))) victim = ship;
    } else if (puzzle.key === 'worker-ambush') {
      victim = game.units.filter(u => u.owner === owner && u.kind === 'worker' && u.hp > 0 && !u.deck && !u.cabin)
        .find(u => world.road && Math.abs(u.x - world.road.x) <= 160 && u.y >= 704 && u.y <= 896);
    } else if (state.firstCampDamageTick !== null) {
      victim = game.units.filter(u => u.owner === owner && u.kind === 'worker' && u.hp > 0 && !u.deck && !u.cabin)
        .sort((a, b) => Math.hypot(a.x - world.home.x, a.y - world.home.y) - Math.hypot(b.x - world.home.x, b.y - world.home.y))[0];
    }
    if (victim) {
      state.trigger = { tick: game.tick, targetId: victim.id, point: { x: victim.x, y: victim.y },
        passengerIds: game.units.filter(u => carriedBy(u, victim.id)).map(u => u.id), rule: puzzle.triggerRule };
      record('trigger', state.trigger);
    }
  }
  const planner: SdkGameCommandPlanner = context => {
    if (context.owner !== opponent) return [];
    chooseTrigger();
    if (!state.trigger) return [];
    const commands: GameCommand[] = [];
    let victim = game.units.find(u => u.id === state.trigger!.targetId && u.hp > 0);
    if (puzzle.key === 'small-harassment' && !victim) victim = game.units.find(u => u.owner === owner && u.kind === 'worker' && u.hp > 0);
    if (victim) {
      const ready = active().filter(u => u.order.type !== 'attack' || u.order.targetId !== victim!.id);
      if (ready.length) commands.push({ type: 'attack', unitIds: ready.map(u => u.id), targetId: victim.id });
    } else {
      const target = puzzle.key === 'worker-ambush' && puzzle.variant === 'withdraw' ? world.retreat
        : state.loss?.point ?? state.trigger.point;
      for (const u of active()) {
        if (Math.hypot(u.x - target.x, u.y - target.y) > 64) {
          if (u.order.type !== 'move' || u.order.x !== target.x || u.order.y !== target.y)
            commands.push({ type: 'move', unitIds: [u.id], ...target });
        } else if (u.order.type !== 'hold') commands.push({ type: 'holdPosition', unitIds: [u.id] });
      }
    }
    for (const command of commands) { const e = { tick: game.tick, command }; state.commands.push(e); record('opponent-proposal', e); }
    return commands.map(command => ({ playerId: opponent, source: context.source, scriptId: 'fixed-world-triggered-opponent', command }));
  };
  return { planner, state, dispose: stop,
    originalArmyIds: [...originalArmy], liveInterceptors: active,
    liveOwnerTransports() { return game.units.filter(u => u.owner === owner && u.kind === 'transport' && u.hp > 0); },
    liveMainlandCombat() { return game.units.filter(u => u.owner === owner && u.hp > 0 && u.kind !== 'worker'
      && !UNIT_DEFS[u.kind].naval && u.x < 1600 && !u.deck && !u.cabin); } };
}
