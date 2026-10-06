import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import type {Scene} from 'three';
const gpu=vi.hoisted(()=>({scene:undefined as Scene|undefined,sizes:0,ratios:0}));
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return{...actual,WebGLRenderer:class{
    shadowMap={enabled:false,type:0};capabilities={getMaxAnisotropy:()=>8};toneMapping=0;toneMappingExposure=1;
    setClearColor(){}setPixelRatio(){gpu.ratios++;}setSize(){gpu.sizes++;}dispose(){}
    render(scene:Scene){scene.updateMatrixWorld(true);gpu.scene=scene;}
  }};
});
import {World3DLayer} from './world-layer';
import {projectWorld} from './projection';
import {createShipWebglScene} from '../../recorder/scenes/ship-webgl';
import {snapshotGame} from '../../shared/sim';
import {UNIT_DEFS} from '../../shared/catalog';
import {shipProfile,localToWorld,isShipKind} from '../../shared/ship-geometry';
import {UnitFacingTracker} from '../unit-facing';
import {UnitAnimationTracker} from '../unit-animation';
import {UnitMotionSmoother} from '../unit-motion';
import {setScratchCanvasFactory} from '../art/scratch-canvas';
import type {WorldFrame} from '../world-renderer';
import {InstancedMesh,MeshBasicMaterial} from 'three';

afterEach(()=>vi.unstubAllGlobals());
function setup(){
  gpu.sizes=gpu.ratios=0;
  vi.stubGlobal('devicePixelRatio',2);
  vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
  vi.stubGlobal('fetch',async(url:string)=>new Response(readFileSync(`public/art/world3d/${url.split('/art/world3d/')[1]!.split('?')[0]}`)));
  setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
  const {game,ship}=createShipWebglScene();
  const frame:WorldFrame={snapshot:snapshotGame(game),ctx:createCanvas(1200,900).getContext('2d') as unknown as CanvasRenderingContext2D,view:{x:300,y:300,width:1200,height:900},now:0,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),motion:new UnitMotionSmoother(),labels:{mercenaryStock:()=>'',unitKind:()=>''}};
  return{game,ship,frame,layer:World3DLayer.create({} as HTMLCanvasElement,{} as WebGL2RenderingContext)};
}
describe('production scene CPU integration (GPU renderer mocked)',()=>{
  it('reveals only the selected ship sails, including selection through its crew',async()=>{
    const {game,ship,frame,layer}=setup();await layer.prepare(frame.snapshot,'match');
    const crew=game.units.find(unit=>unit.deck?.shipId===ship.id)!;
    frame.selectedIds=new Set([crew.id]);layer.draw(frame);
    const materials=gpu.scene!.children.filter(object=>object instanceof InstancedMesh && object.visible).flatMap(object=>{
      const mesh=object as InstancedMesh;return Array.isArray(mesh.material)?mesh.material:[mesh.material];
    });
    const sails=materials.filter(material=>material.name.startsWith('unbleached sail'));
    expect(sails.length).toBeGreaterThan(0);expect(sails.some(material=>material.opacity===.22)).toBe(true);
    for(const material of materials.filter(material=>!material.name.startsWith('unbleached sail')&&material.name!=='TeamColor'))
      expect(material.opacity).not.toBe(.22);
    frame.selectedIds=new Set();layer.draw(frame);
    const opaque=gpu.scene!.children.filter(object=>object instanceof InstancedMesh && object.visible).flatMap(object=>{
      const mesh=object as InstancedMesh;return Array.isArray(mesh.material)?mesh.material:[mesh.material];
    }).filter(material=>material.name.startsWith('unbleached sail'));
    for(const material of opaque)expect(material.opacity).toBe(1);
    layer.dispose();
  });
  it('uses actual model geometry, painted alpha picking and deck coordinate inversion without mutating simulation',async()=>{
    const {game,ship,frame,layer}=setup();await layer.prepare(frame.snapshot,'match');
    const original=JSON.stringify(frame.snapshot);layer.draw(frame);
    const crew=game.units.find(unit=>unit.deck)!;const at=layer.positions.get(crew.id)!;
    const point=localToWorld(ship,crew.deck!),feet=projectWorld(frame.view,point,shipProfile(ship)!.deckHeight);
    expect(at.x).toBeCloseTo(point.x);expect(at.y).toBeCloseTo(point.y);
    const command=layer.plane(feet,shipProfile(ship)!.deckHeight)!;expect(command.x).toBeCloseTo(point.x);expect(command.y).toBeCloseTo(point.y);
    const body=projectWorld(frame.view,{x:at.x,y:at.bodyY});let picked=false;
    for(let y=-18;y<=18;y+=3)for(let x=-12;x<=12;x+=3)if(layer.pick({x:body.x+x,y:body.y+y})?.id===crew.id)picked=true;
    expect(picked,'crew can be selected through its visible painted pixels').toBe(true);
    const cards=gpu.scene!.children.filter(object=>object instanceof InstancedMesh && object.material instanceof MeshBasicMaterial && object.material.map);
    expect(cards.length).toBe(2);for(const object of cards){const material=(object as InstancedMesh).material as MeshBasicMaterial;expect(material.toneMapped).toBe(false);expect(material.alphaTest).toBe(.4);expect((material.map!.image as {width:number}).width).toBe(512);}
    frame.now+=16;layer.draw(frame);expect(gpu.sizes).toBe(1);expect(gpu.ratios).toBe(1);
    frame.view={...frame.view,width:1100};layer.draw(frame);expect(gpu.sizes).toBe(2);
    expect(JSON.stringify(frame.snapshot)).toBe(original);layer.dispose();
  });
  it('clears visual picking and deck projection when switching worlds before the next draw',async()=>{
    const {frame,layer}=setup();await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    expect(layer.positions.size).toBeGreaterThan(0);
    layer.reset();expect(layer.positions.size).toBe(0);
    expect(layer.pick({x:600,y:450})).toBeUndefined();expect(layer.plane({x:600,y:450},0)).toBeUndefined();
    layer.dispose();
  });
  it('prepares every land unit painting as a selectable colored cutout, including large beasts and siege weapons',async()=>{
    const {game,frame,layer}=setup();game.units=[];game.buildings=[];
    for(const kind of Object.keys(UNIT_DEFS) as (keyof typeof UNIT_DEFS)[])if(!isShipKind(kind))game.spawnUnit('player',kind,600,600);
    frame.snapshot=snapshotGame(game);frame.view={...frame.view,zoom:.6};await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    expect(layer.positions.size).toBe(game.units.length);
    for(const unit of game.units){const at=layer.positions.get(unit.id)!;expect(Number.isFinite(at.bodyY)).toBe(true);expect(at.topY).toBeLessThan(at.bodyY);}
    const cards=gpu.scene!.children.filter(object=>object instanceof InstancedMesh && object.material instanceof MeshBasicMaterial && object.material.map) as InstancedMesh[];
    expect(cards.reduce((sum,card)=>sum+card.count,0)).toBe(game.units.length);layer.dispose();
  });
  it('batches 2,000 matching troops into one actor mesh instead of allocating one GPU object per unit',async()=>{
    const {game,frame,layer}=setup();game.units=[];game.buildings=[];
    for(let i=0;i<2000;i++)game.spawnUnit('player','footman',400+(i%50)*14,400+Math.floor(i/50)*12);
    frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');
    const begin=performance.now();layer.draw(frame);const duration=performance.now()-begin;
    const actors=gpu.scene!.children.filter(object=>object instanceof InstancedMesh) as InstancedMesh[];
    expect(actors.filter(actor=>actor.count===2000)).toHaveLength(1);expect(layer.positions.size).toBe(2000);
    console.info(`2,000 troops: ${duration.toFixed(1)} ms CPU scene preparation, ${actors.length} actor mesh; GPU timing not measured`);
    layer.dispose();
  });
});
