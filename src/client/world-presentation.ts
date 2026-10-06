import { drawWorld,type WorldFrame } from './world-renderer';
import { resources,resourceText,type ResourcePhase } from './resources';
import { resourcePanel } from './resource-panel';
import { loadBakedImage } from './art/baked-assets';
import { BUILDING_DEFS } from '../shared/catalog';
import { SHIP_KINDS,shipProfile } from '../shared/ship-geometry';
import type { GameSnapshot } from '../shared/types';
import type { World3DLayer } from './world3d/world-layer';
import './world-presentation.css';

type ScenePreparation={snapshot:GameSnapshot;phase:ResourcePhase;sites:readonly string[]};

/** Coordinates the three presentation layers. This module has no Three.js
 * dependency until a device creates WebGL2; networking/simulation stay separate. */
export class WorldPresentation {
  private ground=document.createElement('canvas');
  private actors=document.createElement('canvas');
  private stack=document.createElement('div');
  private layer:World3DLayer|undefined;
  private attempted=false;
  private context:WebGL2RenderingContext|null= null;
  private initializing:Promise<void>|undefined;
  private current:ScenePreparation|undefined;
  private revision=0;
  private contextLost=false;
  private failed=false;
  private effectTypes:ReadonlySet<GameSnapshot['effects'][number]['type']>|undefined;
  private dimensions='';
  private enabled=false;
  constructor(private canvas:HTMLCanvasElement){
    this.stack.className='world-underlay';this.actors.className='world-actors';this.ground.className='world-ground';
    this.stack.hidden=true;this.stack.append(this.ground,this.actors);canvas.before(this.stack);
  }
  async prepare(snapshot:GameSnapshot,phase:ResourcePhase,sites:readonly string[]=[]){
    const revision=++this.revision;
    this.current={snapshot,phase,sites};
    this.enabled=false;this.stack.hidden=true;
    await this.initialize(phase);
    if(revision!==this.revision)return;
    if(this.layer && !this.contextLost && !this.failed){
      await resources.warm('renderer',phase);
      if(phase==='match')await Promise.all([...SHIP_KINDS.map(kind=>`portraits/${kind}`),...Object.keys(BUILDING_DEFS).flatMap(kind=>[`buildings/${kind}`,`buildings/${kind}-team`])].map(key=>loadBakedImage(key,phase)));
      if(revision!==this.revision)return;
      resourcePanel().preparing(resourceText('读取并准备三维模型','Loading and preparing 3D models'));
      await this.layer.prepare(snapshot,phase,sites);
      if(revision!==this.revision || this.contextLost || this.failed)return;
      this.layer.reset();this.enabled=true;
      resourcePanel().renderer=resourceText('实时 3D · 建筑、船只与人物共享深度','Real-time 3D · shared building, ship and troop depth');
    }else{
      await this.prepareFallback(snapshot,phase,sites);
      if(revision===this.revision && !this.contextLost && !this.failed)resourcePanel().renderer=resourceText('2D · 此设备未提供 WebGL2','2D · WebGL2 unavailable on this device');
    }
  }
  private initialize(phase:ResourcePhase){
    if(!this.initializing)this.initializing=this.createLayer(phase).finally(()=>{this.initializing=undefined;});
    return this.initializing;
  }
  private async createLayer(phase:ResourcePhase){
    if(!this.attempted){
      this.attempted=true;
      this.context=this.actors.getContext('webgl2',{alpha:true,antialias:true});
      if(this.context){
        this.actors.addEventListener('webglcontextlost',event=>{
          event.preventDefault();this.contextLost=true;this.revision++;this.enabled=false;this.stack.hidden=true;
          resourcePanel().renderer=resourceText('2D · 图形上下文丢失','2D · graphics context lost');
          void this.fallbackCurrent();
        });
        this.actors.addEventListener('webglcontextrestored',()=>{
          this.contextLost=false;this.failed=false;void this.recoverCurrent();
        });
      }
    }
    if(!this.context || this.layer || this.contextLost || this.failed)return;
    await resources.warm('renderer',phase);
    const module=await import('./world3d/world-layer');
    if(this.contextLost)return;
    try{this.layer=module.World3DLayer.create(this.actors,this.context);this.effectTypes=module.PHYSICAL_EFFECTS;}
    catch(error){this.failed=true;console.warn('GPU renderer unavailable; using Canvas',error);resourcePanel().renderer=resourceText('2D · GPU 初始化失败后回退','2D · GPU initialization fallback');}
  }
  private async fallbackCurrent(){
    if(!this.current)return;
    const {snapshot,phase,sites}=this.current;
    try{await this.prepareFallback(snapshot,phase,sites);}catch(error){console.error('Canvas resources unavailable',error);}
  }
  private async recoverCurrent(){
    if(!this.current)return;
    const {snapshot,phase,sites}=this.current;
    const revision=this.revision+1;
    try{await this.prepare(snapshot,phase,sites);}catch(error){
      if(revision!==this.revision)return;
      this.failed=true;this.enabled=false;this.stack.hidden=true;
      resourcePanel().renderer=resourceText('2D · GPU 恢复失败后回退','2D · GPU recovery fallback');
      console.error('GPU recovery failed; using Canvas',error);await this.fallbackCurrent();
    }
  }
  private async prepareFallback(snapshot:GameSnapshot,phase:ResourcePhase,sites:readonly string[]=[]){
    const ships=phase==='match'?SHIP_KINDS:snapshot.units.filter(unit=>shipProfile(unit)).map(unit=>unit.kind);
    const buildings=phase==='match'?Object.keys(BUILDING_DEFS):[...snapshot.buildings.map(building=>building.kind),...sites];
    const keys=[...new Set([...ships.flatMap(kind=>['base','upper','depth',...(shipProfile({kind} as never)?.weaponPivot?['weapon','weapon-depth']:[])].map(layer=>`ships/${kind}-${layer}`)),...buildings.flatMap(kind=>[`buildings/${kind}`,`buildings/${kind}-team`]),...(phase==='match'||snapshot.shops?.length?['buildings/shop','buildings/shop-team']:[]),...(phase==='match'||snapshot.mercenaryCamps.length?['buildings/camp','buildings/camp-team']:[])])];
    await Promise.all(keys.map(key=>loadBakedImage(key,phase)));
  }
  draw(frame:WorldFrame,phase:ResourcePhase=this.current?.phase??'home'){
    resources.phase=phase;
    const changed=this.current?.phase!==phase;
    this.current={snapshot:frame.snapshot,phase,sites:Object.values(frame.buildingModels??{})};
    if(changed && !this.enabled){this.revision++;void this.recoverCurrent();}
    const dpr=Math.min(devicePixelRatio,2),width=frame.view.width,height=frame.view.height;
    if(!this.enabled||!this.layer){this.stack.hidden=true;drawWorld(frame);return;}
    this.stack.hidden=false;
    const dimensions=`${width}:${height}:${dpr}`;
    if(dimensions!==this.dimensions){this.ground.width=Math.round(width*dpr);this.ground.height=Math.round(height*dpr);this.dimensions=dimensions;}
    try{this.layer.draw(frame);}catch(error){
      // A graphics/context failure cannot stop the game loop or authoritative
      // simulation. The authored Canvas path remains usable while assets warm.
      console.error('GPU presentation failed; using Canvas',error);this.failed=true;this.revision++;this.enabled=false;this.stack.hidden=true;
      resourcePanel().renderer=resourceText('2D · GPU 渲染失败后回退','2D · GPU rendering fallback');
      void this.fallbackCurrent();drawWorld(frame);return;
    }
    const ground=this.ground.getContext('2d')!;ground.setTransform(1,0,0,1,0,0);ground.clearRect(0,0,this.ground.width,this.ground.height);ground.setTransform(dpr,0,0,dpr,0,0);
    const common={actorPositions:this.layer.positions,physicalEffects:this.effectTypes!};
    drawWorld({...frame,...common,ctx:ground,pass:'ground'});
    frame.ctx.save();frame.ctx.setTransform(1,0,0,1,0,0);frame.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);frame.ctx.restore();
    drawWorld({...frame,...common,pass:'overlay'});
  }
  pick(point:{x:number;y:number}){return this.enabled?this.layer?.pick(point):undefined;}
  plane(point:{x:number;y:number},height:number){return this.enabled?this.layer?.plane(point,height):undefined;}
  position(id:string){return this.enabled?this.layer?.positions.get(id):undefined;}
  get is3D(){return this.enabled;}
  reset(){this.layer?.reset();}
}
