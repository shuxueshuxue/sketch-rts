/** Snapshot facts are indexed once; camera queries never scan the whole army.
 * This owns presentation candidates only, not simulation or event history. */
import type {GameSnapshot, Unit, WorldEffect} from '../shared/types';
import {shipProfile} from '../shared/ship-geometry';
import {creatureShadow} from './art/painted-creatures';
import {unitGlyphScale} from './glyphs';
import {engagedEntityIds} from './health-bars';
import type {UnitMotionSmoother} from './unit-motion';
import type {WorldView} from './world-renderer';

const CELL=256;
type Bounds={left:number;top:number;right:number;bottom:number};
type Entry={unit:Unit;order:number;left:number;right:number;top:number;bottom:number;special:boolean;pad:number;kind:Unit['kind'];radius:number;epoch:number;firstCol:number;lastCol:number;firstRow:number;lastRow:number};
export class PresentationViewIndex {
  readonly units=new Map<string,Unit>();
  readonly entities=new Map<string,Unit|GameSnapshot['buildings'][number]>();
  readonly hits=new Map<string,WorldEffect>();
  readonly crew:Unit[]=[];
  readonly sailing:Unit[]=[];
  readonly ships:Unit[]=[];
  readonly builders:Unit[]=[];
  readonly aiming:Unit[]=[];
  private snapshot:GameSnapshot|undefined;
  private tick=-1;
  private unitArray:Unit[]|undefined;
  private buildingArray:GameSnapshot['buildings']|undefined;
  private effectArray:GameSnapshot['effects']|undefined;
  private projectileArray:GameSnapshot['projectiles']|undefined;
  private counts='';
  private motion:UnitMotionSmoother|undefined;
  private cells=new Map<string,Entry[]>();
  private entries:Entry[]=[];
  private byId=new Map<string,Entry>();
  private buildingIds=new Set<string>();
  private special:Entry[]=[];
  private seen=new Uint32Array(0);
  private stamp=0;
  private candidateEntries:Entry[]=[];
  private candidates:Unit[]=[];
  private viewBounds:Bounds={left:0,top:0,right:0,bottom:0};
  private viewAreas=[this.viewBounds];
  private engaged:ReadonlySet<string>|undefined;
  private builds=0;

  update(snapshot:GameSnapshot,motion?:UnitMotionSmoother){
    const counts=`${snapshot.units.length}:${snapshot.buildings.length}:${snapshot.effects.length}:${snapshot.projectiles.length}`;
    if(snapshot===this.snapshot&&snapshot.tick===this.tick&&snapshot.units===this.unitArray&&snapshot.buildings===this.buildingArray&&snapshot.effects===this.effectArray&&snapshot.projectiles===this.projectileArray&&counts===this.counts&&motion===this.motion)return false;
    this.snapshot=snapshot;this.tick=snapshot.tick;this.unitArray=snapshot.units;this.buildingArray=snapshot.buildings;this.effectArray=snapshot.effects;this.projectileArray=snapshot.projectiles;this.counts=counts;this.motion=motion;this.builds++;
    this.hits.clear();this.entries.length=0;this.special.length=0;this.crew.length=0;this.sailing.length=0;this.ships.length=0;this.builders.length=0;this.aiming.length=0;this.engaged=undefined;
    if(this.seen.length<snapshot.units.length)this.seen=new Uint32Array(snapshot.units.length);
    for(let order=0;order<snapshot.units.length;order++){
      const unit=snapshot.units[order]!,naval=shipProfile(unit);this.units.set(unit.id,unit);this.entities.set(unit.id,unit);
      if(unit.deck)this.crew.push(unit);
      if(unit.sailing)this.sailing.push(unit);
      if(naval)this.ships.push(unit);
      if(unit.kind==='worker'&&unit.order.type==='build')this.builders.push(unit);
      if(unit.aim)this.aiming.push(unit);
      // Decks rotate and story painters need not have bounded authored art.
      // Keep their existing exact positioning path; ordinary ground armies
      // account for the large majority of world entities.
      let entry=this.byId.get(unit.id);
      const pad=entry&&entry.kind===unit.kind&&entry.radius===unit.radius?entry.pad:Math.max(256,unit.radius*8,180+Math.abs((creatureShadow(unit.kind)?.y??17)*unitGlyphScale(unit.radius)));
      const sweep=motion?.bounds(unit),from=sweep?.from??unit,to=sweep?.to??unit;
      const left=Math.min(unit.x,from.x,to.x)-pad,right=Math.max(unit.x,from.x,to.x)+pad,top=Math.min(unit.y,from.y,to.y)-pad,bottom=Math.max(unit.y,from.y,to.y)+pad;
      const firstCol=Math.floor(left/CELL),lastCol=Math.floor(right/CELL),firstRow=Math.floor(top/CELL),lastRow=Math.floor(bottom/CELL);
      const special=Boolean(unit.deck||unit.variant!==undefined||naval||(lastCol-firstCol+1)*(lastRow-firstRow+1)>64);
      const relocated=!entry||entry.special!==special||entry.firstCol!==firstCol||entry.lastCol!==lastCol||entry.firstRow!==firstRow||entry.lastRow!==lastRow;
      if(entry&&relocated)this.removeCells(entry);
      if(!entry){entry={unit,order,left,right,top,bottom,pad,kind:unit.kind,radius:unit.radius,epoch:this.builds,special,firstCol,lastCol,firstRow,lastRow};this.byId.set(unit.id,entry);}
      else{entry.unit=unit;entry.order=order;entry.left=left;entry.right=right;entry.top=top;entry.bottom=bottom;entry.pad=pad;entry.kind=unit.kind;entry.radius=unit.radius;entry.epoch=this.builds;entry.special=special;entry.firstCol=firstCol;entry.lastCol=lastCol;entry.firstRow=firstRow;entry.lastRow=lastRow;}
      this.entries.push(entry);
      // An exceptional long interpolation cannot allocate an unbounded grid.
      if(special){this.special.push(entry);continue;}
      if(relocated)for(let row=firstRow;row<=lastRow;row++)for(let col=firstCol;col<=lastCol;col++){
        const key=`${col}:${row}`,cell=this.cells.get(key);
        if(cell)cell.push(entry);else this.cells.set(key,[entry]);
      }
    }
    for(const [id,entry] of this.byId)if(entry.epoch!==this.builds){this.removeCells(entry);this.byId.delete(id);this.units.delete(id);this.entities.delete(id);}
    const oldBuildings=this.buildingIds;this.buildingIds=new Set();
    for(const building of snapshot.buildings){this.entities.set(building.id,building);this.buildingIds.add(building.id);oldBuildings.delete(building.id);}
    for(const id of oldBuildings)if(!this.units.has(id))this.entities.delete(id);
    for(const effect of snapshot.effects)if(effect.type==='hit'&&effect.unitId&&!this.hits.has(effect.unitId))this.hits.set(effect.unitId,effect);
    return true;
  }
  private removeCells(entry:Entry){
    if(entry.special)return;
    for(let row=entry.firstRow;row<=entry.lastRow;row++)for(let col=entry.firstCol;col<=entry.lastCol;col++){
      const key=`${col}:${row}`,cell=this.cells.get(key);if(!cell)continue;
      const at=cell.indexOf(entry);if(at>=0)cell.splice(at,1);if(!cell.length)this.cells.delete(key);
    }
  }
  query(view:WorldView):readonly Unit[]{
    const zoom=view.zoom??1,bounds=this.viewBounds;
    bounds.left=view.x;bounds.top=view.y;bounds.right=view.x+view.width/zoom;bounds.bottom=view.y+view.height/zoom;
    return this.queryBoundsUnion(this.viewAreas);
  }
  /** World contact areas are independent of the camera. Return one deduplicated
   * snapshot-ordered set so overlapping bursts share their receiver capsules.
   * This borrowed result is consumed synchronously before another query. */
  queryBoundsUnion(areas:readonly Bounds[]):readonly Unit[]{
    this.candidateEntries.length=0;this.candidates.length=0;
    if(++this.stamp>=0xffffffff){this.seen.fill(0);this.stamp=1;}
    const add=(entry:Entry,area:Bounds)=>{
      if(this.seen[entry.order]===this.stamp)return;
      if(entry.right>=area.left&&entry.left<=area.right&&entry.bottom>=area.top&&entry.top<=area.bottom){this.seen[entry.order]=this.stamp;this.candidateEntries.push(entry);}
      else if(areas.length===1)this.seen[entry.order]=this.stamp;
    };
    for(const area of areas){
      const firstCol=Math.floor(area.left/CELL),lastCol=Math.floor(area.right/CELL),firstRow=Math.floor(area.top/CELL),lastRow=Math.floor(area.bottom/CELL);
      if((lastCol-firstCol+1)*(lastRow-firstRow+1)>Math.max(64,this.cells.size*2)){
        for(const entry of this.entries)if(!entry.special)add(entry,area);
      }else for(let row=firstRow;row<=lastRow;row++)for(let col=firstCol;col<=lastCol;col++)for(const entry of this.cells.get(`${col}:${row}`)??[])add(entry,area);
    }
    // Exact deck/variant positions are deliberately checked by their renderer.
    if(areas.length)for(const entry of this.special)if(this.seen[entry.order]!==this.stamp){this.seen[entry.order]=this.stamp;this.candidateEntries.push(entry);}
    this.candidateEntries.sort((a,b)=>a.order-b.order);
    for(const entry of this.candidateEntries)this.candidates.push(entry.unit);
    return this.candidates;
  }
  engagedIds(){return this.engaged??=(this.snapshot?engagedEntityIds(this.snapshot):new Set());}
  stats(){return{builds:this.builds,units:this.units.size,cells:this.cells.size,candidates:this.candidates.length,special:this.special.length};}
  reset(){this.snapshot=undefined;this.tick=-1;this.unitArray=undefined;this.buildingArray=undefined;this.effectArray=undefined;this.projectileArray=undefined;this.motion=undefined;this.counts='';this.units.clear();this.entities.clear();this.hits.clear();this.cells.clear();this.byId.clear();this.buildingIds.clear();this.entries.length=0;this.special.length=0;this.crew.length=0;this.sailing.length=0;this.ships.length=0;this.builders.length=0;this.aiming.length=0;this.candidates.length=0;this.candidateEntries.length=0;this.engaged=undefined;this.seen=new Uint32Array(0);}
}
