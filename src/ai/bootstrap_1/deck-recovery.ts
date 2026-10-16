import { resolveUnitDamage, unitAttackDamageProfile } from '../../shared/damage';
import { attackDamageProfile } from '../../shared/damage-types';
import { buildVeteranFrame, temporaryAttackSpeedMultiplier } from '../../shared/veteran-runtime';
import { deckPlacement, deckWalkPathExists } from '../../shared/decks';
import { circleInPolygon, localToWorld, shipProfile, worldToLocal } from '../../shared/ship-geometry';
import { combatHull } from '../../shared/ship-defense';
import { combatCapability } from '../../shared/combat-capabilities';
import { strikeGap } from '../../shared/combat-geometry';
import { canReach } from '../../shared/naval';
import { isInCabin } from '../../shared/ship-cabin';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { pendingDeckBoarding } from '../policy/transfer-lanes';
import { navalServices } from '../policy/naval-services';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiCommandEntry, AiPolicyContext } from '../policy/types';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { NavalPlanMemory } from '../memory';
import { THINK_TICKS } from './mounted-micro';
import { unitAbilities } from '../../shared/unit-abilities';
import { ABILITY_DEFS, SLOW_PACE, unitMover } from '../../shared/catalog';
import { checkCommandLegality } from '../../shared/sim/command-validation';
import { autocastEnabled } from '../../shared/autocast';
import { weaponRules } from '../../shared/equipment';
import { isStaggered } from '../../shared/push';
import { capsuleClearsBodies, capsuleClearsCircles } from '../../shared/navigation-math';

type Post = NonNullable<NavalPlanMemory['deckRecovery']>[string];

function automaticAttack(unit: Unit) {
  return unit.order.type === 'attack' && unit.order.leashX !== undefined && unit.order.leashY !== undefined;
}

function attacking(unit: Unit, targetId: string) {
  return (unit.order.type === 'attack' || unit.order.type === 'attackMove') && unit.order.targetId === targetId;
}

function enabledCharge(unit: Unit) {
  return unitAbilities(unit).some(ability => ABILITY_DEFS[ability].behavior === 'charge' && autocastEnabled(unit, ability));
}

/** Native updateUnits decrements the saved clock before shooting, including the window's last tick. */
export function aimedVolleyCount(window: number, cooldown: number, period: number) {
  const first = Math.max(1, cooldown);
  return window < first ? 0 : 1 + Math.floor((window - first) / Math.max(1, period));
}

/** Live derived speed already contains equipment/veterancy; native statuses scale each deck step. */
export function deckRetreatSpeed(unit: Unit) {
  if (unit.effects.some(effect => effect.type === 'root' || effect.type === 'stun')
    || unit.pushX !== undefined && isStaggered(unit)) return 0;
  return unit.speed * (unit.effects.some(effect => effect.type === 'slow') ? SLOW_PACE : 1);
}

function ownPost(unit: Unit, post: Post) {
  const hold = (order: Unit['order']) => order.type === 'hold' && order.x === post.hold.x && order.y === post.hold.y;
  return unit.order.type === 'hold' && hold(unit.order) && !unit.orderQueue?.length
    || unit.order.type === 'idle' && unit.orderQueue?.length === 1 && hold(unit.orderQueue[0]!)
    || unit.order.type === 'move' && unit.order.deckShipId === post.shipId && !!unit.order.deckPoint
      && distance(unit.order.deckPoint, post.point) < 1e-7
      && unit.orderQueue?.length === 1 && hold(unit.orderQueue[0]!);
}

function enablesCrewCharge(command: GameCommand, unit: Unit): boolean {
  return command.type === 'setAutocast' && command.enabled
    && ABILITY_DEFS[command.ability].behavior === 'charge' && command.unitIds.includes(unit.id);
}

/** A later accepted charge assignment keeps the same priority as deck casualty
 * recovery. Naval's only nonqueued holds on land crew already aboard combat
 * hulls are its coastal withdrawal holds. Hull holds, transfer queues and land
 * recovery posts have separate owners and remain unchanged. */
export function preserveLateCrewCharge(snapshot: GameSnapshot, owner: PlayerId, entries: AiCommandEntry[]): AiCommandEntry[] {
  const switches = entries.flatMap(({ command }, index) => command.type === 'setAutocast' && command.enabled
    && ABILITY_DEFS[command.ability].behavior === 'charge' && !checkCommandLegality(snapshot, owner, command)
    ? [{ command, index }] : []);
  if (!switches.length) return entries;
  const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
  let changed = false;
  const result = entries.flatMap((entry, index): AiCommandEntry[] => {
    const command = entry.command;
    if (entry.scriptId !== 'naval' || command.type !== 'holdPosition' || command.queued) return [entry];
    const unitIds = command.unitIds.filter(id => {
      const unit = units.get(id), ship = unit?.deck && units.get(unit.deck.shipId);
      return !unit || unit.owner !== owner || unitMover(unit.kind) !== 'land' || !ship || !combatHull(ship)
        || !switches.some(next => next.index > index && unitAbilities(unit).includes(next.command.ability)
          && enablesCrewCharge(next.command, unit));
    });
    if (unitIds.length === command.unitIds.length) return [entry];
    changed = true;
    return unitIds.length ? [{ ...entry, command: { ...command, unitIds } }] : [];
  });
  return changed ? result : entries;
}

/** Only order-changing commands preempt this task; equipment/autocast settings do not move a crew member. */
function plannedTask(commands: readonly GameCommand[], unit: Unit, ship: Unit) {
  return commands.some(command => {
    if (command.type === 'setAutocast') return enablesCrewCharge(command, unit);
    if (command.type === 'setStance' || command.type === 'learnVeteranSkill') return false;
    if ('unitId' in command && command.unitId === unit.id) return true;
    if ('unitIds' in command && command.unitIds.includes(unit.id)) return true;
    if (command.type === 'unloadPassenger' && command.passengerId === unit.id) return true;
    if (command.type === 'transferItem' && 'installerId' in command.destination && command.destination.installerId === unit.id) return true;
    return (command.type === 'unload' || command.type === 'boardShip') && command.unitIds.includes(ship.id);
  });
}

/** Exposed auto-chasing combat crew step behind their existing front before a lethal aimed volley.
 * This is a cooldown/protection estimate, not a cloned simulation or a guarantee against retargeting and splash. */
export function combatDeckRecovery(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, planned: GameCommand[]): GameCommand[] {
  if (!options.memory.naval?.deckRecovery && !snapshot.units.some(unit => unit.owner === owner && unit.deck)) return planned;
  const naval = options.memory.naval ??= {};
  const posts = naval.deckRecovery ?? {};
  const release: GameCommand[] = [], orders: GameCommand[] = [];
  const services = navalServices(snapshot, owner, options);
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0);
  const foes = snapshot.units.filter(unit => unit.hp > 0 && isEnemyOwner(snapshot, owner, unit.owner, options));
  const shipFor = (unit: Unit) => own.find(ship => ship.id === unit.deck?.shipId);
  const available = (unit: Unit, ship: Unit) => combatHull(ship) && combatCapability(snapshot, ship).armed
    && !naval.ferries?.[ship.id] && naval.outfit?.shipId !== ship.id
    && !services.reserved.has(ship.id) && !services.reserved.has(unit.id)
    && !ship.sailing?.gangway && ship.order.type !== 'unload' && ship.order.type !== 'boardShip'
    && !ship.orderQueue?.some(order => order.type === 'unload' || order.type === 'boardShip')
    && !unit.gangway && !isInCabin(unit) && !pendingDeckBoarding(unit) && !enabledCharge(unit)
    && !options.memory.mounted?.some(task => task.unitIds.includes(unit.id)) && !plannedTask(planned, unit, ship);

  for (const [id, post] of Object.entries(posts)) {
    const unit = own.find(unit => unit.id === id), ship = unit && shipFor(unit);
    if (!unit || !ownPost(unit, post)) { delete posts[id]; continue; }
    const engagement = ship && foes.some(foe => post.foeIds.includes(foe.id)
      && (naval.combat?.[ship.id]?.targetId === foe.id
        || attacking(foe, ship.id) || own.some(crew => crew.deck?.shipId === ship.id && attacking(foe, crew.id))));
    if (!ship || ship.id !== post.shipId || !available(unit, ship) || !engagement) {
      // Release before ordinary commands so an unload, cast or land assignment remains authoritative.
      release.push({ type: 'stop', unitIds: [id] });
      delete posts[id];
    }
  }

  let veteran: ReturnType<typeof buildVeteranFrame> | undefined;
  const damageTo = (unit: Unit, foe: Unit, amount: number) => resolveUnitDamage(snapshot, unit, amount,
    unitAttackDamageProfile(snapshot, foe), (veteran ??= buildVeteranFrame(snapshot)).get(unit.id)?.reductions).damage;
  for (const unit of own) {
    if (!unit.deck || posts[unit.id] || unit.kind === 'worker' || unit.expiresTick !== undefined
      || !automaticAttack(unit) || unit.orderQueue?.length) continue;
    const ship = shipFor(unit);
    if (!ship || !available(unit, ship) || !naval.combat?.[ship.id]) continue;
    const speed = deckRetreatSpeed(unit);
    if (speed <= 0) continue;
    // Keep native useful fire, including melee against hostile crew on a connected deck.
    if ([...foes, ...snapshot.buildings.filter(building => building.hp > 0 && isEnemyOwner(snapshot, owner, building.owner, options))]
      .some(foe => strikeGap(unit, foe) <= unit.attackRange
      && canReach(snapshot.map, unit, foe, snapshot.units, unit.attackRange))) continue;
    const aimedAt = (target: Unit) => foes.filter(foe => attacking(foe, target.id) && combatCapability(snapshot, foe).armed
      // Mounted batteries have independent gun clocks, not this intrinsic unit clock.
      && !shipProfile(foe)
      && strikeGap(foe, target) <= combatCapability(snapshot, foe).range
      && strikeGap(foe, target) >= (weaponRules(snapshot, foe).weapon?.minRange ?? 0)
      && canReach(snapshot.map, foe, target, snapshot.units, combatCapability(snapshot, foe).range));
    const aimed = aimedAt(unit);
    if (!aimed.length) continue;
    const profile = shipProfile(ship)!;
    const point = deckPlacement(ship, unit, snapshot.units, { x: -profile.length / 4, y: unit.deck.y });
    if (!point || distance(point, unit.deck) <= unit.radius || !deckWalkPathExists(ship, unit, point, snapshot.units)) continue;
    // Only estimate a currently straight native deck walk; a fitting/crew detour needs its actual road length.
    if (!capsuleClearsCircles(unit.deck, point, unit.radius + 1, profile.obstacles)
      || !capsuleClearsBodies(unit.deck, point, unit.radius + 1, snapshot.units.filter(other => other.id !== unit.id && other.hp > 0
        && other.deck?.shipId === ship.id && !isInCabin(other)).map(other => ({ ...other.deck!, radius: other.radius })))) continue;
    const world = localToWorld(ship, point);
    // Public move attaches to the first supporting hull, as deckPointOrder does.
    // An overlapping neighbour must not turn this retreat into a cross-deck trip.
    if (snapshot.units.find(body => {
      const floor = shipProfile(body);
      return floor && circleInPolygon(worldToLocal(body, world), 0, floor.hull);
    })?.id !== ship.id) continue;
    // A legal floor point still needs to recede from every current shooter.
    if (aimed.some(foe => distance(world, foe) <= distance(unit, foe))) continue;
    const window = THINK_TICKS + Math.ceil(distance(unit.deck, point) * SIM_TICKS_PER_SECOND / speed);
    const period = (foe: Unit) => {
      const modifiers = (veteran ??= buildVeteranFrame(snapshot)).get(foe.id);
      const multiplier = (modifiers?.attackSpeedMultiplier ?? 1) * temporaryAttackSpeedMultiplier(foe);
      return multiplier === 1 ? foe.attackCooldown : Math.max(1, Math.round(foe.attackCooldown / multiplier));
    };
    const volley = (target: Unit, attackers = aimed) => attackers.reduce((total, foe) => total + damageTo(target, foe, foe.attackDamage)
      * aimedVolleyCount(window, foe.cooldown, period(foe)), 0);
    const flying = (target: Unit) => snapshot.projectiles.filter(shot => shot.targetId === target.id && shot.remaining <= window)
      .reduce((total, shot) => total + resolveUnitDamage(snapshot, target, shot.damage,
        shot.damageProfile ?? attackDamageProfile(shot.sourceKind ?? 'defenseTower'),
        (veteran ??= buildVeteranFrame(snapshot)).get(target.id)?.reductions,
        { armorAlreadyApplied: !!shot.armorAlreadyApplied }).damage, 0);
    if (unit.hp > flying(unit) + volley(unit)) continue;
    // Preserve the existing front's movement. Merely finding another hull somewhere is not a screen.
    const front = own.some(guard => guard.id !== unit.id && guard.deck?.shipId === ship.id && available(guard, ship)
      && automaticAttack(guard) && !guard.orderQueue?.length
      && (guard.expiresTick === undefined || guard.expiresTick > snapshot.tick + window)
      && guard.hp > volley(guard) + flying(guard) + volley(guard, aimedAt(guard))
      && aimed.every(foe => distance(guard, foe) < distance(world, foe)));
    if (!front) continue;
    posts[unit.id] = { shipId: ship.id, point, hold: { x: unit.x, y: unit.y }, foeIds: aimed.map(foe => foe.id) };
    orders.push({ type: 'move', unitIds: [unit.id], ...world }, { type: 'holdPosition', unitIds: [unit.id], queued: true });
  }
  if (Object.keys(posts).length) naval.deckRecovery = posts;
  else delete naval.deckRecovery;
  return release.length || orders.length ? [...release, ...planned, ...orders] : planned;
}
