import {CombatPresentationTracker} from '../combat-presentation';
import {strikeUnit} from '../../shared/sim';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import type {Scene,Material} from 'three';
const gpu=vi.hoisted(()=>({scene:undefined as Scene|undefined,sizes:0,ratios:0,compiled:[] as Mesh[],casters:[] as {side:number;morph:boolean}[][]}));
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return{...actual,WebGLRenderer:class{
    shadowMap={enabled:false,type:0};capabilities={getMaxAnisotropy:()=>8};extensions={has:()=>true};toneMapping=0;toneMappingExposure=1;
    setClearColor(){}setPixelRatio(){gpu.ratios++;}setSize(){gpu.sizes++;}dispose(){}forceContextLoss(){}
    initTexture(){}copyTextureToTexture(){}getRenderTarget(){return null;}getActiveCubeFace(){return 0;}getActiveMipmapLevel(){return 0;}setRenderTarget(){}
    render(scene:Scene){
      scene.updateMatrixWorld(true);gpu.scene=scene;
      // The shadow pass draws casters in scene order: what each render's sequence of casters was.
      const casters:{side:number;morph:boolean}[]=[];
      scene.traverseVisible(object=>{const mesh=object as InstancedMesh;if(mesh.isInstancedMesh&&mesh.castShadow&&!mesh.customDepthMaterial&&!Array.isArray(mesh.material))casters.push({side:mesh.material.side,morph:mesh.morphTexture!==null});});
      gpu.casters.push(casters);
    }
    compileAsync(scene:Scene){gpu.compiled=[];scene.traverseVisible(object=>{if((object as Mesh).isMesh)gpu.compiled.push(object as Mesh);});return Promise.resolve();}
    clear(){}getContext(){return{RGBA:0,UNSIGNED_BYTE:0,readPixels(){}};}
  }};
});
import {World3DLayer} from './world-layer';
import {spellOrbPalette} from '../art/effect-presentation';
import {worldModels} from './model-library';
import {projectWorld} from './projection';
import {createRoom,roomToGameSetup} from '../../shared/rooms';
import {createGame} from '../../shared/sim';
import {boardUnit} from '../../shared/decks';
import {beginShipBoarding,gangwayCrossingPosition,gangwaySurface,updateShipGangways,GANGWAY_SETUP_TICKS} from '../../shared/ship-gangway';
import {createShipWebglScene} from '../../recorder/scenes/ship-webgl';
import {snapshotGame} from '../../shared/sim';
import {UNIT_DEFS} from '../../shared/catalog';
import {SHIP_CAMERA,shipProfile,localToWorld,isShipKind} from '../../shared/ship-geometry';
import {UnitFacingTracker} from '../unit-facing';
import {UnitAnimationTracker} from '../unit-animation';
import {unitGlyphScale} from '../glyphs';
import {UnitMotionSmoother} from '../unit-motion';
import {setScratchCanvasFactory} from '../art/scratch-canvas';
import type {WorldFrame} from '../world-renderer';
import {ownerInk} from '../world-renderer';
import {InstancedMesh,MeshBasicMaterial,Mesh,FrontSide,DataTexture,ShaderMaterial,Matrix4,Vector3,DataArrayTexture} from 'three';

afterEach(()=>vi.unstubAllGlobals());
function setup(){
  gpu.sizes=gpu.ratios=0;
  vi.stubGlobal('devicePixelRatio',2);
  vi.stubGlobal('document',{createElement:()=>createCanvas(1,1)});
  vi.stubGlobal('fetch',async(url:string)=>new Response(readFileSync(`public/art/world3d/${url.split('/art/world3d/')[1]!.split('?')[0]}`)));
  setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
  const {game,ship}=createShipWebglScene();
  const frame:WorldFrame={snapshot:snapshotGame(game),ctx:createCanvas(1200,900).getContext('2d') as unknown as CanvasRenderingContext2D,view:{x:300,y:300,width:1200,height:900},now:0,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),motion:new UnitMotionSmoother(),labels:{mercenaryStock:()=>'',unitKind:()=>''}};
  const canvas=new EventTarget() as HTMLCanvasElement;
  // Every card a frame needs is painted in that frame: what these tests read must not depend on the machine's speed.
  return{game,ship,frame,canvas,layer:World3DLayer.create(canvas,{} as WebGL2RenderingContext,Infinity)};
}
// setup's devicePixelRatio 2 at zoom 1: cards are painted at 2 texels per world unit (see @@@card-density).
const CARD_DENSITY=2;
function paintedMeshes(){return gpu.scene!.getObjectsByProperty('name','PaintedCards').filter(object=>object instanceof InstancedMesh&&object.visible) as InstancedMesh[];}
function paintedBinding(mesh:InstancedMesh,index:number){
 const card=mesh.userData.cards[index] as {sourceSize:number;baseMip:number;page:{texture:DataArrayTexture}},bank=mesh.geometry.getAttribute('cardBank').getX(index);
 const texture:DataArrayTexture=mesh.userData.banks[bank].texture;
 expect(texture).toBe(card.page.texture);expect(texture.image.width).toBe(card.sourceSize/2**card.baseMip);expect(texture.image.height).toBe(card.sourceSize/2**card.baseMip);
 return{card,texture};
}
describe('production scene CPU integration (GPU renderer mocked)',()=>{
  it('projects only viewport candidates while keeping exact offscreen positions available on demand',async()=>{
    const {game,frame,layer}=setup();game.units=[];game.items=[];game.buildings=[];game.effects=[];
    const visible=game.spawnUnit('player','footman',600,600);
    for(let i=0;i<10000;i++)game.spawnUnit('player','footman',6000+i%100*40,6000+Math.floor(i/100)*40);
    frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');
    const poses=vi.spyOn(frame.animation!,'frame');layer.draw(frame);
    expect(poses.mock.calls.map(call=>call[0].id)).toEqual([visible.id]);
    expect(layer.viewStats()).toMatchObject({units:10001,candidates:1,posed:1,builds:1});
    const hidden=frame.snapshot.units[8000]!;
    expect(layer.positions.get(hidden.id)).toMatchObject({x:hidden.x,y:hidden.y,bodyY:hidden.y-17*unitGlyphScale(hidden.radius)});
    poses.mockClear();layer.draw({...frame,now:16});
    expect(poses.mock.calls).toHaveLength(1);expect(layer.viewStats().builds).toBe(1);
    poses.mockClear();layer.draw({...frame,now:32,view:{x:30000,y:30000,width:1200,height:900}});
    expect(poses).not.toHaveBeenCalled();expect(layer.viewStats()).toMatchObject({candidates:0,posed:0,positions:0});
    layer.reset();expect(layer.positions.get(hidden.id)).toBeUndefined();layer.dispose();
  });
  it('retains offscreen release facing and ready direction through reentry and expiry without generating its frames',async()=>{
    const {game,frame,layer}=setup();game.units=[];game.items=[];game.buildings=[];game.effects=[];
    const unit=game.spawnUnit('player','lancer',6000,600);unit.order={type:'hold',x:unit.x,y:unit.y};
    game.effects=[{id:'hidden-left-release',type:'melee',sourceId:unit.id,sourceKind:unit.kind,actionMode:'attack',actionTick:0,x:5900,y:500,fromX:6000,fromY:600,toX:5900,toY:500,duration:16,remaining:16}];
    frame.view={x:0,y:0,width:1200,height:900};frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');
    const poses=vi.spyOn(frame.animation!,'frame'),original=JSON.stringify(frame.snapshot);layer.draw(frame);
    expect(JSON.stringify(frame.snapshot)).toBe(original);expect(frame.facing.releaseFacing(unit.id)).toBe(-1);expect(poses).not.toHaveBeenCalled();
    for(let tick=1;tick<=24;tick++){game.tick=tick;game.effects=[];frame.snapshot=snapshotGame(game);frame.now=tick*50;layer.draw(frame);}
    expect(poses).not.toHaveBeenCalled();
    const reentry={...frame,view:{x:5500,y:0,width:1200,height:900}};layer.draw(reentry);
    expect(layer.positions.get(unit.id)!.facing).toBe(-1);expect(frame.animation!.frame(unit,frame.now).carryDirection?.x).toBeLessThan(0);
    poses.mockClear();
    for(let tick=25;tick<=80;tick++){game.tick=tick;frame.snapshot=snapshotGame(game);frame.now=tick*50;layer.draw(frame);}
    expect(poses).not.toHaveBeenCalled();layer.draw({...frame,view:reentry.view});
    expect(layer.positions.get(unit.id)!.facing).toBe(-1);expect(frame.animation!.frame(unit,frame.now).carryDirection).toBeUndefined();layer.dispose();
  });
  it('keeps vertical deck strikes on the crew heading when the release begins offscreen',async()=>{
    for(const dy of [-100,100]){
      const {game,ship,frame,layer}=setup();
      const crew=game.units.find(unit=>unit.deck)!;
      ship.sailing!.heading=Math.PI;
      const foot=localToWorld(ship,crew.deck!);crew.x=foot.x;crew.y=foot.y;
      crew.order={type:'hold',x:crew.x,y:crew.y};
      game.units=[ship,crew];game.buildings=[];game.effects=[];
      frame.view={x:6000,y:6000,width:800,height:600};
      frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');layer.draw(frame);
      // The global side starts right; the rotated deck's stationary crew face
      // left. A vertical release must keep that deck-side fallback.
      expect(frame.facing.facing(crew.id)).toBe(1);
      expect(layer.positions.get(crew.id)!.facing).toBe(-1);
      game.effects.push({id:`vertical-deck:${dy}`,type:'melee',x:crew.x,y:crew.y+dy,
        duration:16,remaining:16,sourceId:crew.id,actionMode:'attack',actionTick:game.tick,
        fromX:crew.x,fromY:crew.y,toX:crew.x,toY:crew.y+dy});
      frame.snapshot=snapshotGame(game);layer.draw(frame);
      expect(frame.animation!.frame(crew,frame.now)).toMatchObject({mode:'attack',direction:{x:0,y:dy}});
      expect(layer.positions.get(crew.id)!.facing).toBe(-1);
      expect(frame.facing.releaseFacing(crew.id)).toBe(-1);
      // Panning back during the same tick must expose the same contact pose.
      frame.view={x:ship.x-200,y:ship.y-200,width:800,height:600};layer.draw(frame);
      expect(layer.positions.get(crew.id)!.facing).toBe(-1);
      const cards=paintedMeshes();
      expect(cards.flatMap(mesh=>mesh.userData.ids.slice(0,mesh.count))).toContain(crew.id);
      layer.dispose();
    }
  });
  it('retains context listeners across reset and removes them on final disposal',async()=>{
    const {frame,layer,canvas}=setup(),remove=vi.spyOn(canvas,'removeEventListener');
    await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    const before=layer.cardStats().mipLayerUpdates;
    const lost=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(lost);expect(lost.defaultPrevented).toBe(true);
    layer.draw(frame);expect(layer.cardStats().mipLayerUpdates).toBe(before);
    canvas.dispatchEvent(new Event('webglcontextrestored'));layer.draw(frame);expect(layer.cardStats().mipLayerUpdates).toBeGreaterThan(before);
    layer.reset();expect(remove).not.toHaveBeenCalled();layer.draw(frame);
    canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));canvas.dispatchEvent(new Event('webglcontextrestored'));layer.draw(frame);
    layer.dispose();expect(remove.mock.calls.map(call=>call[0])).toEqual(['webglcontextlost','webglcontextrestored']);
  });
  it('draws real hit ink in GPU depth and clears it on a world reset without touching card identities',async()=>{
    const {game,ship,frame,layer}=setup();frame.combat=new CombatPresentationTracker();
    const crew=game.units.find(unit=>unit.deck)!;crew.hp=55;
    strikeUnit(game,{id:'offshore-caster',owner:'enemy',x:ship.x+100,y:ship.y},crew,38,'spell');
    frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    expect(layer.combatStats().count).toBeGreaterThan(0);expect(layer.combatStats().body).toBeGreaterThan(0);expect(layer.combatStats().overflow).toBe(0);
    const ink=gpu.scene!.getObjectByName('CombatInk') as InstancedMesh;
    expect((ink.material as ShaderMaterial).depthTest).toBe(true);expect(ink.userData.ids).toBeUndefined();
    layer.reset();expect(layer.combatStats().count).toBe(0);expect(ink.visible).toBe(false);
    layer.dispose();expect(layer.combatStats()).toMatchObject({disposed:true,capacity:0,count:0});expect(gpu.scene!.children).toHaveLength(0);
  });
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
    frame.selectedIds=new Set([crew.id]);frame.hoveredId=crew.id;
    frame.snapshot=snapshotGame(game);layer.draw(frame);
    expect(active()).toHaveLength(1);
    const point=gangwayCrossingPosition(crew.gangway,game.units)!;
    expect(layer.positions.get(crew.id)!.x).toBeCloseTo(point.x);expect(layer.positions.get(crew.id)!.y).toBeCloseTo(point.y);
    const marker=gpu.scene!.children.find(object=>object.name==='SelectionSurface' && object.visible) as InstancedMesh;
    expect(marker.count,'selected and hovered crew use one actual bridge-plane marker').toBe(1);
    marker.getMatrixAt(0,matrix);
    const bridgeHeight=(shipProfile(source)!.deckHeight+shipProfile(target)!.deckHeight)/2;
    expect(matrix.elements[13]).toBeGreaterThan(bridgeHeight);expect(matrix.elements[13]).toBeLessThan(bridgeHeight+.16);
    const slope=(shipProfile(target)!.deckHeight-shipProfile(source)!.deckHeight)/Math.hypot(surface.target.x-surface.source.x,surface.target.y-surface.source.y);
    expect(matrix.elements[1]!/Math.hypot(matrix.elements[0]!,matrix.elements[2]!)).toBeCloseTo(slope,4);
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
  it('keeps deck remains in a separate depth-tested transparent batch while the hull moves',async()=>{
    const {ship,frame,layer}=setup();delete frame.motion;
    const corpse={id:'deck-remains-proof',unitId:'dead-crew',kind:'footman' as const,owner:ship.owner,x:ship.x,y:ship.y,radius:18,diedAtTick:0,deck:{shipId:ship.id,x:12,y:18}};
    frame.snapshot.corpses=[corpse];
    await layer.prepare(frame.snapshot,'match');layer.draw(frame);
    const remains=()=>paintedMeshes().find(object=>object.userData.ids?.includes(corpse.id));
    const mesh=remains()!;expect(mesh).toBeDefined();
    const material=mesh.material as MeshBasicMaterial;
    expect(layer.cardStats().maxTextureBanks).toBe(1);expect(layer.remainsStats().maxTextureBanks).toBe(1);expect(material.customProgramCacheKey()).toBe('painted-card-banks-v1:1:true');
    expect(material).toMatchObject({transparent:true,depthTest:true,depthWrite:false,alphaTest:.01});
    expect(mesh.castShadow).toBe(false);expect(mesh.renderOrder).toBeGreaterThan(-1);expect(mesh.renderOrder).toBeLessThan(0);
    expect(layer.positions.has(corpse.id)).toBe(false);
    const matrix=new Matrix4();mesh.getMatrixAt(mesh.userData.ids.indexOf(corpse.id),matrix);
    expect(matrix.elements[1]).toBeCloseTo(0);expect(matrix.elements[5]).toBeCloseTo(0);
    expect(matrix.elements[13]).toBeCloseTo(shipProfile(ship)!.deckHeight+.12);
    const rasterized=layer.remainsStats().rasterizations;
    const live=frame.snapshot.units.find(unit=>unit.id===ship.id)!;
    live.x+=40;live.sailing!.heading+=Math.PI/2;frame.snapshot.tick+=200;frame.now+=10000;
    layer.draw(frame);expect(remains()).toBeDefined();expect(layer.remainsStats().rasterizations).toBe(rasterized);
    frame.snapshot.units=[];frame.snapshot.tick++;
    layer.draw(frame);expect(remains()).toBeUndefined();
    layer.dispose();expect(layer.remainsStats()).toMatchObject({pages:0,cards:0,pixels:0});
  });
  it('prepares only exact future deck raster keys at both densities, then reuses their pixels when the real corpse appears',async()=>{
    const {ship,frame,layer}=setup();
    const future={id:'future-deck-remains-proof',unitId:'dead-crew',kind:'footman' as const,owner:ship.owner,x:ship.x,y:ship.y,radius:18,diedAtTick:60,deck:{shipId:ship.id,x:12,y:18}};
    const {deck:_deck,...ground}=future;
    const original=JSON.stringify(frame.snapshot);
    await layer.prepare(frame.snapshot,'home');layer.reset();
    layer.prepareRemains(frame.snapshot,{corpses:[future,future,ground]});
    const prepared=layer.remainsStats();
    expect(prepared).toMatchObject({pages:0,cards:0,rasterizations:0,preparedRasters:2});
    expect(prepared.rasterCache.entries).toBe(2);expect(JSON.stringify(frame.snapshot)).toBe(original);
    frame.snapshot.corpses=[future];frame.snapshot.tick=60;
    for(const zoom of [.6,.8]){
      frame.view={...frame.view,zoom};layer.draw(frame);
      const drawn=layer.remainsStats();
      expect(drawn.rasterStages.readbackMs).toBe(prepared.rasterStages.readbackMs);
      expect(drawn.rasterCache.hits).toBeGreaterThan(prepared.rasterCache.hits);
      expect(paintedMeshes().some(mesh=>mesh.userData.ids.includes(future.id))).toBe(true);
    }
    layer.dispose();
  });

  it('compiles every match variant while the match loads, and keeps those programs through resets',async()=>{
    const {frame,layer}=setup();gpu.casters=[];await layer.prepare(frame.snapshot,'match');
    // A one-sided caster right after a morphing sail: the shadow depth variant only that order compiles (see @@@shadow-depth-variants).
    expect(gpu.casters.some(casters=>casters.some((caster,i)=>i>0&&casters[i-1]!.morph&&!caster.morph&&caster.side===FrontSide))).toBe(true);
    const compiled=gpu.compiled,materials=new Set<Material>(compiled.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]));
    // The variants first drawn minutes into a match: a building under construction, a selected ship's see-through sail,
    // the troop and deck remains cards, combat ink.
    expect([...materials].some(material=>material.transparent&&material.opacity===.48)).toBe(true);
    expect([...materials].some(material=>material.name.startsWith('unbleached sail')&&material.opacity===.22)).toBe(true);
    expect(compiled.filter(mesh=>mesh.name==='PaintedCards')).toHaveLength(2);
    expect(compiled.some(mesh=>mesh.name==='CombatInk')).toBe(true);
    // Nothing of the warm-up stays in the drawn scene.
    expect(gpu.scene!.getObjectsByProperty('name','PaintedCards').filter(object=>object.visible)).toHaveLength(0);
    const disposed=vi.fn();for(const material of materials)material.addEventListener('dispose',disposed);
    layer.reset();layer.draw(frame);layer.reset();
    expect(disposed).not.toHaveBeenCalled();
    layer.dispose();expect(disposed).toHaveBeenCalled();
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
    const cards=paintedMeshes();
    expect(cards.length).toBeGreaterThan(0);
    const painted=cards as InstancedMesh[],paintedIds=painted.flatMap(mesh=>mesh.userData.ids.slice(0,mesh.count));
    expect(paintedIds.sort()).toEqual(game.units.filter(unit=>!isShipKind(unit.kind)&&!unit.cabin).map(unit=>unit.id).sort());
    for(const mesh of painted){
      const material=mesh.material as MeshBasicMaterial;
      expect(material.toneMapped).toBe(false);expect(material.alphaTest).toBe(.4);
      for(let i=0;i<mesh.count;i++){
        const unit=game.units.find(unit=>unit.id===mesh.userData.ids[i])!,matrix=new Matrix4();mesh.getMatrixAt(i,matrix);
        const {card}=paintedBinding(mesh,i);
        // The shader expands cardRect before applying the instance matrix;
        // one original source texel still covers 1/CARD_DENSITY authored unit on both axes.
        const rect=mesh.geometry.getAttribute('cardRect');
        expect(new Vector3().setFromMatrixColumn(matrix,0).length()*(rect.getZ(i)-rect.getX(i))/card.sourceSize).toBeCloseTo(unitGlyphScale(unit.radius)/CARD_DENSITY,5);
        expect(new Vector3().setFromMatrixColumn(matrix,1).length()*(rect.getW(i)-rect.getY(i))/card.sourceSize).toBeCloseTo(unitGlyphScale(unit.radius)/(CARD_DENSITY*Math.tan(SHIP_CAMERA.tilt)),5);
      }
    }
    frame.now+=16;layer.draw(frame);expect(gpu.sizes).toBe(1);expect(gpu.ratios).toBe(1);
    frame.view={...frame.view,width:1100};layer.draw(frame);expect(gpu.sizes).toBe(2);
    expect(JSON.stringify(frame.snapshot)).toBe(original);layer.dispose();
  });
  it('uses story painters and variant cache identity with the same uncapped scale and foot anchor as Canvas',async()=>{
    const {game,frame,layer}=setup();game.units=[];game.buildings=[];
    const first=game.spawnUnit('player','footman',600,600),second=game.spawnUnit('player','footman',700,600);
    first.variant='story:first';second.variant='story:second';first.radius=second.radius=36;
    const paint=(ctx:CanvasRenderingContext2D)=>{ctx.fillRect(-8,-30,16,47);},one=vi.fn(paint),two=vi.fn(paint);
    frame.models=variant=>({paint:variant==='story:first'?one:two});frame.reducedMotion=true;frame.snapshot=snapshotGame(game);
    await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    expect(one).toHaveBeenCalledTimes(1);expect(two).toHaveBeenCalledTimes(1);expect(one.mock.calls[0]).toEqual(expect.arrayContaining([{mode:'idle',frame:0}]));
    expect(layer.cardStats().cards).toBe(2);
    const meshes=paintedMeshes();
    expect(meshes.reduce((sum,mesh)=>sum+mesh.count,0)).toBe(2);
    expect(meshes.flatMap(mesh=>mesh.userData.ids.slice(0,mesh.count)).sort()).toEqual([first.id,second.id].sort());
    for(const mesh of meshes)for(let i=0;i<mesh.count;i++){
      const unit=game.units.find(unit=>unit.id===mesh.userData.ids[i])!,matrix=new Matrix4();mesh.getMatrixAt(i,matrix);
      const {card}=paintedBinding(mesh,i),width=card.sourceSize,height=card.sourceSize;
      const right=new Vector3().setFromMatrixColumn(matrix,0).normalize();
      const rect=mesh.geometry.getAttribute('cardRect');
      expect(new Vector3().setFromMatrixColumn(matrix,0).length()*(rect.getZ(i)-rect.getX(i))/width).toBeCloseTo(2/CARD_DENSITY,5);
      expect(new Vector3().setFromMatrixColumn(matrix,1).length()*(rect.getW(i)-rect.getY(i))/height).toBeCloseTo(2/(CARD_DENSITY*Math.tan(SHIP_CAMERA.tilt)),5);
      let ink=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mesh.userData.paintedHit(i,{x:(x+.5)/width,y:(y+.5)/height})){
        const world=new Vector3(rect.getX(i)+(x+.5)/width*(rect.getZ(i)-rect.getX(i)),rect.getY(i)+(y+.5)/height*(rect.getW(i)-rect.getY(i)),0).applyMatrix4(matrix);
        const horizontal=world.clone().sub(new Vector3(unit.x,0,unit.y)).dot(right);
        minX=Math.min(minX,horizontal);maxX=Math.max(maxX,horizontal);minY=Math.min(minY,world.y);maxY=Math.max(maxY,world.y);ink++;
      }
      // Every opaque source texel survives, with the same doubled rectangle
      // and its bottom precisely at the world foot plane (pixel centers inset).
      // A texel center sits half a texel, 2/(2*CARD_DENSITY) world units at scale 2, inside the rectangle.
      const inset=1/CARD_DENSITY;
      expect(ink).toBe(16*47*CARD_DENSITY*CARD_DENSITY);expect(minX).toBeCloseTo(-16+inset,4);expect(maxX).toBeCloseTo(16-inset,4);
      expect(minY).toBeCloseTo(inset/Math.tan(SHIP_CAMERA.tilt),4);expect(maxY).toBeCloseTo((94-inset)/Math.tan(SHIP_CAMERA.tilt),4);
    }
    expect(layer.positions.get(first.id)!.bodyY).toBeCloseTo(first.y-34);layer.dispose();
  });
  it('batches spell orbs by the shared caster palette and releases every owned material',async()=>{
    const {game,frame,layer}=setup();game.players.player.race='grove';game.players.enemy.race='ember';
    game.effects=([{sourceKind:'priest',owner:'player'},{sourceKind:'priest',owner:'enemy'},{sourceKind:'ogreMage'},{sourceKind:'priest',owner:'player'}] as const).map((source,i)=>({id:`orb:${i}`,type:'projectile' as const,x:600+i*20,y:600,remaining:5,duration:10,attackKind:'magic' as const,...source}));
    game.effects.push({id:'orb:unknown',type:'projectile',x:680,y:600,remaining:5,duration:10,attackKind:'magic'});
    expect(spellOrbPalette(undefined)).toEqual(spellOrbPalette('ogreMage'));
    frame.snapshot=snapshotGame(game);const original=JSON.stringify(frame.snapshot);await layer.prepare(frame.snapshot,'home');layer.draw(frame);
    const orbs=gpu.scene!.children.filter(object=>object instanceof InstancedMesh&&object.name==='SpellOrb') as InstancedMesh[];
    expect(orbs).toHaveLength(3);expect(orbs.reduce((n,mesh)=>n+mesh.count,0)).toBe(5);expect(new Set(orbs.map(mesh=>mesh.geometry)).size).toBe(1);
    for(const mesh of orbs){
      const effect=frame.snapshot.effects.find(effect=>effect.id===mesh.userData.ids[0])!,glow=spellOrbPalette(effect.sourceKind,effect.owner?frame.snapshot.players[effect.owner]?.race:undefined).glow;
      const expected=new MeshBasicMaterial({color:`rgb(${glow.r},${glow.g},${glow.b})`});
      expect((mesh.material as MeshBasicMaterial).color.equals(expected.color)).toBe(true);expected.dispose();
    }
    const releases=orbs.map(mesh=>vi.spyOn(mesh.material as MeshBasicMaterial,'dispose'));expect(JSON.stringify(frame.snapshot)).toBe(original);
    layer.dispose();for(const release of releases)expect(release).toHaveBeenCalledTimes(1);
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
    const cards=paintedMeshes();
    expect(cards.reduce((sum,card)=>sum+card.count,0)).toBe(game.units.length);layer.dispose();
  });
  it('batches all 2,000 matching troops across shared crop pages instead of allocating one GPU object per unit',async()=>{
    const {game,frame,layer}=setup();game.units=[];game.buildings=[];
    for(let i=0;i<2000;i++)game.spawnUnit('player','footman',400+(i%50)*14,400+Math.floor(i/50)*12);
    frame.snapshot=snapshotGame(game);await layer.prepare(frame.snapshot,'home');
    const begin=performance.now();layer.draw(frame);const duration=performance.now()-begin;
    const actors=gpu.scene!.getObjectsByProperty('isInstancedMesh',true) as InstancedMesh[];
    const painted=actors.filter(actor=>actor.name==='PaintedCards'&&actor.visible);
    expect(painted.reduce((sum,actor)=>sum+actor.count,0)).toBe(2000);
    expect(painted.flatMap(actor=>actor.userData.ids.slice(0,actor.count)).sort()).toEqual(game.units.map(unit=>unit.id).sort());
    // Chunks bind shared resident pages; neither is allocated per unit.
    expect(painted.length).toBeGreaterThan(0);expect(painted.length).toBeLessThanOrEqual(layer.cardStats().cards);
    expect(layer.cardStats().cards).toBeLessThanOrEqual(16);expect(layer.positions.size).toBe(2000);
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
    expect(layer.cardStats()).toMatchObject({pages:0,cards:0,pixels:0});
    for(const key of ['positions','templates','bounds','rigModels','rigPoses','deckMotion','entities','ships','shipPoses','gangwaySurfaces','recoil'])expect(((layer as unknown as Record<string,unknown>)[key] as Map<string,unknown>).size,key).toBe(0);
    expect((layer as unknown as {transforms:unknown[]}).transforms).toHaveLength(0);
    expect((layer as unknown as {renderer:unknown}).renderer).toBeUndefined();
    layer.draw(frame);expect(scene.children).toHaveLength(0);expect(layer.pick({x:600,y:450})).toBeUndefined();
    const second=World3DLayer.create(new EventTarget() as HTMLCanvasElement,{} as WebGL2RenderingContext,Infinity);
    await second.prepare(frame.snapshot,'home');second.draw(frame);expect(second.positions.size).toBeGreaterThan(0);second.dispose();
    source.traverse(object=>{if(object instanceof Mesh){object.geometry.removeEventListener('dispose',sharedDispose);for(const material of Array.isArray(object.material)?object.material:[object.material])material.removeEventListener('dispose',sharedDispose);}});
  });
});
