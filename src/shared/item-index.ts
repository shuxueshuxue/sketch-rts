import type { WorldItem } from './types';
type ItemIndex = {
    count: number;
    byId: Map<string, WorldItem>;
    byCarrier: Map<string, WorldItem[]>;
    byShip: Map<string, WorldItem[]>;
};
const indexes = new WeakMap<readonly WorldItem[], ItemIndex>();
/** Runtime-only lookup. Transfers invalidate it; additions and replacements rebuild it. */
export function itemIndex(items: readonly WorldItem[]) {
    let index = indexes.get(items);
    if (index?.count === items.length)
        return index;
    index = { count: items.length, byId: new Map(), byCarrier: new Map(), byShip: new Map() };
    for (const item of items) {
        index.byId.set(item.id, item);
        for (const [id, map] of [[item.carrierId, index.byCarrier], [item.shipId, index.byShip]] as const) {
            if (!id)
                continue;
            const list = map.get(id);
            if (list)
                list.push(item);
            else
                map.set(id, [item]);
        }
    }
    indexes.set(items, index);
    return index;
}
export function invalidateItemIndex(items: readonly WorldItem[]) { indexes.delete(items); }
