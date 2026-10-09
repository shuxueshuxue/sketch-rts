const source='/@fs'+__BENCHMARK_SOURCE_ROOT__;
const modules=await Promise.all(['shared/sim','shared/decks','shared/ship-geometry','client/world3d/world-layer','client/unit-facing','client/unit-animation','client/unit-motion','client/resources','client/world3d/model-library','client/world3d/model-portraits'].map(path=>import(/* @vite-ignore */ `${source}/src/${path}.ts`)));
const [sim,decks,geometry,world,facing,animation,motion,resources,models,portraits]=modules;
await resources.resources.initialize();
const game=sim.createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.mercenaryCamps=[];game.shops=[];game.scriptedVictory=true;
game.map.width=6400;game.map.height=6400;game.map.terrain={cell:64,cols:100,rows:100,cells:'~'.repeat(10000)};
const kinds=['shipOfTheLine','warship','transport','cutter','carrier','bombardShip'];
for(let i=0;i<24;i++){
  const ship=game.spawnUnit('player',kinds[i%kinds.length],500+(i%6)*500,500+Math.floor(i/6)*430);ship.sailing.heading=(i%4)*Math.PI/3;
  for(let n=0;n<4;n++){const crew=game.spawnUnit('player',['worker','archer','priest','footman'][n],ship.x,ship.y);decks.boardUnit(ship,crew,game.units);}
}
for(let i=0;i<160;i++)game.spawnUnit('player',['archer','footman','worker','priest'][i%4],300+(i%20)*135,2200+Math.floor(i/20)*70);
decks.syncDecks(game.units);
const snapshot=sim.snapshotGame(game),discarded=[],installedModels=new Map();
const originalModelSet=models.worldModels.models.set.bind(models.worldModels.models);
models.worldModels.models.set=(key,value)=>{installedModels.set(key,(installedModels.get(key)||0)+1);return originalModelSet(key,value);};
function stats(layer,renderer=layer.renderer){
  const maps=['positions','templates','bounds','cards','cardGeometry','rigModels','rigPoses','deckMotion','entities','ships','recoil'];
  return{owned:Object.fromEntries(maps.map(key=>[key,layer[key]?.size??null])),transforms:layer.transforms?.length,sceneChildren:layer.scene?.children?.length,renderer:renderer?{memory:{...renderer.info.memory},render:{...renderer.info.render}}:undefined,sharedModels:models.worldModels.models.size,installedModels:Object.fromEntries(installedModels)};
}
async function resourceStats(){
  const loader=resources.resources;
  let retainedRawBytes=0;
  for(const request of loader.requests?.values?.()??[]){const value=await Promise.resolve(request).catch(()=>undefined);if(value instanceof ArrayBuffer)retainedRawBytes+=value.byteLength;}
  return{entries:loader.entries.size,requests:loader.requests?.size,decodedImages:loader.images?.size,retainedRawBytes,cacheStats:loader.cacheStats?.(),home:loader.summary('home'),match:loader.summary('match')};
}
window.runtimeReview={ready:true,async cycle(index){
  const canvas=document.createElement('canvas');canvas.id='world';document.querySelector('#world').replaceWith(canvas);
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)throw new Error('WebGL2 unavailable');
  const layer=world.World3DLayer.create(canvas,gl),frame={snapshot,ctx:document.createElement('canvas').getContext('2d'),view:{x:0,y:0,width:1280,height:720,zoom:.25},now:0,facing:new facing.UnitFacingTracker(),animation:new animation.UnitAnimationTracker(),motion:new motion.UnitMotionSmoother(),selectedIds:new Set(),labels:{mercenaryStock:()=>'',unitKind:()=>''}};
  const start=performance.now();await layer.prepare(snapshot,'home');const homeMs=performance.now()-start;
  const matchStart=performance.now();await layer.prepare(snapshot,'match');const matchMs=performance.now()-matchStart;
  layer.draw(frame);
  for(const key of kinds)portraits.currentModelPortrait(`ships/${key}`,'#65908c');
  const renderer=layer.renderer,realRender=renderer.render;
  // Measure CPU scene preparation/submission separately from SwiftShader GPU
  // execution. One real draw before and after validates renderer state/errors.
  renderer.render=()=>{};
  const warm=[];for(let n=0;n<120;n++){frame.now=n*1000/60;const at=performance.now();layer.draw(frame);warm.push(performance.now()-at);}
  const changed=[];for(let n=0;n<120;n++){frame.now=2000+n*1000/60;frame.snapshot=sim.snapshotGame(game);frame.snapshot.tick=n+1;const at=performance.now();layer.draw(frame);changed.push(performance.now()-at);}
  renderer.render=realRender;layer.draw(frame);
  if(index===5)window.runtimeReview.lastScreenshot=canvas.toDataURL('image/png');
  const before=stats(layer),error=gl.getError();layer.dispose();await new Promise(resolve=>setTimeout(resolve,20));const after=stats(layer,renderer),contextLost=gl.isContextLost();discarded.push(layer);
  const summarize=values=>{values.sort((a,b)=>a-b);return{meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1)}};
  return{index,homeMs,matchMs,staticCpu:summarize(warm),updatedCpu:summarize(changed),before,after,glError:error,contextLost,resources:await resourceStats()};
},teardown(){models.worldModels.dispose();return{sharedModels:models.worldModels.models.size,retainedDisposedLayers:discarded.length,ownedMaps:discarded.map(layer=>stats(layer))};}};
