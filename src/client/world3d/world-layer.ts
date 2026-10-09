import * as THREE from 'three';
import { worldModels,matchModelKeys,snapshotModelKeys } from './model-library';
import { activateModelPortraits } from './model-portraits';
import { ActorBatches } from './batches';
import { SelectionMarkers } from './selection-markers';
import { SailPoseTracker,shipRigModel,type ShipRigModel,type ShipRigPose } from './sail-rig';
import { CrewFacingTracker,uprightCrewRotation } from './crew-pose';
import { configureWorldCamera,screenOnPlane } from './projection';
import { flightPose } from './flight-pose';
import { paintedHit } from './painted-hit';
import { WaterSurface } from './water';
import { creatureShadow } from '../art/painted-creatures';
import { paintFigure } from '../art/painted-units';
import { UNIT_CARDS } from '../content/units';
import { unitGlyphScale } from '../glyphs';
import { footprintSquare } from '../footprint-view';
import { relationTo,RELATION_INK } from '../relations';
import { ownerInk,trackUnitFacing,type WorldFrame } from '../world-renderer';
import { interactionTargetId } from '../unit-facing';
import { installedWeapons,mountedWeaponPose } from '../../shared/ship-equipment';
import { shipProfile,shareShipProfile,shipScale,localToWorld,SHIP_CAMERA } from '../../shared/ship-geometry';
import { isInCabin } from '../../shared/ship-cabin';
import { gangwaySurface, type GangwaySurface } from '../../shared/ship-gangway';
import { gangwayCrewVisualPose } from '../ship-gangway-visual';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { ResourcePhase } from '../resources';
import type { GameSnapshot,Owner,Unit } from '../../shared/types';

export type ActorPosition={x:number;y:number;bodyY:number;topY:number};
export const PHYSICAL_EFFECTS=new Set<GameSnapshot['effects'][number]['type']>(['shellFlight','siegeBolt','projectile','muzzleFlash']);
const TILT=Math.tan(SHIP_CAMERA.tilt),UP=new THREE.Vector3(0,1,0);

export class World3DLayer {
  readonly positions=new Map<string,ActorPosition>();
  readonly camera=new THREE.OrthographicCamera();
  private scene=new THREE.Scene();
  private water=new WaterSurface(this.scene);
  private library=worldModels;
  private batches=new ActorBatches(this.scene);
  private selection=new SelectionMarkers(this.scene);
  private templates=new Map<string,THREE.Object3D>();
  private bounds=new Map<string,THREE.Box3>();
  private cards=new Map<string,{mesh:THREE.Mesh;texture:THREE.CanvasTexture;used:number}>();
  private cardPixels=0;
  private cardGeometry=new Map<number,THREE.PlaneGeometry>();
  private transforms:THREE.Matrix4[]=[];
  private transformCount=0;
  private transformPosition=new THREE.Vector3();
  private transformRotation=new THREE.Quaternion();
  private transformScale=new THREE.Vector3();
  private entities=new Map<string,GameSnapshot['units'][number]|GameSnapshot['buildings'][number]>();
  private ships=new Map<string,Unit>();
  private shipPoses=new Map<string,Unit>();
  private gangwaySurfaces=new Map<string,GangwaySurface>();
  private recoil=new Map<string,GameSnapshot['effects'][number]>();
  private indexedUnits:GameSnapshot['units']|undefined;
  private indexedBuildings:GameSnapshot['buildings']|undefined;
  private indexedEffects:GameSnapshot['effects']|undefined;
  private indexCounts='';
  private facing=new CrewFacingTracker();
  private sailMotion=new SailPoseTracker();
  private rigModels=new Map<string,ShipRigModel|undefined>();
  private rigPoses=new Map<string,{model:ShipRigModel;pose:ShipRigPose;worldRopes:THREE.Matrix4[]}>();
  private deckMotion=new Map<string,{shipId:string;x:number;y:number;fromX:number;fromY:number;at:number}>();
  private snapshot:GameSnapshot|undefined;
  private lastTick=-1;
  private at=0;
  private frame=0;
  private viewport='';
  private view:WorldFrame['view']|undefined;
  private disposed=false;
  private sun=new THREE.DirectionalLight('#f1dcc0',2.5);
  private shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShadowMaterial({opacity:.24}));
  private ball=new THREE.Mesh(new THREE.SphereGeometry(3,8,6),new THREE.MeshStandardMaterial({color:'#414945',roughness:1}));
  private bolt=new THREE.Mesh(new THREE.ConeGeometry(1.5,24,4).rotateZ(-Math.PI/2).translate(-9,0,0),new THREE.MeshStandardMaterial({color:'#c0b391',roughness:1}));
  private magic=new THREE.Mesh(new THREE.SphereGeometry(3,8,6),new THREE.MeshBasicMaterial({color:'#86c3dc',toneMapped:false}));
  private fire=new THREE.Mesh(new THREE.SphereGeometry(4,8,6),new THREE.MeshBasicMaterial({color:'#e5ad55',toneMapped:false}));
  private flag=new THREE.Mesh(new THREE.PlaneGeometry(20,13).translate(10,-6.5,0),new THREE.MeshBasicMaterial({color:'#88977c',side:THREE.DoubleSide,toneMapped:false}));
  private flash=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({color:'#ffcf74',toneMapped:false}));
  private gangway=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:'#9b7550',roughness:1}));
  private bridgeAlong=new THREE.Vector3();
  private bridgeAcross=new THREE.Vector3();
  private bridgeUp=new THREE.Vector3();
  private constructor(private renderer:THREE.WebGLRenderer|undefined){
    this.flag.material.name='TeamColor';
    this.gangway.name='ShipGangway';
    this.scene.add(new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25));
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0004;this.sun.shadow.normalBias=.35;
    this.scene.add(this.sun,this.sun.target);this.shadow.rotation.x=-Math.PI/2;this.shadow.receiveShadow=true;this.scene.add(this.shadow);
  }
  static create(canvas:HTMLCanvasElement,context:WebGL2RenderingContext){
    const renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:true});
    renderer.setClearColor(0,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
    return new World3DLayer(renderer);
  }
  async prepare(snapshot:GameSnapshot,phase:ResourcePhase,sites:readonly string[]=[]){if(this.disposed)return;await this.library.prepare(phase==='match'?matchModelKeys:[...snapshotModelKeys(snapshot),...sites.map(kind=>`buildings/${kind}`)],phase);if(!this.disposed)activateModelPortraits();}
  private template(key:string,name:string){const id=`${key}:${name}`;let model=this.templates.get(id);if(!model){model=this.library.component(key,name);if(model)this.templates.set(id,model);}return model;}
  reset(){this.lastTick=-1;this.snapshot=undefined;this.indexedUnits=this.indexedBuildings=this.indexedEffects=undefined;this.indexCounts='';this.view=undefined;this.positions.clear();this.entities.clear();this.ships.clear();this.shipPoses.clear();this.gangwaySurfaces.clear();this.recoil.clear();this.deckMotion.clear();this.facing=new CrewFacingTracker();this.sailMotion.reset();this.rigPoses.clear();this.transforms.length=0;this.transformCount=0;this.batches.dispose();this.selection.clear();this.water.prepare(undefined);}
  private pose(x:number,y:number,height:number,heading=0,scale=1,rotation?:THREE.Quaternion){
    let matrix=this.transforms[this.transformCount];
    if(!matrix){matrix=new THREE.Matrix4();this.transforms[this.transformCount]=matrix;}
    this.transformCount++;
    return matrix.compose(this.transformPosition.set(x,height,y),rotation??this.transformRotation.setFromAxisAngle(UP,-heading),this.transformScale.setScalar(scale));
  }
  private deckPosition(unit:Unit,now:number){
    const track=this.deckMotion.get(unit.id);
    // Returning from shelter can change a command snapshot before its next
    // tick. Hidden crew have no interpolation track; use their actual exit.
    if(!track || track.shipId!==unit.deck!.shipId)return unit.deck!;
    const t=Math.max(0,Math.min(1,(now-track.at)*SIM_TICKS_PER_SECOND/1000));
    return{x:track.fromX+(track.x-track.fromX)*t,y:track.fromY+(track.y-track.fromY)*t};
  }
  draw(frame:WorldFrame){
    const renderer=this.renderer;if(this.disposed||!renderer)return;
    this.frame++;this.transformCount=0;this.view=frame.view;
    const {snapshot,now}=frame;const zoom=frame.view.zoom??1;
    // Commands can replace a snapshot without advancing its tick (for example
    // a crew member leaving shelter). Mutable recorder snapshots also advance
    // ticks or replace arrays, so tick alone is not a sufficient cache key.
    const indexCounts=`${snapshot.units.length}:${snapshot.buildings.length}:${snapshot.effects.length}`;
    if(snapshot!==this.snapshot||snapshot.tick!==this.lastTick||snapshot.units!==this.indexedUnits||snapshot.buildings!==this.indexedBuildings||snapshot.effects!==this.indexedEffects||indexCounts!==this.indexCounts){
      this.entities.clear();this.ships.clear();this.recoil.clear();
      for(const unit of snapshot.units){this.entities.set(unit.id,unit);if(shipProfile(unit))this.ships.set(unit.id,unit);}
      for(const building of snapshot.buildings)this.entities.set(building.id,building);
      for(const effect of snapshot.effects)if(effect.type==='muzzleFlash'&&effect.itemId&&!this.recoil.has(effect.itemId))this.recoil.set(effect.itemId,effect);
      this.snapshot=snapshot;
      this.indexedUnits=snapshot.units;this.indexedBuildings=snapshot.buildings;this.indexedEffects=snapshot.effects;this.indexCounts=indexCounts;
    }
    const viewport=`${frame.view.width}:${frame.view.height}:${Math.min(devicePixelRatio,2)}`;
    if(viewport!==this.viewport){renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(frame.view.width,frame.view.height,false);this.viewport=viewport;}
    configureWorldCamera(this.camera,frame.view);
    // Preloading match models may use the home snapshot. Only the frame being
    // rendered is allowed to bind scene terrain, including after a map change.
    this.water.prepare(snapshot.map.terrain);
    this.water.update(now,frame.reducedMotion);
    const cx=frame.view.x+frame.view.width/(2*zoom),cy=frame.view.y+frame.view.height/(2*zoom),extent=Math.max(frame.view.width,frame.view.height)/zoom+400;
    this.shadow.position.set(cx,-.1,cy);this.shadow.scale.set(extent,extent,1);
    this.sun.position.set(cx-450,650,cy+250);this.sun.target.position.set(cx,0,cy);
    const shadow=this.sun.shadow.camera;shadow.left=shadow.bottom=-extent/2;shadow.right=shadow.top=extent/2;shadow.near=1;shadow.far=3000;shadow.updateProjectionMatrix();
    frame.animation?.update(snapshot,now);frame.motion?.update(snapshot,now);this.sailMotion.update(snapshot,now);trackUnitFacing(frame.facing,snapshot);
    if(snapshot.tick!==this.lastTick){
      this.facing.update(snapshot);const continuous=snapshot.tick===this.lastTick+1;
      for(const unit of snapshot.units)if(unit.deck){const old=this.deckMotion.get(unit.id),start=continuous&&old?.shipId===unit.deck.shipId?this.deckPosition(unit,now):unit.deck;
        this.deckMotion.set(unit.id,{shipId:unit.deck.shipId,x:unit.deck.x,y:unit.deck.y,fromX:start.x,fromY:start.y,at:now});}
      this.lastTick=snapshot.tick;this.at=now;
    }
    const {entities,ships}=this;
    const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),rotation=uprightCrewRotation(this.camera);
    const visible=(x:number,y:number,pad=180)=>x>=frame.view.x-pad && y>=frame.view.y-pad && x<=frame.view.x+frame.view.width/zoom+pad && y<=frame.view.y+frame.view.height/zoom+pad;
    this.positions.clear();this.shipPoses.clear();this.gangwaySurfaces.clear();this.batches.begin();this.selection.begin();
    for(const site of [...snapshot.mercenaryCamps.map(site=>({...site,model:'camp',scale:site.radius/32})),...(snapshot.shops??[]).map(site=>({...site,model:'shop',scale:site.radius/32})),...(frame.story?.props??[]).filter(site=>['statue','well','beacon','citadel'].includes(site.kind)).map(site=>({...site,id:`prop:${site.id}`,model:site.kind}))]){
      const model=this.template(`buildings/${site.model}`,'Building');if(!model)continue;
      this.positions.set(site.id,{x:site.x,y:site.y,bodyY:site.y,topY:site.y-90*site.scale});
      if(visible(site.x,site.y)){
        if(frame.selectedCampId===site.id || frame.hoveredId===site.id)this.foundationMarker(frame,{...site,radius:'radius' in site?site.radius:32*site.scale},'#96774a',frame.selectedCampId===site.id);
        this.batches.add(`site:${site.model}`,model,this.pose(site.x,site.y,0,0,site.scale),site.id,'#a79b7f');
      }
    }
    for(const building of snapshot.buildings){
      const modelKey=`buildings/${frame.buildingModels?.[building.id]??building.kind}`,model=this.template(modelKey,'Building');if(!model)continue;
      let bounds=this.bounds.get(modelKey);if(!bounds){bounds=new THREE.Box3().setFromObject(model);this.bounds.set(modelKey,bounds);}
      const size=bounds.getSize(new THREE.Vector3()),square=footprintSquare(snapshot,building,building.radius);
      const extent=square?(square.right-square.left+1)*square.cell*.88:building.radius*2;
      const scale=extent/Math.max(size.x,size.z),height=size.y*scale;
      this.positions.set(building.id,{x:building.x,y:building.y,bodyY:building.y,topY:building.y-height*TILT});
      if(!visible(building.x,building.y,height*TILT+180))continue;
      const selected=frame.selectedIds?.has(building.id)??false;
      if(building.hp>0 && (selected || frame.hoveredId===building.id))this.foundationMarker(frame,building,this.markerInk(frame,building.owner),selected);
      this.batches.add(`building:${modelKey}:${ownerInk(building.owner, snapshot)}:${building.complete}`,model,this.pose(building.x,building.y,-bounds.min.y*scale,0,scale),building.id,ownerInk(building.owner, snapshot),!building.complete);
    }
    const revealedShips=new Set<string>();
    for(const unit of snapshot.units)if(frame.selectedIds?.has(unit.id)){if(unit.deck)revealedShips.add(unit.deck.shipId);else if(ships.has(unit.id))revealedShips.add(unit.id);}
    for(const ship of ships.values()){
      const at=frame.motion?.position(ship,now)??ship,heading=frame.motion?.heading(ship,now)??ship.sailing?.heading??0,scale=shipScale(ship),profile=shipProfile(ship)!;
      const displayed={...ship,x:at.x,y:at.y,sailing:{...ship.sailing!,heading}};
      shareShipProfile(ship,displayed);
      this.shipPoses.set(ship.id,displayed);
      this.positions.set(ship.id,{x:at.x,y:at.y,bodyY:at.y,topY:at.y-(profile.deckHeight+profile.mastHeight)*TILT});
      if(!visible(at.x,at.y,profile.length*scale+profile.mastHeight))continue;
      const selected=frame.selectedIds?.has(ship.id)??false;
      if(ship.hp>0 && (selected || frame.hoveredId===ship.id))this.selection.hull(ship.kind,profile.hull,scale,this.pose(at.x,at.y,.15,heading,scale),this.markerInk(frame,ship.owner),selected);
      const reveal=revealedShips.has(ship.id);
      const hull=this.template(`ships/${ship.kind}`,'Hull');
      if(hull){
        const key=`ships/${ship.kind}`,transform=this.pose(at.x,at.y,0,heading,scale);
        if(!this.rigModels.has(key))this.rigModels.set(key,shipRigModel(hull));
        const rig=this.rigModels.get(key);
        let display=this.rigPoses.get(ship.id);
        if(rig&&display?.model!==rig){display={model:rig,pose:rig.createPose(),worldRopes:rig.ropes.map(()=>new THREE.Matrix4())};this.rigPoses.set(ship.id,display);}
        const animation=display?.pose.update(this.sailMotion.pose(ship,now));
        this.batches.add(`ship:${ship.kind}:${Boolean(reveal)}`,hull,transform,ship.id,undefined,false,reveal,animation);
        const ensign=this.template(`ships/${ship.kind}`,'OwnerFlag');
        if(ensign)this.batches.add(`ship-ensign:${ship.kind}:${ownerInk(ship.owner, snapshot)}`,ensign,transform,ship.id,ownerInk(ship.owner, snapshot));
        if(display)for(let i=0;i<display.pose.ropes.length;i++){
          const rope=display.pose.ropes[i]!;if(!rope.visible)continue;
          const matrix=display.worldRopes[i]!.multiplyMatrices(transform,rope.matrix);
          this.batches.add(`rig-rope:${ship.kind}:${rope.material}:${Boolean(reveal)}`,rope.template,matrix,ship.id,undefined,false,reveal);
        }
      }
      const masts=profile.obstacles.filter(obstacle=>obstacle.type==='mast'),mast=masts[ship.kind==='shipOfTheLine'?1:0];
      if(mast){const mastAt=localToWorld({...ship,x:at.x,y:at.y,sailing:{...ship.sailing!,heading}},mast);this.batches.add(`flag:${ownerInk(ship.owner, snapshot)}`,this.flag,this.pose(mastAt.x,mastAt.y,profile.deckHeight+profile.mastHeight,0,scale,rotation),ship.id,ownerInk(ship.owner, snapshot));}
      for(const item of installedWeapons(snapshot,ship)){
        const weapon=mountedWeaponPose(displayed,item),gun=weapon&&this.template(`ships/${weapon.art}`,'Gun');if(!weapon||!gun)continue;
        const recoil=this.recoil.get(item.id);
        const age=recoil?(recoil.duration-recoil.remaining)/SIM_TICKS_PER_SECOND:1;
        const back=weapon.art==='fireShip'?0:4*scale*Math.max(0,age<.08?age/.08:1-(age-.08)/.38);
        this.batches.add(`gun:${weapon.art}:${item.durability===0}`,gun,this.pose(weapon.pivot.x-Math.cos(weapon.heading)*back,weapon.pivot.y-Math.sin(weapon.heading)*back,weapon.pivotHeight,weapon.heading,scale),ship.id,undefined,item.durability===0);
      }
    }
    for(const source of this.shipPoses.values()){
      const target=source.sailing?.gangway && this.shipPoses.get(source.sailing.gangway.targetId);
      const surface=target && gangwaySurface(source,target);if(!surface)continue;
      this.gangwaySurfaces.set(source.id,surface);
      const x=(surface.source.x+surface.target.x)/2,y=(surface.source.y+surface.target.y)/2;
      if(!visible(x,y,100))continue;
      const a=shipProfile(source)!.deckHeight,b=shipProfile(target)!.deckHeight;
      const dx=surface.target.x-surface.source.x,dy=surface.target.y-surface.source.y;
      this.bridgeAlong.set(dx,b-a,dy);const span=this.bridgeAlong.length();this.bridgeAlong.normalize();
      this.bridgeAcross.set(-dy,0,dx).normalize();this.bridgeUp.crossVectors(this.bridgeAcross,this.bridgeAlong).normalize();
      const matrix=this.pose(0,0,0).makeBasis(this.bridgeAlong,this.bridgeUp,this.bridgeAcross).setPosition(x,(a+b)/2-1,y)
        .scale(this.transformScale.set(span,2,surface.width));
      this.batches.add(`ship-gangway:${surface.phase}`,this.gangway,matrix,source.id,undefined,surface.phase==='deploying');
    }
    for(const id of this.rigPoses.keys())if(!ships.has(id))this.rigPoses.delete(id);
    const liveCrew=new Set<string>();
    for(const unit of snapshot.units){
      if(ships.has(unit.id)||isInCabin(unit))continue;
      let at=frame.motion?.position(unit,now)??unit,height=0,facing=frame.facing.facing(unit.id);
      let bridge:ReturnType<typeof gangwayCrewVisualPose>;
      const ship=unit.deck&&ships.get(unit.deck.shipId);
      if(ship){
        liveCrew.add(unit.id);const parent=frame.motion?.position(ship,now)??ship,heading=frame.motion?.heading(ship,now)??ship.sailing?.heading??0;
        bridge=gangwayCrewVisualPose(unit,this.shipPoses,this.gangwaySurfaces);
        if(bridge){at=bridge;height=bridge.height;}
        else{const deck=this.deckPosition(unit,now),c=Math.cos(heading),s=Math.sin(heading);at={x:parent.x+deck.x*c-deck.y*s,y:parent.y+deck.x*s+deck.y*c};height=shipProfile(ship)!.deckHeight;}
        const id=interactionTargetId(unit.order),aiming=unit.aim&&['attack','attackMove','hold','aim','cast'].includes(unit.order.type);
        facing=this.facing.facing(unit,heading,right,aiming?unit.aim:id?entities.get(id):undefined);
      }
      const scale=unitGlyphScale(unit.radius),foot=creatureShadow(unit.kind)?.y??17,bodyY=at.y-height*TILT-foot*scale;
      this.positions.set(unit.id,{x:at.x,y:at.y,bodyY,topY:bodyY-64*scale});
      if(!visible(at.x,bodyY))continue;
      const selected=frame.selectedIds?.has(unit.id)??false;
      if(unit.hp>0 && (selected || frame.hoveredId===unit.id)){
        let marker=this.pose(at.x,at.y,height+.15);
        const crossing=unit.gangway,surface=bridge && crossing && this.gangwaySurfaces.get(crossing.sourceId);
        if(surface && crossing){
          const source=this.shipPoses.get(crossing.sourceId)!,target=this.shipPoses.get(crossing.targetId)!;
          const dx=surface.target.x-surface.source.x,dy=surface.target.y-surface.source.y;
          this.bridgeAlong.set(dx,shipProfile(target)!.deckHeight-shipProfile(source)!.deckHeight,dy).normalize();
          this.bridgeAcross.set(-dy,0,dx).normalize();this.bridgeUp.crossVectors(this.bridgeAcross,this.bridgeAlong).normalize();
          marker=marker.makeBasis(this.bridgeAlong,this.bridgeUp,this.bridgeAcross)
            .setPosition(at.x+this.bridgeUp.x*.15,height+this.bridgeUp.y*.15,at.y+this.bridgeUp.z*.15);
        }
        const radius=(unit.bodyRadius??unit.radius)+3;
        this.selection.ellipse(marker,radius,radius*.55,this.markerInk(frame,unit.owner),selected);
      }
      const animation=frame.reducedMotion?{mode:'idle' as const,frame:0}:frame.animation?.frame(unit,now)??{mode:'idle' as const,frame:0};
      const density=zoom<.65?2:4,key=`${unit.kind}:${ownerInk(unit.owner, snapshot)}:${animation.mode}:${animation.frame}:${facing}:${density}`;
      let card=this.cards.get(key);
      if(!card){
        const canvas=document.createElement('canvas');canvas.width=canvas.height=128*density;const ctx=canvas.getContext('2d')!;
        ctx.scale(density,density);ctx.translate(64,64);ctx.scale(facing,1);
        if(!paintFigure(ctx,unit.kind,ownerInk(unit.owner, snapshot),animation,facing))UNIT_CARDS[unit.kind].paint(ctx,ownerInk(unit.owner, snapshot));
        const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3]!;
        texture.userData.alpha={width:canvas.width,height:canvas.height,pixels:alpha};
        let geometry=this.cardGeometry.get(foot);if(!geometry){geometry=new THREE.PlaneGeometry(128,128/TILT).translate(0,foot/TILT,0);this.cardGeometry.set(foot,geometry);}
        card={mesh:new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,toneMapped:false})),texture,used:this.frame};this.cards.set(key,card);this.cardPixels+=canvas.width*canvas.height;
      }card.used=this.frame;
      const transform=this.pose(at.x,at.y,height,0,scale,rotation);
      this.batches.add(`unit:${key}`,card.mesh,transform,unit.id);
    }
    for(const id of this.deckMotion.keys())if(!liveCrew.has(id))this.deckMotion.delete(id);
    for(const effect of snapshot.effects){
      if(!PHYSICAL_EFFECTS.has(effect.type))continue;
      const shot=flightPose(effect,now-this.at);
      const model=shot.look==='flash'?this.flash:shot.look==='orb'?this.magic:shot.look==='fire'?this.fire:['arrow','spear','streak'].includes(shot.look)?this.bolt:this.ball;
      if(visible(shot.x,shot.y))this.batches.add(`effect:${shot.look}`,model,this.pose(shot.x,shot.y,shot.height,shot.heading,shot.scale),effect.id);
    }
    this.batches.finish();this.selection.finish();
    this.transforms.length=this.transformCount;
    if(this.cardPixels>12*1024*1024)for(const [key,card] of [...this.cards].sort((a,b)=>a[1].used-b[1].used)){
      if(this.cardPixels<=12*1024*1024)break;
      if(card.used===this.frame)continue;
      this.batches.forget(`unit:${key}`);this.cardPixels-=card.texture.image.width*card.texture.image.height;(card.mesh.material as THREE.Material).dispose();card.texture.dispose();this.cards.delete(key);
    }
    renderer.render(this.scene,this.camera);
  }
  pick(point:{x:number;y:number}){if(!this.view)return undefined;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(point.x/this.view.width*2-1,1-point.y/this.view.height*2),this.camera);
    for(const hit of ray.intersectObjects(this.batches.objects(),false)){
      const material=(hit.object as THREE.Mesh).material;const first=Array.isArray(material)?material[hit.face?.materialIndex??0]:material;
      // A selected ship exposes the deck for crew commands. Its translucent
      // cloth must not intercept the visible crew behind the deformed sail.
      if(first?.name.startsWith('unbleached sail')&&first.transparent&&first.opacity<.5)continue;
      if(!paintedHit((first as THREE.MeshBasicMaterial)?.map??undefined,hit.uv))continue;
      const id=hit.object.userData.ids?.[hit.instanceId??0] as string|undefined;if(id && this.positions.has(id))return{id,height:hit.point.y};
    }return undefined;
  }
  plane(point:{x:number;y:number},height:number){return this.view?screenOnPlane(this.camera,this.view,point,height):undefined;}
  private markerInk(frame:WorldFrame,owner:Owner){return frame.viewer?RELATION_INK[relationTo(frame.snapshot,frame.viewer,owner)]:ownerInk(owner,frame.snapshot);}
  private foundationMarker(frame:WorldFrame,body:{x:number;y:number;radius:number},color:string,selected:boolean){
    const square=footprintSquare(frame.snapshot,body,body.radius);
    if(square){
      const width=(square.right-square.left+1)*square.cell,depth=(square.bottom-square.top+1)*square.cell;
      this.selection.rectangle(this.pose(square.left*square.cell+width/2,square.top*square.cell+depth/2,.15),width/2-1,depth/2-1,color,selected);
    }else this.selection.ellipse(this.pose(body.x,body.y,.15),body.radius+3,(body.radius+3)*.55,color,selected);
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.reset();
    this.selection.dispose();
    this.water.dispose();for(const rig of this.rigModels.values())rig?.dispose();this.rigModels.clear();
    // Decoded models are the application cache shared by other layers and UI
    // portraits. This layer owns only instances, rigs, cards and render targets.
    this.templates.clear();this.bounds.clear();
    for(const card of this.cards.values()){card.texture.dispose();(card.mesh.material as THREE.Material).dispose();}this.cards.clear();this.cardPixels=0;
    for(const geometry of this.cardGeometry.values())geometry.dispose();this.cardGeometry.clear();
    for(const mesh of [this.shadow,this.ball,this.bolt,this.magic,this.fire,this.flag,this.flash,this.gangway]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
    this.sun.shadow.dispose();this.sun.shadow.map=this.sun.shadow.mapPass=null;this.scene.clear();
    const renderer=this.renderer;this.renderer=undefined;
    renderer?.dispose();renderer?.forceContextLoss();
  }
}
