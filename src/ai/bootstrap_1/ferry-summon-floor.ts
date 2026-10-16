import { abilityCooldown } from '../../shared/ability-cooldowns';
import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { boardUnit, deckLoad, deckPlacement, deckPointFits } from '../../shared/decks';
import { bodyMass } from '../../shared/physical-body';
import { circleInPolygon, shipPassengers, shipProfile, worldToLocal } from '../../shared/ship-geometry';
import { checkCommandLegality } from '../../shared/sim/command-validation';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { PresetAiPolicyOptions } from '../policy/types';

/** A real requested shore crew keeps its physical floor while later spells publish. */
export function preserveFerryBoardingFloor(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions, commands: GameCommand[]): GameCommand[] {
  const states = new Map<string, { actual: Unit[]; reserved: Unit[] }>();
  for (const ship of snapshot.units) {
    if (ship.owner !== owner || ship.hp <= 0 || !shipProfile(ship)) continue;
    const mission = options.memory?.naval?.ferries?.[ship.id];
    const requested = new Set(mission?.phase === 'loading' ? mission.crewIds : []);
    const waiting = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0 && !unit.deck && unit.expiresTick === undefined
      && (unit.order.type === 'board' ? unit.order.transportId === ship.id : requested.has(unit.id)));
    if (!waiting.length) continue;
    const actual = shipPassengers(snapshot.units, ship), reserved = [...actual];
    let admitted = false;
    for (const unit of waiting) {
      const copy = { ...unit };
      if (boardUnit(ship, copy, reserved)) { reserved.push(copy); admitted = true; }
    }
    if (admitted) states.set(ship.id, { actual: [...actual], reserved });
  }
  if (!states.size) return commands;
  const ids = new Set(snapshot.units.map(unit => unit.id));
  let serial = 0;
  const accepted = commands.filter(command => {
    if (command.type !== 'cast' || command.queued || command.x === undefined || command.y === undefined) return true;
    const definition = ABILITY_DEFS[command.ability];
    if (definition.behavior !== 'summon') return true;
    const caster = snapshot.units.find(unit => unit.id === command.unitId && unit.owner === owner);
    if (!caster || abilityCooldown(caster, command.ability) > 0 || checkCommandLegality(snapshot, owner, command)
      || Math.hypot(caster.x - command.x, caster.y - command.y) > definition.range) return true;
    const at = { x: command.x, y: command.y };
    const ship = snapshot.units.find(unit => unit.owner === caster.owner && shipProfile(unit)
      && circleInPolygon(worldToLocal(unit, at), 0, shipProfile(unit)!.deck));
    const state = ship && states.get(ship.id);
    if (!ship || !state) return true;
    const stats = UNIT_DEFS[definition.summonKind];
    let id: string;
    do { id = `summon-floor-projection-${serial++}`; } while (ids.has(id));
    ids.add(id);
    // A detached footprint/body projection; no unit factory, Game or ID allocator is called.
    const probe: Unit = { ...caster, id, kind: definition.summonKind, ...at,
      hp: stats.hp, maxHp: stats.hp, radius: stats.radius, bodyRadius: stats.radius,
      gearMass: 0, deck: undefined, cabin: undefined };
    const point = deckPlacement(ship, probe, state.actual, worldToLocal(ship, at));
    const capacity = shipProfile(ship)!.loadCapacity, mass = bodyMass(probe);
    // Preserve attempts that already have no native floor or native payload; they add no projected occupant.
    if (!point || state.actual.reduce((sum, unit) => sum + bodyMass(unit), mass) > capacity) return true;
    if (!deckPointFits(ship, probe, point, state.reserved) || deckLoad(state.reserved, ship) + mass > capacity) return false;
    const placed = { ...probe, deck: { shipId: ship.id, ...point } };
    state.actual.push(placed); state.reserved.push(placed);
    return true;
  });
  return accepted.length === commands.length ? commands : accepted;
}
