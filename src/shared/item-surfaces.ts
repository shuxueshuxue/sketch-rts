import { invalidateItemIndex } from './item-index';
import { diskInConvex } from './navigation-math';
import { localToWorld, shipProfile, worldToLocal } from './ship-geometry';
import { CELL_GROUND } from './terrain';
import type { GameMap, Unit, WorldItem } from './types';

/** Loose items need actual support. A deck carries its floor objects; water
 * destroys them, including equipment released by a sinking hull. */
export function settleGroundItems(items: WorldItem[], units: readonly Unit[], map: GameMap) {
  const ships=units.filter(unit=>unit.hp>0 && shipProfile(unit));
  let changed=false;
  const kept=items.filter(item=>{
    if(item.carrierId || item.shipId){if(item.deck){delete item.deck;changed=true;}return true;}
    const parent=item.deck && ships.find(ship=>ship.id===item.deck!.shipId);
    if(parent){Object.assign(item,localToWorld(parent,item.deck!));return true;}
    if(item.deck){delete item.deck;changed=true;}
    const support=ships.find(ship=>diskInConvex(worldToLocal(ship,item),2,shipProfile(ship)!.deck));
    if(support){item.deck={shipId:support.id,...worldToLocal(support,item)};changed=true;return true;}
    const terrain=map.terrain;
    if(!terrain)return true;
    const col=Math.floor(item.x/terrain.cell),row=Math.floor(item.y/terrain.cell);
    if(!CELL_GROUND[terrain.cells[row*terrain.cols+col] ?? '.']?.sea)return true;
    changed=true;return false;
  });
  if(kept.length!==items.length)items.splice(0,items.length,...kept);
  if(changed)invalidateItemIndex(items);
  return changed;
}
