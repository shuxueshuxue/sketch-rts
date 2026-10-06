import * as THREE from 'three';
import { Ship3DLayer } from '../../client/world3d/ship-layer';
import { createShipWebglScene } from '../scenes/ship-webgl';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { localToWorld, shipProfile, worldToLocal } from '../../shared/ship-geometry';
import { projectDeckPoint } from '../../shared/decks';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { drawWorld, worldLabelsFor } from '../../client/world-renderer';
import { UnitFacingTracker } from '../../client/unit-facing';
import { UnitAnimationTracker } from '../../client/unit-animation';
import { UnitMotionSmoother } from '../../client/unit-motion';
import { createI18n } from '../../client/i18n';
import { installBakedImage } from '../../client/art/baked-assets';
import type { GameCommand } from '../../shared/types';
import './ship-webgl.css';

async function start() {
  const {game,ship,target}=createShipWebglScene();
  let renderer:THREE.WebGLRenderer|undefined;
  try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{ /* The same commands remain available in the 2D comparison. */ }
  if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;}
  const gpuCanvas=renderer?.domElement??document.createElement('canvas');gpuCanvas.hidden=!renderer;document.body.append(gpuCanvas);
  const flat=document.createElement('canvas');flat.hidden=!!renderer;document.body.append(flat);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#41595b');
  const camera=new THREE.OrthographicCamera(-400,400,300,-300,1,2200);
  camera.position.set(900,640,-150);camera.lookAt(900,15,-790);
  scene.add(new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25));
  const sun=new THREE.DirectionalLight('#f1dcc0',2.5);sun.position.set(700,600,-1000);sun.target.position.set(900,0,-800);
  sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-420;sun.shadow.camera.right=420;sun.shadow.camera.top=420;sun.shadow.camera.bottom=-420;sun.shadow.camera.near=1;sun.shadow.camera.far=1200;sun.shadow.bias=-.0004;sun.shadow.normalBias=.35;scene.add(sun,sun.target);
  const water=new THREE.Mesh(new THREE.PlaneGeometry(1800,1400),new THREE.MeshStandardMaterial({color:'#456364',roughness:.8}));water.rotation.x=-Math.PI/2;water.position.set(900,0,-700);water.receiveShadow=true;scene.add(water);
  const shore=new THREE.Mesh(new THREE.PlaneGeometry(1800,600),new THREE.MeshStandardMaterial({color:'#6c7358',roughness:1}));shore.rotation.x=-Math.PI/2;shore.position.set(900,1,-300);shore.receiveShadow=true;scene.add(shore);
  const dummy=new THREE.Group();dummy.position.set(target.x,1,-target.y);scene.add(dummy);
  for(const [x,y,z,w,h,d] of [[-15,25,0,8,50,8],[15,25,0,8,50,8],[0,42,0,40,7,7],[0,30,0,29,22,4]] as const){const block=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color:'#8c7655',roughness:1}));block.position.set(x,y,z);block.castShadow=block.receiveShadow=true;dummy.add(block);}
  const layer=renderer?await Ship3DLayer.load(scene,camera,new URL('./warship.glb',import.meta.url).href):undefined;
  const marker=new THREE.Mesh(new THREE.RingGeometry(14,16,32),new THREE.MeshBasicMaterial({color:'#d2b778',side:THREE.DoubleSide}));marker.rotation.x=-Math.PI/2;scene.add(marker);
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let selected=ship.id,view:'3d'|'2d'=renderer?'3d':'2d',perf=false,paused=false,patrol=false;
  const heading=document.createElement('header');heading.className='sea-test-header';heading.innerHTML='<h1>海试 · 战船</h1>';document.body.append(heading);
  const footer=document.createElement('footer');footer.className='sea-test-footer';footer.innerHTML='<span class="sea-test-selection"></span><span class="sea-test-help">点击船员选择 · 右键甲板布阵 / 海面航行</span><span class="sea-test-target"></span><span class="sea-test-feedback">独立试验场</span><span class="sea-test-performance" hidden></span>';document.body.append(footer);
  const status=footer.querySelector<HTMLElement>('.sea-test-feedback')!,selection=footer.querySelector<HTMLElement>('.sea-test-selection')!,statistics=footer.querySelector<HTMLElement>('.sea-test-performance')!;
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',action);heading.append(b);return b;};
  const command=(order:GameCommand)=>{try{issuePlayerCommand(game,'player',order);status.textContent='命令已下达';}catch(e){status.textContent=e instanceof Error?e.message:String(e);}};
  button('选择战船',()=>{selected=ship.id;});
  button('选择农民',()=>{selected=game.units.find(unit=>unit.kind==='worker')!.id;});
  const patrolButton=button('甲板巡走',()=>{patrol=!patrol;patrolButton.setAttribute('aria-pressed',String(patrol));if(!patrol)command({type:'stop',unitIds:game.units.filter(u=>u.deck).map(u=>u.id)});});
  button('攻击岸上靶标',()=>{selected=ship.id;command({type:'attack',unitIds:[ship.id],targetId:target.id});});
  button('停止',()=>command({type:'stop',unitIds:[selected]}));
  const pauseButton=button('暂停',()=>{paused=!paused;pauseButton.textContent=paused?'继续':'暂停';});
  const compare=button(renderer?'2D 对照':'需要 WebGL2',()=>{view=view==='3d'?'2d':'3d';compare.textContent=view==='3d'?'2D 对照':'返回 3D';gpuCanvas.hidden=view!=='3d';flat.hidden=view!=='2d';if(view==='2d')loadFlatArt();renderTimes.length=frameTimes.length=simTimes.length=0;});compare.disabled=!renderer;
  let viewAngle=0;
  const orbit=button('转动视角',()=>{if(view!=='3d')return;viewAngle+=Math.PI/4;camera.position.set(900+Math.sin(viewAngle)*640,640,-790+Math.cos(viewAngle)*640);camera.lookAt(900,15,-790);});orbit.disabled=!renderer;
  if(!renderer)status.textContent='浏览器未启用 WebGL2 · 当前为 2D 对照';
  button('性能',()=>{perf=!perf;statistics.hidden=!perf;});button('重置',()=>location.reload());
  const names={warship:'战船',worker:'农民',footman:'步兵',archer:'弓箭手'};
  const resize=()=>{const w=innerWidth,h=innerHeight;renderer?.setSize(w,h);flat.width=w;flat.height=h;camera.left=-h*(w/h)/2;camera.right=h*(w/h)/2;camera.top=h/2;camera.bottom=-h/2;camera.zoom=Math.max(.9,Math.min(1.65,h/500));camera.updateProjectionMatrix();};
  resize();addEventListener('resize',resize);
  const groundPoint=(event:PointerEvent,height:number)=>{const box=gpuCanvas.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera);const point=new THREE.Vector3();return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-height),point)?{x:point.x,y:-point.z}:undefined;};
  for(const canvas of [gpuCanvas,flat]){
    canvas.addEventListener('contextmenu',event=>event.preventDefault());
    canvas.addEventListener('pointerdown',event=>{
      if(view==='2d'){const point={x:900+(event.clientX-innerWidth/2)/camera.zoom,y:790+(event.clientY-innerHeight/2)/camera.zoom};if(event.button===2)command({type:'move',unitIds:[selected],...point});else{const unit=game.units.filter(u=>Math.hypot(u.x-point.x,u.y-point.y)<u.radius+10).sort((a,b)=>Number(!!b.deck)-Number(!!a.deck))[0];if(unit)selected=unit.id;}return;}
      if(event.button===0){groundPoint(event,0);const hit=ray.intersectObjects(layer?.selectable()??[],true)[0];let object=hit?.object;while(object&&!object.userData.unitId)object=object.parent??undefined;if(object?.userData.unitId)selected=object.userData.unitId as string;return;}
      if(event.button!==2)return;const unit=game.units.find(u=>u.id===selected);if(!unit)return;
      let point=groundPoint(event,unit.deck?shipProfile(ship)!.deckHeight:0);if(!point)return;
      if(unit.deck){const projected=projectDeckPoint(ship,unit,worldToLocal(ship,point),game.units);if(!projected){status.textContent='这里没有足够的甲板空间';return;}point=localToWorld(ship,projected);}
      command({type:'move',unitIds:[selected],...point});
    });
  }
  let flatArtRequested=false;
  function loadFlatArt(){if(flatArtRequested)return;flatArtRequested=true;void Promise.all(['base','upper','depth','weapon','weapon-depth'].map(part=>new Promise<void>(resolve=>{const image=new Image();image.onload=()=>{installBakedImage(`ships/warship-${part}`,image);resolve();};image.onerror=()=>resolve();image.src=`/sketch-rts/art/ships/warship-${part}.png`;})));}
  if(view==='2d')loadFlatArt();
  const flatFacing=new UnitFacingTracker(),flatAnimation=new UnitAnimationTracker(),flatMotion=new UnitMotionSmoother();
  const flightGeometry=new THREE.SphereGeometry(3,8,6),flightMaterial=new THREE.MeshStandardMaterial({color:'#302d27',roughness:1});
  const flights=new Map<string,THREE.Mesh>(),flashes=new Map<string,THREE.Mesh>();
  const flashGeometry=new THREE.SphereGeometry(1,8,6),flashMaterial=new THREE.MeshBasicMaterial({color:'#ffcf74',transparent:true,opacity:.8});
  const renderTimes:number[]=[],frameTimes:number[]=[],simTimes:number[]=[];
  const sample=(array:number[],value:number)=>{array.push(value);if(array.length>300)array.shift();};
  const percentile=(array:number[],p:number)=>{const sorted=[...array].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*p)]??0;};
  let snapshot=snapshotGame(game),last=performance.now(),accumulator=0,lastStats=0;
  function draw(now:number){
    const delta=Math.min(100,now-last);sample(frameTimes,now-last);last=now;
    if(!paused)accumulator+=delta;
    while(accumulator>=1000/SIM_TICKS_PER_SECOND){
      const start=performance.now();
      if(patrol && game.tick%(SIM_TICKS_PER_SECOND*6)===0){const worker=game.units.find(u=>u.kind==='worker')!;const point=projectDeckPoint(ship,worker,{x:game.tick%(SIM_TICKS_PER_SECOND*12)===0?14:-2,y:-18},game.units);if(point)command({type:'move',unitIds:[worker.id],...localToWorld(ship,point)});}
      stepGame(game);sample(simTimes,performance.now()-start);snapshot=snapshotGame(game);accumulator-=1000/SIM_TICKS_PER_SECOND;
    }
    const start=performance.now();
    const current=game.units.find(u=>u.id===selected)??ship;
    const label=names[current.kind as keyof typeof names]??current.kind;selection.textContent=`${label} · 生命 ${Math.ceil(current.hp)} / ${current.maxHp}`;
    footer.querySelector<HTMLElement>('.sea-test-target')!.textContent=`靶标 ${Math.ceil(target.hp)} / ${target.maxHp}`;
    if(view==='3d'){
    layer!.update(snapshot,now);
    const position=layer!.position(current.id);if(position)marker.position.copy(position).add(new THREE.Vector3(0,.3,0));marker.scale.setScalar(current===ship?5:1);
    const live=new Set<string>();
    for(const effect of snapshot.effects){
      if(!['shellFlight','siegeBolt','muzzleFlash'].includes(effect.type))continue;
      live.add(effect.id);const flash=effect.type==='muzzleFlash',map=flash?flashes:flights;let mesh=map.get(effect.id);
      if(!mesh){mesh=new THREE.Mesh(flash?flashGeometry:flightGeometry,flash?flashMaterial:flightMaterial);map.set(effect.id,mesh);scene.add(mesh);}
      const t=Math.max(0,Math.min(1,1-(effect.remaining-(paused?0:accumulator*SIM_TICKS_PER_SECOND/1000))/effect.duration));
      const x=effect.fromX??effect.x,y=effect.fromY??effect.y,h=effect.fromHeight??0;
      mesh.position.set(flash?x:x+((effect.toX??effect.x)-x)*t,flash?h:h+((effect.toHeight??0)-h)*t+(effect.type==='shellFlight'?Math.sin(t*Math.PI)*90:0),-(flash?y:y+((effect.toY??effect.y)-y)*t));
      if(flash)mesh.scale.setScalar(2+8*(1-t));
    }
    for(const map of [flights,flashes])for(const [id,mesh] of map)if(!live.has(id)){scene.remove(mesh);map.delete(id);}
    }
    if(view==='3d'&&renderer)renderer.render(scene,camera);
    else {const ctx=flat.getContext('2d')!;ctx.clearRect(0,0,flat.width,flat.height);flatFacing.update(snapshot.units,id=>snapshot.units.find(u=>u.id===id));flatAnimation.update(snapshot,now);flatMotion.update(snapshot,now);drawWorld({ctx,snapshot,view:{x:900-innerWidth/2/camera.zoom,y:790-innerHeight/2/camera.zoom,width:innerWidth,height:innerHeight,zoom:camera.zoom},viewer:'player',selectedIds:new Set([selected]),facing:flatFacing,animation:flatAnimation,motion:flatMotion,now,labels:worldLabelsFor(createI18n('zh'))});}
    sample(renderTimes,performance.now()-start);
    if(now-lastStats>500){lastStats=now;statistics.textContent=`${view==='3d'?'3D':'2D'} · ${Math.round(1000/Math.max(1,percentile(frameTimes,.5)))} FPS\n帧 P95 ${percentile(frameTimes,.95).toFixed(1)} ms · 渲染 CPU P95 ${percentile(renderTimes,.95).toFixed(1)} ms\n模拟 P95 ${percentile(simTimes,.95).toFixed(2)} ms${view==='3d'&&renderer?` · ${renderer.info.render.calls} 次绘制 · ${renderer.info.render.triangles} 三角形`:''}`;}
    requestAnimationFrame(draw);
  }
  if(renderer){layer!.update(snapshot,performance.now());await renderer.compileAsync(scene,camera);}requestAnimationFrame(draw);
}
void start().catch(error=>{const note=document.createElement('p');note.className='sea-test-error';note.textContent=`海试场景加载失败：${error instanceof Error?error.message:String(error)}`;document.body.append(note);console.error(error);});
