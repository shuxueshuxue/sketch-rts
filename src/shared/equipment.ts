import { invalidateItemIndex, itemIndex } from "./item-index";
import { SHIP_WEAPONS, isShipEquipment, shipMounts } from "./ship-equipment";
import { bodyMass } from "./physical-body";
import { UNIT_DEFS, unitRules, type UnitDef } from './catalog';
import { SHIP_KINDS, shipProfile, distanceToHull } from './ship-geometry';
import { seconds } from './time';
import type { EquipmentSlot, GameSnapshot, ItemKind, PlayerId, Unit, WorldItem } from './types';
export const CARRY_SLOTS = ['carry0', 'carry1', 'carry2', 'carry3'] as const;
export const ARMOR_SLOTS = ['head', 'body', 'feet'] as const;
export const ITEM_TRANSFER_REACH = 72;
export const ITEM_DEFS: Record<ItemKind, {
    slot?: EquipmentSlot;
    hands?: 1 | 2;
    mass: number;
    hp?: number;
    protection?: number;
    weapon?: {
        damage: number;
        range: number;
        cooldown: number;
    };
    passive?: boolean;
    span?: 4;
}> = {
    shipCannon: { hands: 2, mass: SHIP_WEAPONS.shipCannon.mass, span: 4, passive: true },
    shipMortar: { hands: 2, mass: SHIP_WEAPONS.shipMortar.mass, span: 4, passive: true },
    flameProjector: { hands: 2, mass: SHIP_WEAPONS.flameProjector.mass, span: 4, passive: true },
    issuedWeapon: { hands: 1, mass: 4, passive: true },
    flameCloak: { slot: 'body', mass: 3, passive: true },
    speedBoots: { slot: 'feet', mass: 2, passive: true },
    regenRing: { slot: 'head', mass: 1, passive: true },
    leatherArmor: { slot: 'body', mass: 8, protection: .08, passive: true },
    roundShield: { hands: 1, mass: 5, protection: .12, passive: true },
    greatSword: { hands: 2, mass: 6, weapon: { damage: 22, range: 48, cooldown: seconds(1.8) }, passive: true },
    lightningRod: { hands: 1, mass: 3 }, stormStaff: { hands: 2, mass: 5 },
    guardianScroll: { hands: 1, mass: .3 }, healingScroll: { hands: 1, mass: .3 },
    experienceBook: { hands: 1, mass: 1 }, breachCharge: { hands: 1, mass: 6 }, ivoryTower: { hands: 1, mass: 2 },
};
const HUMANOIDS = new Set<string>(['worker', 'footman', 'archer', 'knight', 'lancer', 'raider', 'ravager', 'runner', 'sparkArcher', 'horseArcher', 'priest', 'mage', 'witch', 'ashGuard', 'ashChieftain', 'cinderRevenant', 'emberPriest', 'necromancer', 'mercenary', 'contractArcher', 'fieldMedic']);
export function canEquip(unit: Unit) { return HUMANOIDS.has(unit.kind) || unit.owner !== 'neutral' && !SHIP_KINDS.includes(unit.kind as never) && unit.radius <= 22; }
export function isCarrySlot(slot: EquipmentSlot): boolean { return (CARRY_SLOTS as readonly string[]).includes(slot); }
export function itemHands(item: WorldItem) {
    if (item.kind === 'issuedWeapon')
        return (UNIT_DEFS[item.weaponKind!]?.attackRange ?? 0) > 80 ? 2 : 1;
    return ITEM_DEFS[item.kind].hands ?? 1;
}
export function itemsFor(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit) { return itemIndex(snapshot.items).byCarrier.get(unit.id) ?? []; }
export function itemSlot(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit, item: WorldItem): EquipmentSlot | undefined {
    if (item.slot)
        return item.slot;
    // Read old-format snapshots without mutating a UI projection.
    const occupied = new Set<EquipmentSlot>();
    for (const candidate of itemsFor(snapshot, unit)) {
        const worn = ITEM_DEFS[candidate.kind].slot;
        const slot = candidate.slot ?? (worn && !occupied.has(worn) ? worn : CARRY_SLOTS.find(slot => !occupied.has(slot)));
        if (candidate.id === item.id)
            return slot;
        if (slot)
            occupied.add(slot);
    }
    return undefined;
}
export function freeItemSlot(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit, kind: ItemKind): EquipmentSlot | undefined {
    const carried = itemsFor(snapshot, unit);
    const occupied = new Set(carried.flatMap(item => ITEM_DEFS[item.kind].span === 4 ? [...CARRY_SLOTS] : [itemSlot(snapshot, unit, item)]));
    if (ITEM_DEFS[kind].span === 4)
        return CARRY_SLOTS.every(slot => !occupied.has(slot)) ? "carry0" : undefined;
    const worn = ITEM_DEFS[kind].slot;
    if (worn && !occupied.has(worn))
        return worn;
    return CARRY_SLOTS.find(slot => !occupied.has(slot));
}
export function activeItem(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit, hand: 'right' | 'left') {
    const id = unit.hands?.[hand];
    const item = id ? itemIndex(snapshot.items).byId.get(id) : undefined;
    return item?.carrierId === unit.id ? item : undefined;
}
export function itemEquipped(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit, item: WorldItem) {
    const slot = itemSlot(snapshot, unit, item);
    return Boolean(slot && !isCarrySlot(slot) || unit.hands?.right === item.id || unit.hands?.left === item.id
        // Existing saves with no hand state keep their carried artifacts available.
        || !unit.hands && !item.slot && !ITEM_DEFS[item.kind].passive);
}
export function equipmentProtection(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit) {
    let protection = 0;
    for (const item of itemsFor(snapshot, unit))
        if (ITEM_DEFS[item.kind].protection && itemEquipped(snapshot, unit, item))
            protection += ITEM_DEFS[item.kind].protection!;
    return Math.min(.3, protection);
}
const defaultKits = new WeakMap<Unit, {
    items: WorldItem[];
    item: WorldItem;
}>();
export function weaponRules(snapshot: GameSnapshot, unit: Unit): UnitDef {
    const base = unitRules(snapshot, unit), kit = defaultKits.get(unit);
    if (kit && kit.items === snapshot.items && kit.item.id === unit.hands?.right && kit.item.carrierId === unit.id && kit.item.kind === 'issuedWeapon' && kit.item.weaponKind === unit.kind)
        return base;
    if (SHIP_KINDS.includes(unit.kind as never) && unit.fittings) {
        const weapon = (itemIndex(snapshot.items).byShip.get(unit.id) ?? []).filter(item => item.mountId && isShipEquipment(item.kind) && (item.durability ?? 1) > 0).sort((a, b) => SHIP_WEAPONS[b.kind as keyof typeof SHIP_WEAPONS].range - SHIP_WEAPONS[a.kind as keyof typeof SHIP_WEAPONS].range)[0];
        if (weapon) {
            const profile = SHIP_WEAPONS[weapon.kind as keyof typeof SHIP_WEAPONS];
            return { ...base, attackDamage: profile.damage, attackRange: profile.range, attackCooldown: profile.cooldown, weapon: profile.weapon, aimSpeed: profile.aimSpeed };
        }
        if (unit.kind !== 'cutter')
            return { ...base, attackDamage: 0, attackRange: 0 };
    }
    if (!unit.hands || !canEquip(unit))
        return base;
    const item = activeItem(snapshot, unit, 'right');
    if (!item || !ITEM_DEFS[item.kind].weapon && item.kind !== 'issuedWeapon')
        return base;
    if (item?.kind === 'issuedWeapon' && item.weaponKind === unit.kind) {
        defaultKits.set(unit, { items: snapshot.items, item });
        return base;
    }
    const { weapon: _weapon, aimSpeed: _aim, aimMoveTolerance: _tolerance, ...body } = base;
    if (item?.kind === 'issuedWeapon' && item.weaponKind) {
        const profile = UNIT_DEFS[item.weaponKind];
        return { ...body, attackDamage: profile.attackDamage, attackRange: profile.attackRange, attackCooldown: profile.attackCooldown, ...(profile.weapon ? { weapon: profile.weapon } : {}), ...(profile.aimSpeed ? { aimSpeed: profile.aimSpeed } : {}), ...(profile.aimMoveTolerance ? { aimMoveTolerance: profile.aimMoveTolerance } : {}) };
    }
    const selected = item && ITEM_DEFS[item.kind].weapon;
    return selected ? { ...body, attackDamage: selected.damage, attackRange: selected.range, attackCooldown: selected.cooldown } : base;
}
export function shipHoldSlots(ship: Unit) { const profile = shipProfile(ship); return profile ? Math.max(4, Math.floor(profile.loadCapacity / 100)) : 0; }
export function shipItemMass(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit) { return (itemIndex(snapshot.items).byShip.get(ship.id) ?? []).reduce((sum, item) => sum + ITEM_DEFS[item.kind].mass, 0); }
export function unitItemMass(snapshot: Pick<GameSnapshot, 'items'>, unit: Unit) { return itemsFor(snapshot, unit).reduce((sum, item) => sum + ITEM_DEFS[item.kind].mass, 0); }
export function canExchange(snapshot: Pick<GameSnapshot, 'units'>, unit: Unit, ship: Unit) {
    return unit.deck?.shipId === ship.id || distanceToHull(ship, unit) <= ITEM_TRANSFER_REACH + unit.radius;
}
export type ItemDestination = {
    unitId: string;
    slot: EquipmentSlot;
} | {
    shipId: string;
    slot: number;
} | {
    shipId: string;
    mountId: string;
    installerId: string;
};
export function transferRefusal(snapshot: GameSnapshot, owner: PlayerId, itemId: string, destination: ItemDestination): string | undefined {
    const item = snapshot.items.find(item => item.id === itemId);
    if (!item)
        return 'Item is no longer available';
    const source = snapshot.units.find(unit => unit.id === (item.carrierId ?? item.shipId));
    if (!source || source.owner !== owner)
        return 'You can only move your own equipment';
    const target = snapshot.units.find(unit => unit.id === ('unitId' in destination ? destination.unitId : destination.shipId));
    if (!target || target.owner !== owner || target.hp <= 0)
        return 'Destination is no longer available';
    if (item.mountId && !snapshot.units.some(unit => unit.owner === owner && canEquip(unit) && canExchange(snapshot, unit, source)))
        return 'A crew member must be nearby to install or remove weapons';
    if (source.id !== target.id) {
        const ship = shipProfile(source) ? source : shipProfile(target) ? target : undefined, unit = ship === source ? target : source;
        if (ship ? !canExchange(snapshot, unit, ship) : source.deck?.shipId !== target.deck?.shipId || Math.hypot(source.x - target.x, source.y - target.y) > ITEM_TRANSFER_REACH)
            return 'Move closer before exchanging items';
    }
    if ('unitId' in destination) {
        if (!canEquip(target))
            return 'This unit cannot wear equipment';
        if (!isCarrySlot(destination.slot) && ITEM_DEFS[item.kind].slot !== destination.slot)
            return 'This item does not fit that equipment position';
        const carried = itemsFor(snapshot, target).filter(other => other.id !== item.id);
        if (ITEM_DEFS[item.kind].span === 4 && (destination.slot !== 'carry0' || carried.some(other => isCarrySlot(itemSlot(snapshot, target, other)!))))
            return 'A heavy weapon needs all four carrying positions';
        const occupied = carried.some(other => ITEM_DEFS[other.kind].span === 4 && isCarrySlot(destination.slot) || itemSlot(snapshot, target, other) === destination.slot);
        if (occupied)
            return 'That position is occupied; move its item first';
    }
    else {
        if (!shipProfile(target))
            return 'This destination has no hold or weapon fittings';
        if ('mountId' in destination) {
            const mount = shipMounts(target).find(mount => mount.id === destination.mountId);
            if (!mount || !isShipEquipment(item.kind) || !mount.accepts.includes(item.kind))
                return 'This weapon does not fit this ship position';
            if (snapshot.items.some(other => other.id !== item.id && other.shipId === target.id && other.mountId === mount.id))
                return 'This fitting is occupied';
            const installer = snapshot.units.find(unit => unit.id === destination.installerId && unit.owner === owner && canEquip(unit) && unit.hp > 0);
            if (!installer || !canExchange(snapshot, installer, target))
                return 'A crew member must be nearby to install or remove weapons';
            if (snapshot.units.some(unit => unit.deck?.shipId === target.id && Math.hypot(unit.deck.x - mount.x, unit.deck.y - mount.y) < unit.radius + mount.radius + 1))
                return 'Clear the deck around this fitting first';
        }
        else {
            const span = ITEM_DEFS[item.kind].span ?? 1;
            if (!Number.isInteger(destination.slot) || destination.slot < 0 || destination.slot + span > shipHoldSlots(target))
                return 'No room in the hold';
            const occupied = new Set(snapshot.items.filter(other => other.id !== item.id && other.shipId === target.id && other.holdSlot !== undefined).flatMap(other => Array.from({ length: ITEM_DEFS[other.kind].span ?? 1 }, (_, i) => other.holdSlot! + i)));
            if (Array.from({ length: span }, (_, i) => destination.slot + i).some(slot => occupied.has(slot)))
                return 'That hold position is occupied';
        }
        const profile = shipProfile(target)!;
        const load = snapshot.units.filter(unit => unit.deck?.shipId === target.id).reduce((sum, unit) => sum + bodyMass(unit), 0) + shipItemMass(snapshot, target);
        const alreadyAboard = item.shipId === target.id || source.deck?.shipId === target.id;
        if (load + (alreadyAboard ? 0 : ITEM_DEFS[item.kind].mass) > profile.loadCapacity)
            return 'The ship cannot carry more weight';
    }
}
export function dropRefusal(snapshot: Pick<GameSnapshot,'units'|'items'>, owner: PlayerId, unitId: string, itemId: string): string | undefined {
    const unit = snapshot.units.find(unit => unit.id === unitId && unit.owner === owner && unit.hp > 0);
    const item = snapshot.items.find(item => item.id === itemId);
    if (!unit || !canEquip(unit) || !item) return 'Item or carrier is no longer available';
    if (item.carrierId === unit.id) return;
    const ship = snapshot.units.find(ship => ship.id === item.shipId && ship.owner === owner && ship.hp > 0);
    if (!ship) return 'You can only move your own equipment';
    if (!canExchange(snapshot, unit, ship)) return 'A crew member must be nearby to install or remove weapons';
}
export function removeFromHands(unit: Unit, itemId: string) {
    if (!unit.hands)
        return;
    if (unit.hands.right === itemId)
        delete unit.hands.right;
    if (unit.hands.left === itemId)
        delete unit.hands.left;
}
export function wieldRefusal(snapshot: GameSnapshot, owner: PlayerId, unitId: string, itemId: string | undefined, hand: 'right' | 'left') {
    const unit = snapshot.units.find(unit => unit.id === unitId && unit.owner === owner);
    if (!unit)
        return 'Unit is no longer available';
    if (!itemId)
        return undefined;
    const item = itemsFor(snapshot, unit).find(item => item.id === itemId);
    if (!item)
        return 'The item must be carried by this unit';
    if (!isCarrySlot(itemSlot(snapshot, unit, item)!))
        return 'Move the item to a carrying position first';
    if (hand === 'left' && itemHands(item) === 2)
        return 'A two-handed weapon goes in the main hand';
    if (hand === 'left' && activeItem(snapshot, unit, 'right') && itemHands(activeItem(snapshot, unit, 'right')!) === 2)
        return 'Stow the two-handed weapon first';
}
/** Assign old carried items to real positions, preserving overflow as world drops. */
export function normalizeEquipment(snapshot: GameSnapshot, issue = false) {
    // Native attacks belong to the unit. Older generated kits must not occupy
    // its carrying positions or become free tradable equipment on migration.
    const generated = new Set(snapshot.items.filter(item => item.kind === 'issuedWeapon' && item.id.startsWith('issued-')).map(item => item.id));
    snapshot.items = snapshot.items.filter(item => !generated.has(item.id));
    for (const unit of snapshot.units) {
        if (!canEquip(unit))
            continue;
        for (const id of generated) removeFromHands(unit, id);
        if (issue) unit.hands ??= {};
        const occupied = new Set<EquipmentSlot>();
        for (const item of snapshot.items.filter(item => item.carrierId === unit.id)) {
            const worn = ITEM_DEFS[item.kind].slot;
            const slot = ITEM_DEFS[item.kind].span === 4 ? CARRY_SLOTS.every(slot => !occupied.has(slot)) ? "carry0" : undefined : item.slot && !occupied.has(item.slot) ? item.slot : worn && !occupied.has(worn) ? worn : CARRY_SLOTS.find(slot => !occupied.has(slot));
            if (slot) {
                item.slot = slot;
                if (ITEM_DEFS[item.kind].span === 4)
                    CARRY_SLOTS.forEach(slot => occupied.add(slot));
                else
                    occupied.add(slot);
            }
            else {
                delete item.carrierId;
                delete item.slot;
                item.x = unit.x;
                item.y = unit.y;
            }
        }
        invalidateItemIndex(snapshot.items);
    }
}
