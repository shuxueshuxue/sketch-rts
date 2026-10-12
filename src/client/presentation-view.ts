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
type Entry={unit:Unit;order:number;left:number;right:number;top:number;bottom:number;special?:boolean};
export class PresentationViewIndex {
  readonly units=new Map<string,Unit>();
  readonly entities=new Map<string,Unit|GameSnapshot['buildings'][number]>();
  readonly hits=new Map<string,WorldEffect>();
  readonly crew:Unit[]=[];
  readonly sailing:Unit[]=[];
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
  private special:Entry[]=[];
  private seen=new Uint32Array(0);
  private stamp=0;
  private candidateEntries:Entry[]=[];
  private candidates:Unit[]=[];
  private engaged:ReadonlySet<string>|undefined;
  private builds=0;

  update(snapshot:GameSnapshot,motion?:UnitMotionSmoother){
    const counts=`${snapshot.units.length}:${snapshot.buildings.length}:${snapshot.effects.length}:${snapshot.projectiles.length}`;
    if(snapshot===this.snapshot&&snapshot.tick===this.tick&&snapshot.units===this.unitArray&&snapshot.buildings===this.buildingArray&&snapshot.effects===this.effectArray&&snapshot.projectiles===this.projectileArray&&counts===this.counts&&motion===this.motion)return false;
    this.snapshot=snapshot;this.tick=snapshot.tick;this.unitArray=snapshot.units;this.buildingArray=snapshot.buildings;this.effectArray=snapshot.effects;this.projectileArray=snapshot.projectiles;this.counts=counts;this.motion=motion;this.builds++;
    this.units.clear();this.entities.clear();this.hits.clear();this.cells.clear();this.entries.length=0;this.special.length=0;this.crew.length=0;this.sailing.length=0;this.builders.length=0;this.aiming.length=0;this.engaged=undefined;
    if(this.seen.length<snapshot.units.length)this.seen=new Uint32Array(snapshot.units.length);
    for(let order=0;order<snapshot.units.length;order++){
      const unit=snapshot.units[order]!;this.units.set(unit.id,unit);this.entities.set(unit.id,unit);
      if(unit.deck)this.crew.push(unit);
      if(unit.sailing)this.sailing.push(unit);
      if(unit.kind==='worker'&&unit.order.type==='build')this.builders.push(unit);
      if(unit.aim)this.aiming.push(unit);
      // Decks rotate and story painters need not have bounded authored art.
      // Keep their existing exact positioning path; ordinary ground armies
      // account for the large majority of world entities.
      const pad=Math.max(256,unit.radius*8,180+Math.abs((creatureShadow(unit.kind)?.y??17)*unitGlyphScale(unit.radius)));
      const sweep=motion?.bounds(unit),from=sweep?.from??unit,to=sweep?.to??unit;
      const entry:Entry={unit,order,left:Math.min(unit.x,from.x,to.x)-pad,right:Math.max(unit.x,from.x,to.x)+pad,top:Math.min(unit.y,from.y,to.y)-pad,bottom:Math.max(unit.y,from.y,to.y)+pad};
      this.entries.push(entry);
      const left=Math.floor(entry.left/CELL),right=Math.floor(entry.right/CELL),top=Math.floor(entry.top/CELL),bottom=Math.floor(entry.bottom/CELL);
      // An exceptional long interpolation cannot allocate an unbounded grid.
      if(unit.deck||unit.variant!==undefined||shipProfile(unit)||(right-left+1)*(bottom-top+1)>64){entry.special=true;this.special.push(entry);continue;}
      for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++){
        const key=`${col}:${row}`,cell=this.cells.get(key);
        if(cell)cell.push(entry);else this.cells.set(key,[entry]);
      }
    }
    for(const building of snapshot.buildings)this.entities.set(building.id,building);
    for(const effect of snapshot.effects)if(effect.type==='hit'&&effect.unitId&&!this.hits.has(effect.unitId))this.hits.set(effect.unitId,effect);
    return true;
  }
  query(view:WorldView):readonly Unit[]{
    this.candidateEntries.length=0;this.candidates.length=0;
    if(++this.stamp>=0xffffffff){this.seen.fill(0);this.stamp=1;}
    const zoom=view.zoom??1,right=view.x+view.width/zoom,bottom=view.y+view.height/zoom;
    const add=(entry:Entry)=>{
      if(this.seen[entry.order]===this.stamp)return;this.seen[entry.order]=this.stamp;
      if(entry.right>=view.x&&entry.left<=right&&entry.bottom>=view.y&&entry.top<=bottom)this.candidateEntries.push(entry);
    };
    const firstCol=Math.floor(view.x/CELL),lastCol=Math.floor(right/CELL),firstRow=Math.floor(view.y/CELL),lastRow=Math.floor(bottom/CELL);
    if((lastCol-firstCol+1)*(lastRow-firstRow+1)>Math.max(64,this.cells.size*2)){
      for(const entry of this.entries)if(!entry.special)add(entry);
    }else for(let row=firstRow;row<=lastRow;row++)for(let col=firstCol;col<=lastCol;col++)for(const entry of this.cells.get(`${col}:${row}`)??[])add(entry);
    // Exact deck/variant positions are deliberately checked by their renderer.
    for(const entry of this.special)if(this.seen[entry.order]!==this.stamp){this.seen[entry.order]=this.stamp;this.candidateEntries.push(entry);}
    this.candidateEntries.sort((a,b)=>a.order-b.order);
    for(const entry of this.candidateEntries)this.candidates.push(entry.unit);
    return this.candidates;
  }
  engagedIds(){return this.engaged??=(this.snapshot?engagedEntityIds(this.snapshot):new Set());}
  stats(){return{builds:this.builds,units:this.units.size,cells:this.cells.size,candidates:this.candidates.length,special:this.special.length};}
  reset(){this.snapshot=undefined;this.tick=-1;this.unitArray=undefined;this.buildingArray=undefined;this.effectArray=undefined;this.projectileArray=undefined;this.motion=undefined;this.counts='';this.units.clear();this.entities.clear();this.hits.clear();this.cells.clear();this.entries.length=0;this.special.length=0;this.crew.length=0;this.sailing.length=0;this.builders.length=0;this.aiming.length=0;this.candidates.length=0;this.candidateEntries.length=0;this.engaged=undefined;this.seen=new Uint32Array(0);}
}
