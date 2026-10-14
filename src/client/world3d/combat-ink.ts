/** A bounded transparent batch in the actors' real depth buffer. No readback,
 * per-unit textures, shadows, picking, or simulation state. */
import * as THREE from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';
import {COMBAT_PRESENTATION_LIMITS as LIMITS,type CombatPresentationFrame} from '../combat-presentation';
import type {WorldView} from './projection';

const TILT=Math.tan(SHIP_CAMERA.tilt);
export const COMBAT_INK_LIMIT=(LIMITS.bursts+LIMITS.residueBursts)*LIMITS.dropletsPerBurst+LIMITS.bursts*LIMITS.dropletsPerBurst+LIMITS.bursts+LIMITS.speedLines+LIMITS.transferredMarks;
export type CombatAnchor={x:number;y:number;floor:number;facing:1|-1;sourceX?:number;sourceY?:number};
const VERTEX=`
attribute vec2 inkData;
varying vec2 localInk;
varying vec2 ink;
varying vec3 colorInk;
void main(){localInk=position.xy;ink=inkData;colorInk=instanceColor;
 gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}
`;
const FRAGMENT=`
varying vec2 localInk;
varying vec2 ink;
varying vec3 colorInk;
void main(){
 vec2 p=localInk;
 float edge;
 if(ink.y>0.5){
  float curve=.16*(1.0-p.x*p.x);
  edge=max(abs(p.y-curve)-(.16+.14*(1.0-abs(p.x))),abs(p.x)-.97);
 }else{
  float grain=.035*sin(p.x*17.0+p.y*9.0)*sin(p.y*13.0-p.x*5.0);
  edge=length(p)-.91+grain;
 }
 float aa=max(.025,fwidth(edge));
 float alpha=(1.0-smoothstep(-aa,aa,edge))*ink.x;
 if(alpha<.008)discard;
 gl_FragColor=vec4(colorInk,alpha);
 #include <colorspace_fragment>
}
`;
export class CombatInk {
 private material=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
 private mesh:THREE.InstancedMesh|undefined;
 private data:THREE.InstancedBufferAttribute|undefined;
 private matrix=new THREE.Matrix4();
 private color=new THREE.Color();
 private count=0;
 private capacity=0;
 private overflow=0;
 private culled=0;
 private culling=false;
 private left=0;
 private top=0;
 private right=0;
 private bottom=0;
 private disposed=false;
 private kinds={air:0,body:0,deck:0,speed:0};
 constructor(private scene:THREE.Scene){}
 private ensure(required:number){
  if(required<=this.capacity)return;
  const capacity=Math.min(2**Math.ceil(Math.log2(Math.max(16,required))),2**Math.ceil(Math.log2(COMBAT_INK_LIMIT)));
  const geometry=new THREE.PlaneGeometry(2,2);
  const data=new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2).setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('inkData',data);
  const mesh=new THREE.InstancedMesh(geometry,this.material,capacity);mesh.name='CombatInk';mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.raycast=()=>{};
  if(this.mesh){
   const old=this.mesh;for(let i=0;i<this.count;i++){old.getMatrixAt(i,this.matrix);mesh.setMatrixAt(i,this.matrix);old.getColorAt(i,this.color);mesh.setColorAt(i,this.color);data.setXY(i,this.data!.getX(i),this.data!.getY(i));}
   this.scene.remove(old);old.dispose();old.geometry.dispose();
  }
  this.scene.add(mesh);this.mesh=mesh;this.data=data;this.capacity=capacity;
 }
 private add(x:number,y:number,height:number,rx:number,ry:number,angle:number,alpha:number,kind:keyof CombatInk['kinds'],flat=false){
  const c=Math.cos(angle),s=Math.sin(angle);
  if(this.culling){
   // The oblique camera projects (x,height,y) to (x,y-height*TILT).
   // Billboards' tiny displacement toward the eye cancels in projection;
   // flat deck ink instead has the actual .12 height lift. Use the complete
   // rotated quad so a high drop or large mark crossing the edge survives.
   const projectedY=y-(height+(flat ? .12 : 0))*TILT;
   const width=Math.abs(c*rx)+Math.abs(s*ry),heightExtent=Math.abs(s*rx)+Math.abs(c*ry);
   if(x+width<this.left||x-width>this.right||projectedY+heightExtent<this.top||projectedY-heightExtent>this.bottom){this.culled++;return;}
  }
  if(this.count>=COMBAT_INK_LIMIT){this.overflow++;return;}
  this.ensure(this.count+1);
  if(flat)this.matrix.set(c*rx,-s*ry,0,x,0,0,1,height+.12,s*rx,c*ry,0,y,0,0,0,1);
  else{
   // A tiny displacement toward the eye preserves the projected position and
   // avoids fighting the wearer's cutout card, without crossing nearby walls.
   this.matrix.set(c*rx,-s*ry,0,x,-s*rx/TILT,-c*ry/TILT,0,height+.12*Math.cos(SHIP_CAMERA.tilt),0,0,1,y+.12*Math.sin(SHIP_CAMERA.tilt),0,0,0,1);
  }
  this.mesh!.setMatrixAt(this.count,this.matrix);
  this.color.set(kind==='speed'?'#514b40':kind==='deck'?'#713a32':kind==='body'?'#883e34':'#9b4436');this.mesh!.setColorAt(this.count,this.color);
  this.data!.setXY(this.count,alpha,kind==='speed'?1:0);this.count++;this.kinds[kind]++;
 }
 update(frame:CombatPresentationFrame,anchors:ReadonlyMap<string,CombatAnchor>,reducedMotion=false,view?:WorldView){
  if(this.disposed)return;this.clear();
  this.culling=!!view;
  if(view){const zoom=view.zoom??1,pad=2/zoom;
   this.left=view.x-pad;this.top=view.y-pad;this.right=view.x+view.width/zoom+pad;this.bottom=view.y+view.height/zoom+pad;
  }
  for(const mark of frame.ground)if(mark.height>0)this.add(mark.x,mark.y,mark.height,mark.radius,mark.radius*.48,mark.angle,mark.alpha*.72,'deck',true);
  for(const mark of frame.body){const at=anchors.get(mark.unitId);if(!at)continue;
   this.add(at.x+mark.localX*at.facing,at.y,at.floor-mark.localY/TILT,mark.width??mark.radius*.65,mark.radius,mark.angle*at.facing,mark.alpha*.77,'body');}
  for(const drop of frame.droplets){const speed=Math.hypot(drop.vx,drop.vy-drop.vz*TILT),angle=Math.atan2(drop.vy-drop.vz*TILT,drop.vx);
   this.add(drop.x,drop.y,drop.height,drop.radius*(reducedMotion?1:1+Math.min(.85,speed/180)),drop.radius*.7,angle,drop.alpha*.82,'air');}
  if(!reducedMotion)for(const line of frame.speedLines){const at=anchors.get(line.unitId);if(!at)continue;
   const back=8+line.length/2;
   this.add(line.x+at.x-(at.sourceX??at.x)-line.dx*back,line.y+at.y-(at.sourceY??at.y)-line.dy*back,at.floor+line.height,line.length/2,line.width*2,Math.atan2(line.dy,line.dx),line.alpha*.58,'speed');}
  if(this.mesh){this.mesh.count=this.count;this.mesh.visible=this.count>0;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;this.data!.needsUpdate=true;}
 }
 clear(){this.count=0;this.overflow=0;this.culled=0;this.kinds.air=this.kinds.body=this.kinds.deck=this.kinds.speed=0;if(this.mesh){this.mesh.count=0;this.mesh.visible=false;}}
 stats(){return{count:this.count,capacity:this.capacity,drawCalls:this.count?1:0,bufferBytes:this.capacity*(16+3+2)*4,limit:COMBAT_INK_LIMIT,overflow:this.overflow,culled:this.culled,...this.kinds,disposed:this.disposed};}
 dispose(){if(this.disposed)return;this.clear();this.disposed=true;if(this.mesh){this.scene.remove(this.mesh);this.mesh.dispose();this.mesh.geometry.dispose();this.mesh=undefined;}this.data=undefined;this.capacity=0;this.material.dispose();}
}
