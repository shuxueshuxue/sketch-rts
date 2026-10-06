import { weaponRules } from "./equipment";
import { hasSpell, unitRules, type WeaponDef } from "./catalog";
import { shipProfile } from "./ship-geometry";
import type { Building, GameSnapshot, Unit } from "./types";
/** A hit on crew also damages its deck. Shares apply to the incoming blow, without multiplying by the number of passengers. */
export const DECK_HULL_DAMAGE = { arrow: .1, spell: .15, melee: .2, bolt: .3, shell: .5, cone: .35, ram: .5 } as const;
export function deckHullDamageShare(game: GameSnapshot, source: Unit | Building, weapon?: WeaponDef) {
    if (weapon)
        return weapon.hullDamageShare ?? DECK_HULL_DAMAGE[weapon.delivery];
    if (!("order" in source))
        return DECK_HULL_DAMAGE.arrow;
    const rules = weaponRules(game, source);
    if (rules.weapon)
        return rules.weapon.hullDamageShare ?? DECK_HULL_DAMAGE[rules.weapon.delivery];
    return rules.attackRange <= 80 ? DECK_HULL_DAMAGE.melee : hasSpell(source.kind) ? DECK_HULL_DAMAGE.spell : DECK_HULL_DAMAGE.arrow;
}
export function passengerDamageMultiplier(game: GameSnapshot, source: Unit) {
    const hull = source.deck && game.units.find(unit => unit.id === source.deck!.shipId && unit.hp > 0);
    return hull && shipProfile(hull) ? unitRules(game, hull).passengerDamageMultiplier ?? 1 : 1;
}
