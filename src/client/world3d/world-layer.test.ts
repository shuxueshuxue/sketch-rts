import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import type {Scene} from 'three';
const gpu=vi.hoisted(()=>({scene:undefined as Scene|undefined,sizes:0,ratios:0}));
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return{...actual,WebGLRenderer:class{
    shadowMap={enabled:false,type:0};capabilities={getMaxAnisotropy:()=>8};toneMapping=0;toneMappingExposure=1;
    setClearColor(){}setPixelRatio(){gpu.ratios++;}setSize(){gpu.sizes++;}dispose(){}forceContextLoss(){}
    render(scene:Scene){scene.updateMatrixWorld(true);gpu.scene=scene;}
  }};
});
import {World3DLayer} from './world-layer';
import {worldModels} from './model-library';
import {projectWorld} from './projection';
import {createRoom,roomToGameSetup} from '../../shared/rooms';
import {createGame} from '../../shared/sim';
import {boardUnit} from '../../shared/decks';
import {beginShipBoarding,gangwayCrossingPosition,gangwaySurface,updateShipGangways,GANGWAY_SETUP_TICKS} from '../../shared/ship-gangway';
import {createShipWebglScene} from '../../recorder/scenes/ship-webgl';
import {snapshotGame} from '../../shared/sim';
import {UNIT_DEFS} from '../../shared/catalog';
import {shipProfile,localToWorld,isShipKind} from '../../shared/ship-geometry';
import {UnitFacingTracker} from '../unit-facing';
import {UnitAnimationTracker} from '../unit-animation';
import {UnitMotionSmoother} from '../unit-motion';
import {setScratchCanvasFactory} from '../art/scratch-canvas';
import type {WorldFrame} from '../world-renderer';
import {ownerInk} from '../world-renderer';
import {InstancedMesh,MeshBasicMaterial,Mesh,DataTexture,ShaderMaterial,Matrix4,Vector3} from 'three';

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
  it('colors the actual authored ensigns by owner, updates a captured flag and releases only owned batch materials',async()=>{
    const {game,ship,frame,layer}=setup();
    const other=game.spawnUnit('enemy','warship',1150,850);
    game.players.player.color='#123456';game.players.enemy.color='#b95632';
    frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'match');layer.draw(frame);
    const flags=()=>gpu.scene!.children.filter(object=>object instanceof InstancedMesh && object.visible && object.name==='OwnerFlag') as InstancedMesh[];
    expect(flags()).toHaveLength(2);
    const oak=gpu.scene!.children.find(object=>object instanceof InstancedMesh
      && !Array.isArray(object.material) && object.material.name==='weathered oak'
      && object.userData.ids.includes(ship.id) && object.userData.ids.includes(other.id)) as InstancedMesh;
    expect(oak.count).toBe(2);
    expect((oak.material as MeshBasicMaterial).color.getHexString()).not.toBe('123456');
    for(const unit of [ship,other]){
      const mesh=flags().find(mesh=>mesh.userData.ids.includes(unit.id))!;
      expect((mesh.material as MeshBasicMaterial).color.getHexString()).toBe(ownerInk(unit.owner,frame.snapshot).slice(1));
    }
    const source=worldModels.portraitModel('ships/warship')!.getObjectByName('OwnerFlag') as Mesh;
    const original=(source.material as MeshBasicMaterial).color.getHexString();
    const sharedDisposal=vi.spyOn(source.material as MeshBasicMaterial,'dispose');
    const ownedMaterial=flags()[0]!.material as MeshBasicMaterial,ownedDisposal=vi.spyOn(ownedMaterial,'dispose');
    layer.draw({...frame,now:16});
    expect(flags()[0]!.material).toBe(ownedMaterial);
    ship.owner='enemy';game.tick++;frame.snapshot=snapshotGame(game);layer.draw({...frame,now:50});
    expect(flags()).toHaveLength(1);
    expect(flags()[0]!.userData.ids).toEqual(expect.arrayContaining([ship.id,other.id]));
    expect((flags()[0]!.material as MeshBasicMaterial).color.getHexString()).toBe('b95632');
    expect((source.material as MeshBasicMaterial).color.getHexString()).toBe(original);
    layer.dispose();expect(ownedDisposal).toHaveBeenCalledTimes(1);expect(sharedDisposal).not.toHaveBeenCalled();
    sharedDisposal.mockRestore();
  });
  it('renders one physical gangway from live anchors, follows crossing crew, and releases the owned mesh',async()=>{
    const {game,frame,layer}=setup();
    game.units=[];game.items=[];game.buildings=[];game.resources=[];game.obstacles=[];game.effects=[];
    game.map={...game.map,width:2048,height:2048,terrain:{cell:32,cols:64,rows:64,cells:'~'.repeat(4096)}};
    const source=game.spawnUnit('player','transport',600,600),target=game.spawnUnit('player','carrier',600,900),crew=game.spawnUnit('player','footman',600,600);
    target.y=source.y+(shipProfile(source)!.beam+shipProfile(target)!.beam)/2+12;
    expect(boardUnit(source,crew,game.units)).toBe(true);
    source.order={type:'boardShip',targetId:target.id};
    expect(beginShipBoarding(game.map,game.units,source,target,game.tick,game)).toBe(true);
    delete frame.motion;frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    expect(gpu.scene!.children.filter(object=>object.name==='ShipGangway' && object.visible)).toHaveLength(0);
    updateShipGangways(game.map,game.units,game.tick,game);
    expect(source.sailing!.gangway!.phase).toBe('deploying');
    frame.snapshot=snapshotGame(game);const original=JSON.stringify(frame.snapshot);layer.draw(frame);
    const active=()=>gpu.scene!.children.filter(object=>object.name==='ShipGangway' && object.visible) as InstancedMesh[];
    expect(active()).toHaveLength(1);expect(active()[0]!.count).toBe(1);
    const surface=gangwaySurface(source,target)!;
    const matrix=new Matrix4();active()[0]!.getMatrixAt(0,matrix);
    const start=new Vector3(-.5,0,0).applyMatrix4(matrix),end=new Vector3(.5,0,0).applyMatrix4(matrix);
    expect(start.x).toBeCloseTo(surface.source.x,4);expect(start.z).toBeCloseTo(surface.source.y,4);
    expect(end.x).toBeCloseTo(surface.target.x,4);expect(end.z).toBeCloseTo(surface.target.y,4);
    expect(start.y).toBeCloseTo(shipProfile(source)!.deckHeight-1,4);expect(end.y).toBeCloseTo(shipProfile(target)!.deckHeight-1,4);
    expect(JSON.stringify(frame.snapshot)).toBe(original);
    game.tick+=GANGWAY_SETUP_TICKS;updateShipGangways(game.map,game.units,game.tick,game);
    crew.gangway={sourceId:source.id,targetId:target.id,t:.5,lateral:0};
    frame.snapshot=snapshotGame(game);layer.draw(frame);
    expect(active()).toHaveLength(1);
    const point=gangwayCrossingPosition(crew.gangway,game.units)!;
    expect(layer.positions.get(crew.id)!.x).toBeCloseTo(point.x);expect(layer.positions.get(crew.id)!.y).toBeCloseTo(point.y);
    source.x+=32;target.x+=32;game.tick++;frame.snapshot=snapshotGame(game);layer.draw(frame);
    expect(layer.positions.get(crew.id)!.x).toBeCloseTo(point.x+32);
    active()[0]!.getMatrixAt(0,matrix);expect(matrix.elements[12]).toBeCloseTo((surface.source.x+surface.target.x)/2+32,4);
    target.y+=40;game.tick++;frame.snapshot=snapshotGame(game);layer.draw(frame);
    expect(active()).toHaveLength(0);
    const template=(layer as unknown as {gangway:Mesh}).gangway;
    const geometryDispose=vi.spyOn(template.geometry,'dispose'),material=Array.isArray(template.material)?template.material[0]!:template.material;
    const materialDispose=vi.spyOn(material,'dispose');
    layer.dispose();layer.dispose();expect(geometryDispose).toHaveBeenCalledOnce();expect(materialDispose).toHaveBeenCalledOnce();
  });
  it('binds water to the rendered match rather than the smaller home snapshot used for preloading', async () => {
    const {frame,layer}=setup();
    const home=frame.snapshot;
    const {options}=roomToGameSetup(createRoom({id:'water-lifecycle',host:{id:'host',name:'Host'},mapId:'sapphireArchipelago',humanCount:1,aiCount:5}));
    const match=snapshotGame(createGame('sapphireArchipelago',{...options,aiPlayers:[]}));
    frame.snapshot={...match,units:[],buildings:[],effects:[],mercenaryCamps:[],shops:[]};
    await layer.prepare(home,'match'); // Production resource preload uses the home snapshot.
    layer.draw(frame);
    const water=gpu.scene!.getObjectByName('WaterSurface') as Mesh<never,ShaderMaterial>;
    const terrain=match.map.terrain!;
    expect(terrain.cols*terrain.cell).toBeGreaterThan(home.map.width);
    expect(water.scale.x).toBe(terrain.cols*terrain.cell);
    expect(water.scale.z).toBe(terrain.rows*terrain.cell);
    const texture=water.material.uniforms.shore!.value as DataTexture;
    expect(texture.image.width).toBe(terrain.cols);
    expect(texture.image.height).toBe(terrain.rows);
    const disposal=vi.spyOn(texture,'dispose');
    layer.draw({...frame,now:16,view:{...frame.view,x:0,y:0}});
    expect(water.material.uniforms.shore!.value).toBe(texture);
    await layer.prepare(home,'home'); // An asynchronous preload must not replace the active ocean.
    layer.draw({...frame,now:32});
    expect(water.material.uniforms.shore!.value).toBe(texture);
    expect(disposal).not.toHaveBeenCalled();
    layer.reset();layer.draw({...frame,snapshot:{...frame.snapshot,map:{...match.map,terrain:{cols:4,rows:4,cell:32,cells:'.'.repeat(16)}}}});
    expect(disposal).toHaveBeenCalledOnce();expect(water.visible).toBe(false);
    layer.dispose();
  });
  it('renders independent native sail morphs and moving rigging from real ship snapshots',async()=>{
    const {game,ship,frame,layer}=setup();
    const other=game.spawnUnit('player','warship',620,850);
    ship.sailing!.sail={angle:-.4,billow:-.7,set:.5,mode:'sail'};
    other.sailing!.sail={angle:.6,billow:.8,set:1,mode:'sail'};
    frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    const sails=gpu.scene!.children.filter(object=>object instanceof InstancedMesh&&object.visible&&object.morphTexture) as InstancedMesh[];
    expect(sails.length,'production GLBs contain native cloth morphs').toBeGreaterThan(0);
    const sample=sails.find(mesh=>mesh.userData.ids.includes(ship.id)&&mesh.userData.ids.includes(other.id))!;
    const probe=new Mesh(sample.geometry,sample.material),first=sample.userData.ids.indexOf(ship.id),second=sample.userData.ids.indexOf(other.id);
    sample.getMorphAt(first,probe);expect(probe.morphTargetInfluences![0]).toBeCloseTo(0);expect(probe.morphTargetInfluences![1]).toBeCloseTo(.35);expect(probe.morphTargetInfluences![2]).toBeCloseTo(.5);
    sample.getMorphAt(second,probe);expect(probe.morphTargetInfluences![0]).toBeCloseTo(.8);expect(probe.morphTargetInfluences![1]).toBeCloseTo(0);expect(probe.morphTargetInfluences![2]).toBeCloseTo(0);
    const ropes=()=>gpu.scene!.children.filter(object=>object instanceof InstancedMesh&&object.visible&&object.name.startsWith('RigRope:')) as InstancedMesh[];
    expect(ropes().length).toBeGreaterThan(0);const ropeMatrices=ropes().flatMap(mesh=>Array.from(mesh.instanceMatrix.array));
    const positions=Array.from(sample.geometry.getAttribute('position').array);
    game.tick++;ship.sailing!.sail={angle:.5,billow:.7,set:1,mode:'tacking'};frame.snapshot=snapshotGame(game);const snapshot=JSON.stringify(frame.snapshot);
    frame.now=50;layer.draw(frame);frame.now=75;layer.draw(frame);
    sample.getMorphAt(first,probe);expect(probe.morphTargetInfluences![0]).toBeCloseTo(0);expect(probe.morphTargetInfluences![1]).toBeCloseTo(0);expect(probe.morphTargetInfluences![2]).toBeCloseTo(.25);
    expect(ropes().flatMap(mesh=>Array.from(mesh.instanceMatrix.array))).not.toEqual(ropeMatrices);
    expect(Array.from(sample.geometry.getAttribute('position').array)).toEqual(positions);expect(JSON.stringify(frame.snapshot)).toBe(snapshot);
    layer.dispose();
  });
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
  it('hides cabin occupants and restores their painted picking on a return command in the same tick',async()=>{
    const {game,ship,frame,layer}=setup();await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    const crew=game.units.find(unit=>unit.deck?.shipId===ship.id)!;
    const before=layer.positions.get(crew.id)!;
    crew.cabin={shipId:ship.id,breached:true};game.tick++;
    frame.snapshot=snapshotGame(game);frame.now=50;layer.draw(frame);
    expect(layer.positions.has(crew.id)).toBe(false);expect(layer.positions.has(ship.id)).toBe(true);
    const body=projectWorld(frame.view,{x:before.x,y:before.bodyY});
    for(let y=-18;y<=18;y+=3)for(let x=-12;x<=12;x+=3)expect(layer.pick({x:body.x+x,y:body.y+y})?.id).not.toBe(crew.id);
    delete crew.cabin;frame.snapshot=snapshotGame(game);frame.now=75;layer.draw(frame);
    expect(layer.positions.has(crew.id)).toBe(true);
    const restored=layer.positions.get(crew.id)!;
    expect(restored.x).toBeCloseTo(before.x);expect(restored.y).toBeCloseTo(before.y);
    let picked=false;
    for(let y=-18;y<=18;y+=3)for(let x=-12;x<=12;x+=3)if(layer.pick({x:body.x+x,y:body.y+y})?.id===crew.id)picked=true;
    expect(picked).toBe(true);layer.dispose();
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
  it('updates mutable recorder snapshots on tick changes and same-tick array replacements',async()=>{
    const {ship,frame,layer}=setup();await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    const replacement={...ship,id:'replacement-ship'};
    frame.snapshot.units=[replacement];frame.snapshot.tick++;
    layer.draw(frame);expect(layer.positions.has(ship.id)).toBe(false);expect(layer.positions.has(replacement.id)).toBe(true);
    frame.snapshot.units=[{...replacement,id:'same-tick-ship'}];layer.draw(frame);
    expect(layer.positions.has(replacement.id)).toBe(false);expect(layer.positions.has('same-tick-ship')).toBe(true);
    layer.dispose();
  });
  it('releases owned scene references and never destroys models shared by a second layer',async()=>{
    const {frame,layer}=setup();await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    const source=worldModels.portraitModel('ships/warship')!,sharedDispose=vi.fn();
    source.traverse(object=>{if(object instanceof Mesh){object.geometry.addEventListener('dispose',sharedDispose);for(const material of Array.isArray(object.material)?object.material:[object.material])material.addEventListener('dispose',sharedDispose);}});
    const scene=gpu.scene!;layer.dispose();layer.dispose();
    expect(scene.children).toHaveLength(0);expect(sharedDispose).not.toHaveBeenCalled();
    for(const key of ['positions','templates','bounds','cards','cardGeometry','rigModels','rigPoses','deckMotion','entities','ships','shipPoses','gangwaySurfaces','recoil'])expect(((layer as unknown as Record<string,unknown>)[key] as Map<string,unknown>).size,key).toBe(0);
    expect((layer as unknown as {transforms:unknown[]}).transforms).toHaveLength(0);
    expect((layer as unknown as {renderer:unknown}).renderer).toBeUndefined();
    layer.draw(frame);expect(scene.children).toHaveLength(0);expect(layer.pick({x:600,y:450})).toBeUndefined();
    const second=World3DLayer.create({} as HTMLCanvasElement,{} as WebGL2RenderingContext);
    await second.prepare(frame.snapshot,'home');second.draw(frame);expect(second.positions.size).toBeGreaterThan(0);second.dispose();
    source.traverse(object=>{if(object instanceof Mesh){object.geometry.removeEventListener('dispose',sharedDispose);for(const material of Array.isArray(object.material)?object.material:[object.material])material.removeEventListener('dispose',sharedDispose);}});
  });
});
