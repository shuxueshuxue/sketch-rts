import {describe,expect,it} from 'vitest';
import {createCanvas,type Canvas} from '@napi-rs/canvas';
import {setImmediate as yieldImmediate} from 'node:timers/promises';
import type {UnitKind} from '../../shared/types';
import type {UnitAnimationFrame} from '../unit-animation';
import {actionPaintSize} from './action-direction';
import {creatures,figures} from './appearance';
import {paintFigure} from './painted-units';
import {TEAM_CREATURES,unitPaintKey} from './paint-identity';
import {appearanceForKind,appearanceKey} from './unit-appearance';
import type {FigurePresentation} from './rig';

const TEAMS=['#b79048','#5d8e68','#ad5c46'] as const;
const SIEGE=['siegeRam','ballista','catapult','organGun'] as const;
const IDLE:UnitAnimationFrame={mode:'idle',frame:0};
const canvases=new Map<number,Canvas>();
// Native ImageData finalizers need the event loop to run. Keep the complete
// matrices, but release completed raster batches before drawing the next ones.
const RASTER_BATCH_SIZE=32;
function raster(kind:UnitKind,team:string,pose:UnitAnimationFrame,density:number,facing:1|-1,tileSize=actionPaintSize(pose,kind),appearance:Readonly<FigurePresentation>={}){
  const size=tileSize*density;
  let canvas=canvases.get(size);if(!canvas){canvas=createCanvas(size,size);canvases.set(size,canvas);}
  const ctx=canvas.getContext('2d');ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();
  ctx.scale(density,density);ctx.translate(tileSize/2,tileSize/2);ctx.scale(facing,1);
  try{expect(paintFigure(ctx as unknown as CanvasRenderingContext2D,kind,team,pose,facing,appearance)).toBe(true);}finally{ctx.restore();}
  return ctx.getImageData(0,0,size,size).data;
}
function bytes(rgba:Uint8ClampedArray){return Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength);}
function visible(rgba:Uint8ClampedArray){for(let i=3;i<rgba.length;i+=4)if(rgba[i])return true;return false;}
function assertSame(a:Uint8ClampedArray,b:Uint8ClampedArray,label:string){
  // Compare all four channels throughout the original domain, including RGB
  // under transparent pixels. An alpha-mask comparison cannot prove mip parity.
  expect(a.byteLength,label).toBe(b.byteLength);expect(bytes(a).equals(bytes(b)),label).toBe(true);
}
function creaturePoses():UnitAnimationFrame[]{
  const poses:UnitAnimationFrame[]=[];
  for(const mode of ['idle','walk','attack','cast','work'] as const){
    const count=mode==='idle'||mode==='walk'?8:6;
    for(let frame=0;frame<count;frame++)poses.push({mode,frame,...(mode==='attack'?{variant:frame%3}:{}),
      ...(mode==='attack'||mode==='cast'?{aim:Math.round(-6+frame*12/(count-1))}: {})});
  }
  for(const carry of [3,6])for(const mode of ['idle','walk'] as const)poses.push({mode,frame:3,carry,carryAim:carry===3?-6:6});
  poses.push({mode:'attack',frame:2,variant:1,aim:0,carry:6,carryAim:-6});
  return poses;
}

describe('authored unit paint identities',()=>{
  it('shares stock idle phase pairs while retaining opaque variants and the other drawing inputs',()=>{
    for(const kind of [...Object.keys(figures),...Object.keys(creatures)] as UnitKind[])for(const [a,b] of [[0,4],[1,3],[5,7]]){
      const before:UnitAnimationFrame={mode:'idle',frame:a!,carry:6,carryAim:-4},after={...before,frame:b!};
      expect(unitPaintKey(kind,TEAMS[0],before)).toBe(unitPaintKey(kind,TEAMS[0],after));
      for(const variant of ['', 'story:opaque'])expect(unitPaintKey(kind,TEAMS[0],before,variant)).not.toBe(unitPaintKey(kind,TEAMS[0],after,variant));
    }
    const before:UnitAnimationFrame={mode:'idle',frame:0,carry:6,carryAim:0},same={...before,frame:4};
    expect(unitPaintKey('footman',TEAMS[0],before)).toBe(unitPaintKey('footman',TEAMS[0],same));
    expect(unitPaintKey('footman',TEAMS[0],before)).not.toBe(unitPaintKey('footman',TEAMS[1],same));
    expect(unitPaintKey('footman',TEAMS[0],before)).not.toBe(unitPaintKey('footman',TEAMS[0],{...same,carry:3}));
    expect(unitPaintKey('footman',TEAMS[0],before)).not.toBe(unitPaintKey('footman',TEAMS[0],{...same,carryAim:6}));
    expect(unitPaintKey('footman',TEAMS[0],before)).not.toBe(unitPaintKey('footman',TEAMS[0],{...same,frame:2}));
    expect(unitPaintKey('footman',TEAMS[0],{mode:'walk',frame:0})).not.toBe(unitPaintKey('footman',TEAMS[0],{mode:'walk',frame:4}));
    expect(unitPaintKey('transport',TEAMS[0],{mode:'idle',frame:0})).not.toBe(unitPaintKey('transport',TEAMS[0],{mode:'idle',frame:4}));
    const equipped={weapon:'greatSword' as const};
    expect(`${unitPaintKey('footman',TEAMS[0],before)}:${appearanceKey()}`).not.toBe(`${unitPaintKey('footman',TEAMS[0],same)}:${appearanceKey(equipped)}`);
  });
  it('preserves whole-domain stock idle RGBA for all current assets and representative carried equipment',async()=>{
    let comparisons=0;
    const rows:{kind:UnitKind;carry?:number;carryAim?:number;appearance?:Readonly<FigurePresentation>}[]=(Object.keys(figures).concat(Object.keys(creatures)) as UnitKind[]).map(kind=>({kind}));
    rows.push({kind:'footman',carry:1,carryAim:-6,appearance:{weapon:'greatSword'}},
      {kind:'lancer',carry:3,carryAim:0,appearance:{shield:false}},
      {kind:'knight',carry:6,carryAim:6,appearance:{shield:true,shieldStyle:'round'}},
      {kind:'priest',carry:6,carryAim:-6,appearance:appearanceForKind('priest','ember')},
      {kind:'ogreLord',carry:3,carryAim:6},
      {kind:'murlocHunter',carry:1,carryAim:0},
      {kind:'tidePriest',carry:6,carryAim:-4});
    for(const row of rows)for(const [a,b] of [[0,4],[1,3],[5,7]])for(const facing of [-1,1] as const)for(const team of TEAMS.slice(0,2)){
      const carry=row.carry?{carry:row.carry,carryAim:row.carryAim??0}:{};
      const before:UnitAnimationFrame={mode:'idle',frame:a!,...carry},after={...before,frame:b!};
      const original=raster(row.kind,team,before,2,facing,actionPaintSize(before,row.kind),row.appearance);
      expect(visible(original)).toBe(true);
      assertSame(original,raster(row.kind,team,after,2,facing,actionPaintSize(after,row.kind),row.appearance),JSON.stringify({row,a,b,facing,team}));
      if(++comparisons%RASTER_BATCH_SIZE===0)await yieldImmediate();
    }
  },30000);
  it('shares only the ignored inputs of stock creature and siege painters',()=>{
    expect(unitPaintKey('redDragon',TEAMS[0],IDLE)).toBe(unitPaintKey('redDragon',TEAMS[1],IDLE));
    expect(unitPaintKey('redDragon',TEAMS[0],IDLE)).not.toBe(unitPaintKey('redDragon',TEAMS[0],{mode:'walk',frame:1}));
    expect(unitPaintKey('catapult',TEAMS[0],{mode:'idle',frame:7})).toBe(unitPaintKey('catapult',TEAMS[0],IDLE));
    expect(unitPaintKey('ballista',TEAMS[0],{mode:'attack',frame:2,variant:2,aim:-6})).toBe(unitPaintKey('ballista',TEAMS[0],{mode:'attack',frame:2,variant:0,aim:6}));
    expect(unitPaintKey('ballista',TEAMS[0],{mode:'attack',frame:1})).not.toBe(unitPaintKey('ballista',TEAMS[0],{mode:'attack',frame:2}));
    expect(unitPaintKey('organGun',TEAMS[0],{mode:'walk',frame:0})).not.toBe(unitPaintKey('organGun',TEAMS[0],{mode:'walk',frame:2}));
    expect(unitPaintKey('siegeRam',TEAMS[0],IDLE)).not.toBe(unitPaintKey('siegeRam',TEAMS[1],IDLE));
  });
  it('retains figure colors, action variations and all opaque story-variant inputs',()=>{
    const attack:UnitAnimationFrame={mode:'attack',frame:1,variant:0,aim:-6};
    for(const kind of ['footman','priest','knight'] as const){
      expect(unitPaintKey(kind,TEAMS[0],attack)).not.toBe(unitPaintKey(kind,TEAMS[1],attack));
      expect(unitPaintKey(kind,TEAMS[0],attack)).not.toBe(unitPaintKey(kind,TEAMS[0],{...attack,variant:1}));
      expect(unitPaintKey(kind,TEAMS[0],attack)).not.toBe(unitPaintKey(kind,TEAMS[0],{...attack,aim:6}));
      expect(unitPaintKey(kind,TEAMS[0],attack)).not.toBe(unitPaintKey(kind,TEAMS[0],{...attack,carry:6,carryAim:6}));
    }
    for(const kind of ['wildling','catapult'] as const)for(const variant of ['', 'story:custom']){
      expect(unitPaintKey(kind,TEAMS[0],attack,variant)).not.toBe(unitPaintKey(kind,TEAMS[1],attack,variant));
      expect(unitPaintKey(kind,TEAMS[0],attack,variant)).not.toBe(unitPaintKey(kind,TEAMS[0],{...attack,variant:1},variant));
      expect(unitPaintKey(kind,TEAMS[0],{mode:'idle',frame:0},variant)).not.toBe(unitPaintKey(kind,TEAMS[0],{mode:'idle',frame:1},variant));
    }
    expect(unitPaintKey('wildling',TEAMS[0],IDLE,'story:a')).not.toBe(unitPaintKey('wildling',TEAMS[0],IDLE,'story:b'));
  });
  it('proves exact whole-domain RGBA for every stock creature across three owner colors',async()=>{
    const kinds=(Object.keys(creatures) as UnitKind[]).filter(kind=>!TEAM_CREATURES.has(kind)),poses=creaturePoses();let comparisons=0,pixels=0;
    for(const kind of TEAM_CREATURES)expect(unitPaintKey(kind,TEAMS[0],IDLE)).not.toBe(unitPaintKey(kind,TEAMS[1],IDLE));
    for(const kind of kinds)for(const density of [2,4])for(const facing of [-1,1] as const)for(const pose of poses){
      const original=raster(kind,TEAMS[0],pose,density,facing),key=unitPaintKey(kind,TEAMS[0],pose);
      expect(visible(original),JSON.stringify({kind,density,facing,pose})).toBe(true);
      for(const team of TEAMS.slice(1)){
        const label=JSON.stringify({kind,density,facing,pose,team});
        expect(unitPaintKey(kind,team,pose),label).toBe(key);
        assertSame(original,raster(kind,team,pose,density,facing),label);comparisons++;pixels+=original.length/4;
        if(comparisons%RASTER_BATCH_SIZE===0)await yieldImmediate();
      }
    }
    console.info(JSON.stringify({proof:'stock-creature owner-color identity',assets:kinds,poses:poses.length,densities:[2,4],facings:[-1,1],colors:TEAMS,comparisons,comparedPixels:pixels,maxChannelDifference:0}));
  },180000);
  it('proves exact siege RGBA for all attack frames, three variants and thirteen aim bins',async()=>{
    let comparisons=0,pixels=0;
    for(const kind of SIEGE)for(const density of [2,4])for(const facing of [-1,1] as const){
      for(let frame=0;frame<6;frame++){
        const base:UnitAnimationFrame=frame<5?{mode:'attack',frame}:IDLE;
        const tile=actionPaintSize({mode:'attack',frame},kind),original=raster(kind,TEAMS[0],base,density,facing,tile),key=unitPaintKey(kind,TEAMS[0],base);
        expect(visible(original)).toBe(true);
        for(let variant=0;variant<3;variant++)for(let aim=-6;aim<=6;aim++){
          const pose:UnitAnimationFrame={mode:'attack',frame,variant,aim};
          const label=JSON.stringify({kind,density,facing,pose});
          expect(unitPaintKey(kind,TEAMS[0],pose),label).toBe(key);
          assertSame(original,raster(kind,TEAMS[0],pose,density,facing,tile),label);comparisons++;pixels+=original.length/4;
          if(comparisons%RASTER_BATCH_SIZE===0)await yieldImmediate();
        }
      }
      for(const mode of ['idle','walk','cast','work'] as const)for(let frame=0;frame<(mode==='idle'||mode==='walk'?8:6);frame++){
        const pose:UnitAnimationFrame={mode,frame,variant:2,aim:6,carry:3,carryAim:-6};
        const canonical:UnitAnimationFrame=mode==='walk'?{mode,frame}:IDLE,tile=actionPaintSize(pose,kind);
        const label=JSON.stringify({kind,density,facing,pose});
        expect(unitPaintKey(kind,TEAMS[0],pose),label).toBe(unitPaintKey(kind,TEAMS[0],canonical));
        assertSame(raster(kind,TEAMS[0],canonical,density,facing,tile),raster(kind,TEAMS[0],pose,density,facing,tile),label);comparisons++;pixels+=(tile*density)**2;
        if(comparisons%RASTER_BATCH_SIZE===0)await yieldImmediate();
      }
    }
    console.info(JSON.stringify({proof:'stock-siege action identity',assets:SIEGE,attackFrames:6,variants:3,aimBins:13,densities:[2,4],facings:[-1,1],comparisons,comparedPixels:pixels,maxChannelDifference:0}));
  },180000);
  it('keeps the authored figure light and team-color differences instead of assuming mirror or tint equivalence',()=>{
    const kind='footman',right=raster(kind,TEAMS[0],IDLE,4,1),left=raster(kind,TEAMS[0],IDLE,4,-1),other=raster(kind,TEAMS[1],IDLE,4,1);
    expect(visible(right)).toBe(true);expect(bytes(right).equals(bytes(other))).toBe(false);
    const size=128*4,mirrored=new Uint8ClampedArray(right.length);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)mirrored.set(right.subarray((y*size+x)*4,(y*size+x+1)*4),(y*size+size-1-x)*4);
    expect(bytes(mirrored).equals(bytes(left))).toBe(false);
  });
});
