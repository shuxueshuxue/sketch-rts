/** Instrumented correctness proof for actual Canvas atlas entry points.
 * No timing result, direct painter substitute, renderer or resource initialization.
 * Install observers before the bundled providers execute any module code. */
const forbiddenContexts=[];
const contextTypes={};
const hooks=[];
let active;
let running=false;
let restored=false;
let peakCapturedBytes=0;
const require=(condition,message)=>{if(!condition)throw new Error(message);};
const remember=(prototype,name,replacement)=>{
 const original=prototype[name];hooks.push({prototype,name,original});prototype[name]=replacement(original);
};
for(const prototype of new Set([HTMLCanvasElement.prototype,globalThis.OffscreenCanvas?.prototype].filter(Boolean))){
 remember(prototype,'getContext',original=>function(type,...args){
  const name=String(type).toLowerCase();contextTypes[name]=(contextTypes[name]??0)+1;
  if(name!=='2d'){
   forbiddenContexts.push({type:String(type),duringDraw:!!active});
   throw new Error('Only Canvas 2D contexts are allowed in the atlas identity proof: '+type);
  }
  return original.call(this,type,...args);
 });
}
const originals=new Map();
for(const prototype of new Set([CanvasRenderingContext2D.prototype,globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean))){
 const nativeRead=prototype.getImageData,nativeDraw=prototype.drawImage;
 originals.set(prototype,{getImageData:nativeRead,drawImage:nativeDraw});
 remember(prototype,'getImageData',original=>function(...args){
  const result=original.apply(this,args);
  if(active){
   require(this.canvas!==active.output,'Fixture output reads must bypass the production-source observer');
   require(args[0]===0&&args[1]===0&&args[2]===this.canvas.width&&args[3]===this.canvas.height,'Production source read was not its complete original Canvas domain');
   require(this.canvas.width===active.sourceSize&&this.canvas.height===active.sourceSize,'Production read used an unexpected authored domain/density');
   const source={width:this.canvas.width,height:this.canvas.height,bytes:result.data.byteLength,data:result.data,
    owner:active.owner,readArguments:args.slice(0,4),fullOriginalDomain:true};
   active.sources.push(source);active.sourceByCanvas.set(this.canvas,source);
  }
  return result;
 });
 remember(prototype,'drawImage',original=>function(source,...args){
  if(active){
   require(source instanceof HTMLCanvasElement||!!globalThis.OffscreenCanvas&&source instanceof OffscreenCanvas,'Atlas proof encountered a non-Canvas drawImage source');
   const prior=active.sourceByCanvas.get(source);
   const data=prior?.data??nativePixels(source);
   const transform=this.getTransform();
   active.draws.push({stage:this.canvas===active.output?'final':'crop',sourceWidth:source.width,sourceHeight:source.height,
    destinationWidth:this.canvas.width,destinationHeight:this.canvas.height,args:[...args],
    transform:[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f],alpha:this.globalAlpha,
    composite:this.globalCompositeOperation,data,bytes:data.byteLength});
  }
  return original.call(this,source,...args);
 });
}
function nativePixels(canvas){
 const context=canvas.getContext('2d');
 const native=originals.get(Object.getPrototypeOf(context))?.getImageData??hooks.find(h=>h.prototype===CanvasRenderingContext2D.prototype&&h.name==='getImageData')?.original;
 require(typeof native==='function','Original 2D read method is unavailable');
 return native.call(context,0,0,canvas.width,canvas.height).data;
}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const imageIdentity=image=>image&&{width:image.width,height:image.height,bytes:image.bytes,sha256:image.sha256};
const shortStats=stats=>Object.fromEntries(Object.entries(stats).filter(([,value])=>typeof value==='number'||typeof value==='boolean'));
const difference=(before,after)=>Object.fromEntries(Object.keys(after).filter(key=>typeof before[key]==='number'&&typeof after[key]==='number').map(key=>[key,after[key]-before[key]]));
const emptyPresentation=()=>({});
const TEAM_A='#477b91',TEAM_B='#a85644';
const IDLE={mode:'idle',frame:0};
const idlePairs=[[0,4],[1,3],[5,7]];
const siegeKinds=['siegeRam','ballista','catapult','organGun'];
const describePresentation=presentation=>({
 ownKeys:Reflect.ownKeys(presentation).map(key=>typeof key==='symbol'?'symbol:'+String(key.description):key),
 prototype:Object.getPrototypeOf(presentation)===Object.prototype?'Object.prototype':Object.getPrototypeOf(presentation)===null?'null':'custom',
 inheritedFields:['cloth','headwear','weapon'].filter(key=>!Object.hasOwn(presentation,key)&&key in presentation),
});
let modules;
window.canvasRouteIdentity={ready:false,loading:true};
try{
 modules=await import('/modules.js');
 require(isSecureContext&&!!crypto.subtle,'SHA verification requires a local secure context with WebCrypto');
}catch(error){window.canvasRouteIdentity.error=String(error);throw error;}
const {before,candidate,figures,creatures,actionPaintSize,appearanceKey,portraitStatsBefore,portraitStatsCandidate}=modules;
for(const [name,api] of [['before',before],['candidate',candidate]]){
 for(const method of ['drawAtlasUnit','drawAtlasUnitPortrait','drawAtlasUnitFigure','drawAtlasModel','clearCanvasArtCache','canvasArtCacheStats'])require(typeof api?.[method]==='function',name+' atlas API is missing '+method);
}
require(typeof portraitStatsBefore==='function'&&typeof portraitStatsCandidate==='function','Isolated fittedPortraitStats bridges must be functions');
require(typeof actionPaintSize==='function'&&typeof appearanceKey==='function'&&figures&&creatures,'Shared unchanged appearance/domain exports are missing');
const profiles={before:{api:before,portraitStats:portraitStatsBefore},candidate:{api:candidate,portraitStats:portraitStatsCandidate}};
const groups=[];
function step(kind,pose=IDLE,options={}){
 return{route:'world',kind,pose,team:TEAM_A,density:4,facing:1,presentation:emptyPresentation(),...options};
}
function add(id,category,steps,expected={}){
 require(steps.length===2,'Every bounded group must contain exactly two actual atlas calls');
 groups.push({id,category,steps,expected:{beforeMisses:2,candidateMisses:2,...expected}});
}
const stockKinds=[...new Set([...Object.keys(figures),...Object.keys(creatures)])].sort();
for(const kind of stockKinds)for(const density of [2,4])for(const facing of [-1,1])for(const [a,b] of idlePairs){
 add(`idle/${kind}/d${density}/f${facing}/${a}-${b}`,'stock-idle',
  [step(kind,{mode:'idle',frame:a},{density,facing}),step(kind,{mode:'idle',frame:b},{density,facing})],
  {candidateMisses:1,aliasesIdenticalSource:true});
}
for(const kind of ['footman','lancer','knight','archer','priest','mercenary','ogreMage','tidePriest']){
 require(figures[kind]||creatures[kind],'Representative carried stock kind is absent: '+kind);
 for(const density of [2,4])for(const facing of [-1,1])for(const [a,b] of idlePairs){
  add(`carry-idle/${kind}/d${density}/f${facing}/${a}-${b}`,'carried-stock-idle',
   [step(kind,{mode:'idle',frame:a,carry:6,carryAim:-4},{density,facing}),step(kind,{mode:'idle',frame:b,carry:6,carryAim:-4},{density,facing})],
   {candidateMisses:1,aliasesIdenticalSource:true});
 }
}
const teamPoses=[IDLE,{mode:'walk',frame:2},{mode:'attack',frame:2,variant:1,aim:-4},{mode:'cast',frame:1,aim:4},{mode:'work',frame:3}];
for(const kind of Object.keys(creatures).filter(kind=>!figures[kind]).sort())for(const density of [2,4])for(const facing of [-1,1])for(const pose of teamPoses){
 add(`intrinsic-team/${kind}/${pose.mode}/d${density}/f${facing}`,'intrinsic-creature-team',
  [step(kind,pose,{density,facing,team:TEAM_A}),step(kind,pose,{density,facing,team:TEAM_B})],
  {candidateMisses:1,aliasesIdenticalSource:true});
}
for(const kind of siegeKinds)for(const density of [2,4])for(const facing of [-1,1]){
 const common={density,facing};
 for(const [label,a,b] of [
  ['idle',{mode:'idle',frame:0},{mode:'idle',frame:7}],
  ['work',{mode:'idle',frame:0},{mode:'work',frame:4}],
  ['cast',{mode:'cast',frame:0,aim:-6},{mode:'cast',frame:3,aim:6}],
  ...[0,1,2,3,4].map(frame=>['attack'+frame,{mode:'attack',frame,variant:0,aim:-6},{mode:'attack',frame,variant:2,aim:6}]),
 ])add(`siege/${kind}/${label}/d${density}/f${facing}`,'siege-alias',
  [step(kind,a,common),step(kind,b,common)],{candidateMisses:1,aliasesIdenticalSource:true});
 // Identical machine drawings still occupy different authored source domains.
 add(`domain/${kind}/idle-cast/d${density}/f${facing}`,'authored-domain-control',
  [step(kind,IDLE,common),step(kind,{mode:'cast',frame:0},common)],{differentSourceDomain:true});
}
for(const route of ['portrait','figure']){
 for(const kind of Object.keys(creatures).filter(kind=>!figures[kind]).sort()){
  add(`ui-team/${route}/${kind}`,'ui-intrinsic-team',
   [step(kind,IDLE,{route,team:TEAM_A}),step(kind,IDLE,{route,team:TEAM_B})],{candidateMisses:1,aliasesIdenticalSource:true});
 }
 for(const kind of siegeKinds)add(`ui-siege-team/${route}/${kind}`,'ui-team-control',
  [step(kind,IDLE,{route,team:TEAM_A}),step(kind,IDLE,{route,team:TEAM_B})],{differentOutput:true});
}
const detail=(context,rig,stage)=>{
 if(stage==='head'){
  // An opaque detail can distinguish the otherwise equivalent stock idle pair.
  context.fillStyle=rig.motion.breathe===0?'#187d35':'#bf2942';context.fillRect(13,-34,5,5);
 }
};
const guardPresentations=[
 ['own-unused-object',()=>({unused:{}})],
 ['own-unused-undefined',()=>({unused:undefined})],
 ['explicit-weapon-undefined',()=>({weapon:undefined})],
 ['explicit-cloth-undefined',()=>({cloth:undefined})],
 ['nonenumerable-own',()=>Object.defineProperty({},'unused',{value:1,enumerable:false})],
 ['symbol-own',()=>({[Symbol('presentation-owner')]:1})],
 ['null-prototype',()=>Object.create(null)],
 ['prototype-cloth',()=>Object.create({cloth:'#91734b'})],
 ['prototype-headwear',()=>Object.create({headwear:false})],
 ['prototype-weapon',()=>Object.create({weapon:'greatSword'})],
 ['custom-detail',()=>({detail})],
 ['custom-appearance',()=>({appearance:{role:'bow',armor:false,mounted:true}})],
 ['empty-own-appearance',()=>({appearance:{}})],
 ['custom-motion',()=>({motion:'thrust'})],
 ['custom-gear',()=>({weapon:'pike',shield:true,shieldStyle:'round'})],
 ['custom-cloth',()=>({cloth:'#91734b'})],
 ['custom-headwear',()=>({headwear:false})],
];
for(const [label,create] of guardPresentations){
 const presentation=create();
 add(`guard-world/${label}`,'presentation-optout',
  [step('footman',{mode:'idle',frame:0},{presentation}),step('footman',{mode:'idle',frame:4},{presentation})],
  {differentOutput:label==='custom-detail'});
 for(const route of ['portrait','figure'])add(`guard-ui/${route}/${label}`,'ui-presentation-optout',
  [step('wildling',IDLE,{route,team:TEAM_A,presentation}),step('wildling',IDLE,{route,team:TEAM_B,presentation})]);
}
for(const kind of ['footman','siegeRam']){
 add(`team-control/${kind}`,'team-control',[step(kind,IDLE,{team:TEAM_A}),step(kind,IDLE,{team:TEAM_B})],{differentOutput:true});
}
add('facing-control/footman','facing-control',[step('footman',IDLE,{facing:1}),step('footman',IDLE,{facing:-1})],{differentOutput:true});
add('idle-phase-control/footman','phase-control',[step('footman',IDLE),step('footman',{mode:'idle',frame:2})],{differentOutput:true});
add('walk-phase-control/footman','phase-control',[step('footman',{mode:'walk',frame:0}),step('footman',{mode:'walk',frame:2})],{differentOutput:true});
add('attack-frame-control/ballista','phase-control',[step('ballista',{mode:'attack',frame:1}),step('ballista',{mode:'attack',frame:2})],{differentOutput:true});
add('walk-wheel-control/ballista','phase-control',[step('ballista',{mode:'walk',frame:0}),step('ballista',{mode:'walk',frame:2})],{differentOutput:true});
add('density-control/footman','density-control',[step('footman',IDLE,{density:2}),step('footman',IDLE,{density:4})],{differentSourceDomain:true,differentOutput:true});
add('ui-bust-control/footman','portrait-bust-control',[step('footman',IDLE,{route:'portrait'}),step('footman',IDLE,{route:'figure'})],{differentOutput:true});
add('ui-size-control/wildling','ui-fit-control',[step('wildling',IDLE,{route:'portrait',uiSize:128}),step('wildling',IDLE,{route:'portrait',uiSize:96})],{beforeMisses:1,candidateMisses:1,differentOutput:true});
const opaquePaint=function(context,color,pose,facing,presentation){
 if(active)active.modelCalls.push({samePose:pose===active.step.pose,samePresentation:presentation===active.step.presentation,
  sameColor:color===active.step.team,sameFacing:facing===active.step.facing,frame:pose.frame,mode:pose.mode});
 context.fillStyle=color;context.fillRect(-12,-22,24,38);
 context.fillStyle=pose.frame===0?'#28a155':'#b84035';context.fillRect(13,-25,5,5);
 context.fillStyle=facing===1?'#dec575':'#7069c0';context.fillRect(-14,-28,5,5);
};
opaquePaint.paintSize=pose=>pose.frame===0?128:176;
const opaqueModel={paint:opaquePaint,shadow:'foot'};
add('opaque-model/idle-domain','opaque-model-control',
 [step('footman',{mode:'idle',frame:0},{route:'model',model:opaqueModel}),step('footman',{mode:'idle',frame:4},{route:'model',model:opaqueModel})],
 {differentSourceDomain:true,differentOutput:true,originalModelArguments:true});
add('opaque-model/team','opaque-model-control',
 [step('footman',IDLE,{route:'model',model:opaqueModel,team:TEAM_A}),step('footman',IDLE,{route:'model',model:opaqueModel,team:TEAM_B})],
 {differentOutput:true,originalModelArguments:true});
add('opaque-model/facing','opaque-model-control',
 [step('footman',IDLE,{route:'model',model:opaqueModel,facing:1}),step('footman',IDLE,{route:'model',model:opaqueModel,facing:-1})],
 {differentOutput:true,originalModelArguments:true});
function coverage(){
 return{groups:groups.length,actualAtlasCalls:groups.length*4,stockKinds,
  categories:Object.fromEntries([...new Set(groups.map(group=>group.category))].map(category=>[category,groups.filter(group=>group.category===category).length])),
  matrix:{stockIdlePairs:idlePairs,densities:[2,4],facings:[-1,1],creatureTeamModes:teamPoses.map(pose=>pose.mode),
   uiRoutes:['portrait','figure'],uiSourceDensity:4,siegeAttackFrames:[0,1,2,3,4],guardCases:guardPresentations.map(([name])=>name)},
  expectedAliasGroups:groups.filter(group=>group.expected.candidateMisses<group.expected.beforeMisses).length};
}
function statsFor(profile){return{raster:shortStats(profile.api.canvasArtCacheStats()),portrait:shortStats(profile.portraitStats())};}
async function captureStep(profile,input){
 const output=document.createElement('canvas'),ui=input.route==='portrait'||input.route==='figure';
 output.width=output.height=ui?160:512;
 const context=output.getContext('2d',{willReadFrequently:true});
 const zoom=input.density/2,domain=input.route==='model'?(input.model.paint.paintSize?.(input.pose)??actionPaintSize(input.pose)):actionPaintSize(ui?IDLE:input.pose,input.kind);
 const owner=ui?'FittedPortraitCache':'RasterCache',sourceSize=domain*(ui?4:input.density);
 const statsBefore=statsFor(profile);
 const record={output,step:input,owner,sourceSize,sources:[],draws:[],sourceByCanvas:new WeakMap(),modelCalls:[]};
 require(!active,'Nested fixture capture is unsupported');active=record;
 try{
  if(input.route==='world'||input.route==='model'){
   context.setTransform(zoom,0,0,zoom,0,0);
   const point={x:output.width/2/zoom,y:output.height/2/zoom};
   if(input.route==='world')profile.api.drawAtlasUnit(context,input.kind,point,1,input.team,input.facing,input.pose,input.presentation);
   else profile.api.drawAtlasModel(context,'proof:opaque',input.model,point,1,input.team,input.facing,input.pose,input.presentation);
  }else if(input.route==='portrait')profile.api.drawAtlasUnitPortrait(context,input.kind,16,16,input.uiSize??128,input.team,input.presentation);
  else if(input.route==='figure'){
   context.translate(16,16);profile.api.drawAtlasUnitFigure(context,input.kind,128,128,input.team,input.presentation);
  }else throw new Error('Unknown actual atlas route '+input.route);
  active=undefined;
  const finalBytes=nativePixels(output),statsAfter=statsFor(profile);
  const buffers=new Set([finalBytes.buffer,...record.sources.map(source=>source.data.buffer),...record.draws.map(draw=>draw.data.buffer)]);
  peakCapturedBytes=Math.max(peakCapturedBytes,[...buffers].reduce((sum,buffer)=>sum+buffer.byteLength,0));
  const memo=new Map();
  const digest=async data=>{let result=memo.get(data);if(!result){result=sha(data);memo.set(data,result);}return await result;};
  const sources=[];for(const {data,...source} of record.sources)sources.push({...source,sha256:await digest(data)});
  const drawImages=[];for(const {data,...draw} of record.draws)drawImages.push({...draw,sha256:await digest(data)});
  return{input:{route:input.route,kind:input.kind,pose:{...input.pose},team:input.team,density:input.density,facing:input.facing,
    authoredDomain:domain,sourceDensity:ui?4:input.density,presentation:describePresentation(input.presentation),appearanceKey:appearanceKey(input.presentation)},
   sources,drawImages,finalOutput:{width:output.width,height:output.height,bytes:finalBytes.byteLength,sha256:await digest(finalBytes)},
   statsBefore,statsAfter,delta:{raster:difference(statsBefore.raster,statsAfter.raster),portrait:difference(statsBefore.portrait,statsAfter.portrait)},modelCalls:record.modelCalls};
 }finally{
  active=undefined;record.sources.length=record.draws.length=0;record.sourceByCanvas=new WeakMap();record.output=record.step=undefined;
  output.width=output.height=1;
 }
}
async function captureGroup(profile,group){
 profile.api.clearCanvasArtCache();
 const initial=statsFor(profile);
 require(initial.raster.entries===0&&initial.raster.ownedCanvasBytes===0&&initial.portrait.entries===0&&initial.portrait.ownedCanvasBytes===0,'Provider cache clear did not release its isolated Canvas ownership');
 const steps=[];let lastSource;
 for(const input of group.steps){
  const result=await captureStep(profile,input);
  require(result.sources.length<=1,'A single actual atlas call performed multiple production source reads');
  if(result.sources.length)lastSource=result.sources[0];
  require(lastSource,'The first actual atlas call did not produce an original full-domain source');
  result.resolvedFullSource=imageIdentity(lastSource);result.reusedFullSource=result.sources.length===0;
  steps.push(result);
 }
 return{steps,misses:{raster:steps.reduce((sum,result)=>sum+(result.delta.raster.misses??0),0),
  portrait:steps.filter(result=>['portrait','figure'].includes(result.input.route)).reduce((sum,result)=>sum+result.sources.length,0)},
  sourceCalls:steps.reduce((sum,result)=>sum+result.sources.length,0),final:statsFor(profile)};
}
function compareGroup(group,a,b){
 const errors=[],comparisons=[];
 const check=(condition,message)=>{if(!condition)errors.push(message);};
 for(let index=0;index<2;index++){
  const original=a.steps[index],actual=b.steps[index];
  const finalOriginal=original.drawImages.filter(draw=>draw.stage==='final'),finalActual=actual.drawImages.filter(draw=>draw.stage==='final');
  const sourceEqual=same(original.resolvedFullSource,actual.resolvedFullSource),finalSourceEqual=same(finalOriginal,finalActual),outputEqual=same(original.finalOutput,actual.finalOutput);
  const originalCrops=original.drawImages.filter(draw=>draw.stage==='crop'),actualCrops=actual.drawImages.filter(draw=>draw.stage==='crop');
  const cropEqual=actual.sources.length===0||same(originalCrops,actualCrops);
  check(sourceEqual,'Full original RGBA/domain differs at step '+index);check(cropEqual,'Actual crop drawImage source or arguments differ at step '+index);check(finalSourceEqual,'Actual final drawImage crop source or arguments differ at step '+index);check(outputEqual,'Final Canvas RGBA differs at step '+index);
  check(finalOriginal.length===1&&finalActual.length===1,'Each actual atlas entry must issue one final drawImage');
  for(const result of [original,actual]){
   const ui=['portrait','figure'].includes(result.input.route);
   check(ui?result.delta.portrait.entries===result.sources.length:result.delta.raster.misses===result.sources.length,'Production source reads do not agree with real cache miss/entry deltas');
   check(!result.delta.raster.evictions,'Bounded group unexpectedly evicted a world raster');
   if(group.expected.originalModelArguments)check(result.modelCalls.length===result.sources.length&&result.modelCalls.every(call=>call.samePose&&call.samePresentation&&call.sameColor&&call.sameFacing),'Opaque model painter arguments were changed');
  }
  comparisons.push({step:index,sourceEqual,cropEqual,finalSourceEqual,outputEqual,candidateSourceRead:actual.sources.length,candidateReusedFullSource:actual.reusedFullSource});
 }
 check(a.sourceCalls===group.expected.beforeMisses,'Original source miss count differs from expected '+group.expected.beforeMisses);
 check(b.sourceCalls===group.expected.candidateMisses,'Candidate source miss count differs from expected '+group.expected.candidateMisses);
 if(group.expected.aliasesIdenticalSource)check(same(a.steps[0].resolvedFullSource,a.steps[1].resolvedFullSource),'Proposed alias has different original full-domain source RGBA');
 if(group.expected.differentOutput)check(!same(a.steps[0].finalOutput,a.steps[1].finalOutput),'Meaningful negative control did not change the original final pixels');
 if(group.expected.differentSourceDomain)check(a.steps[0].resolvedFullSource.width!==a.steps[1].resolvedFullSource.width||a.steps[0].resolvedFullSource.height!==a.steps[1].resolvedFullSource.height,'Domain/density negative control did not use different original source dimensions');
 return{passed:errors.length===0,errors,comparisons};
}
const api={
 ready:true,loading:false,coverage:coverage(),progress:{completedGroups:0,totalGroups:groups.length},
 async run(options={}){
  require(!restored&&!running,'Atlas proof is already running or its observers were torn down');
  const yieldEvery=options.yieldEvery??1;require(Number.isInteger(yieldEvery)&&yieldEvery>=1&&yieldEvery<=32,'yieldEvery must be an integer 1..32');
  require(Object.keys(options).every(key=>key==='yieldEvery'),'The proof does not silently select or omit matrix rows');
  running=true;const results=[],failures=[];let completed=false;
  try{
   for(const group of groups){
    try{
     const original=await captureGroup(profiles.before,group);
     const originalHeldStats=statsFor(profiles.before);
     const after=await captureGroup(profiles.candidate,group),originalAfterCandidate=statsFor(profiles.before),validation=compareGroup(group,original,after);
     const isolationUnchanged=same(originalHeldStats,originalAfterCandidate);
     if(!isolationUnchanged){validation.errors.push('Candidate clear/use changed original provider Canvas cache ownership/counters');validation.passed=false;}
     const result={id:group.id,category:group.category,expected:group.expected,before:original,candidate:after,
      isolationUnchanged,originalHeldStats,originalAfterCandidate,...validation};
     results.push(result);for(const error of validation.errors)failures.push({group:group.id,error});
    }catch(error){results.push({id:group.id,category:group.category,expected:group.expected,passed:false,error:String(error)});failures.push({group:group.id,error:String(error)});}
    finally{before.clearCanvasArtCache();candidate.clearCanvasArtCache();}
    api.progress={completedGroups:results.length,totalGroups:groups.length};
    if(results.length%yieldEvery===0)await new Promise(done=>setTimeout(done,0));
   }
   completed=true;
  }finally{running=false;active=undefined;before.clearCanvasArtCache();candidate.clearCanvasArtCache();}
  if(forbiddenContexts.length)failures.push({group:'contexts',error:'Non-2D context requests were observed'});
  const successful=results.filter(result=>result.before&&result.candidate);
  return{completed,passed:completed&&results.length===groups.length&&failures.length===0,webGLAttempts:forbiddenContexts.filter(record=>/webgl/i.test(record.type)).length,
   forbiddenContexts:[...forbiddenContexts],contextTypes:{...contextTypes},totals:{...coverage(),completedGroups:results.length,failedGroups:results.filter(result=>!result.passed).length,
    originalSourceCalls:successful.reduce((sum,result)=>sum+result.before.sourceCalls,0),candidateSourceCalls:successful.reduce((sum,result)=>sum+result.candidate.sourceCalls,0),
    originalRasterMisses:successful.reduce((sum,result)=>sum+result.before.misses.raster,0),candidateRasterMisses:successful.reduce((sum,result)=>sum+result.candidate.misses.raster,0),
    originalPortraitMissesObserved:successful.reduce((sum,result)=>sum+result.before.misses.portrait,0),candidatePortraitMissesObserved:successful.reduce((sum,result)=>sum+result.candidate.misses.portrait,0),
    peakCapturedRgbaBytesInOneStep:peakCapturedBytes,remainingCapturedBytes:0},failures,groups:results,
   method:'Actual isolated before/candidate atlas draws only. Full original source getImageData is observed during each real cache miss, including world shadows. Native crop sources, exact drawImage arguments and entire final Canvas RGBA are hashed without tolerance. Cached draws resolve to their previously observed original source; they are checked against a fresh original-provider source for that exact input. No direct standalone painter substitutes or performance timing.',
   limitations:['Finite declared matrix, not all possible custom painters or input combinations.','FittedPortraitCache has no public miss counter; real portrait misses are its observed full-domain source reads, cross-checked with entry deltas in two-call non-evicting groups.','Observers add readbacks, hashing and task yields; this is correctness/cache-reuse evidence, not performance or process-memory measurement.','Stock source-key sharing does not prove WebGL, simulation, event timing, release sockets or picking.','Each provider cache is cleared per group and at completion. Evidence retains only hashes/counts/metadata; observed source/crop/output byte arrays and fixture output canvases are released after each step.']};
 },
 teardown(){
  require(!running,'Cannot tear down an active atlas proof');active=undefined;
  before.clearCanvasArtCache();candidate.clearCanvasArtCache();
  if(!restored){for(const hook of [...hooks].reverse())hook.prototype[hook.name]=hook.original;restored=true;}
  const result={restoredObservers:restored,webGLAttempts:forbiddenContexts.filter(record=>/webgl/i.test(record.type)).length,remainingCapturedBytes:0,
   before:statsFor(profiles.before),candidate:statsFor(profiles.candidate)};
  api.ready=false;return result;
 },
};
window.canvasRouteIdentity=api;
