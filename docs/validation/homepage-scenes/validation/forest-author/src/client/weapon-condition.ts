import { isShipEquipment, SHIP_WEAPONS } from '../shared/ship-equipment';
import type { WorldItem } from '../shared/types';

export function weaponCondition(item: WorldItem) {
    if (!isShipEquipment(item.kind)) return undefined;
    const max = SHIP_WEAPONS[item.kind].hp;
    const hp = Math.max(0, Math.min(max, item.durability ?? max));
    return { hp, max, ratio: hp / max, state: hp === 0 ? 'broken' : hp < max ? 'damaged' : 'ready' } as const;
}
