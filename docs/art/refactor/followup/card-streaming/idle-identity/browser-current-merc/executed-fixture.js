/** Independent Chromium Canvas2D drawing oracle; no renderer/cache involved. */
const sourceRoot=__IDLE_IDENTITY_SOURCE_ROOT__;
const requestedContexts=new Set();let webglAttempts=0;
function forbidWebGL(prototype){
  const original=prototype.getContext;
  prototype.getContext=function(type,...args){
    requestedContexts.add(type);
    if(type!=='2d'){webglAttempts++;throw new Error(`Unexpected context in Canvas-only proof: ${type}`);}
    return original.call(this,type,...args);
  };
}
forbidWebGL(HTMLCanvasElement.prototype);
if(typeof OffscreenCanvas!=='undefined')forbidWebGL(OffscreenCanvas.prototype);
const {paintFigure}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/art/painted-units.ts`);
const {figures,creatures}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/art/appearance.ts`);
const {actionPaintSize}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/art/action-direction.ts`);
const {appearanceForKind}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/art/unit-appearance.ts`);
const pairs=[[0,4],[1,3],[5,7]],densities=[2,4],facings=[-1,1],teams=['#477b91','#a85644'];
const carryStates=[{carry:0,carryAim:0},...[1,3,6].flatMap(carry=>[-6,0,6].map(carryAim=>({carry,carryAim})))];
const canvases=new Map();
function raster(kind,pose,team,density,facing,appearance={}){
  const tile=actionPaintSize(pose,kind),size=tile*density;
  let canvas=canvases.get(size);
  if(!canvas){canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvases.set(size,canvas);}
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();
  ctx.scale(density,density);ctx.translate(tile/2,tile/2);ctx.scale(facing,1);
  try{if(!paintFigure(ctx,kind,team,pose,facing,appearance))throw new Error(`Missing stock painter: ${kind}`);}finally{ctx.restore();}
  return{tile,size,rgba:ctx.getImageData(0,0,size,size).data};
}
function compare(a,b){
  if(a.byteLength!==b.byteLength)throw new Error('Original RGBA domains differ.');
  // Every Uint32 word includes all four RGBA bytes, including RGB at alpha zero.
  const aa=new Uint32Array(a.buffer,a.byteOffset,a.byteLength/4),bb=new Uint32Array(b.buffer,b.byteOffset,b.byteLength/4);
  let changedPixels=0,changedChannels=0,maximumChannelDifference=0,visibleA=0,visibleB=0;const samples=[];
  for(let pixel=0;pixel<aa.length;pixel++){
    const offset=pixel*4;
    if(a[offset+3])visibleA++;if(b[offset+3])visibleB++;
    if(aa[pixel]===bb[pixel])continue;
    changedPixels++;
    for(let channel=0;channel<4;channel++){
      const delta=Math.abs(a[offset+channel]-b[offset+channel]);
      if(delta){changedChannels++;maximumChannelDifference=Math.max(maximumChannelDifference,delta);}
    }
    if(samples.length<8)samples.push({pixel,a:Array.from(a.subarray(offset,offset+4)),b:Array.from(b.subarray(offset,offset+4))});
  }
  return{changedPixels,changedChannels,maximumChannelDifference,visibleA,visibleB,samples};
}
function summarize(target,result,pixels){
  target.comparisons++;target.comparedPixels+=pixels;
  target.changedPixels+=result.changedPixels;target.changedChannels+=result.changedChannels;
  target.maximumChannelDifference=Math.max(target.maximumChannelDifference,result.maximumChannelDifference);
  target.emptyReferences+=Number(!result.visibleA);target.emptyCandidates+=Number(!result.visibleB);
}
const totals=()=>({comparisons:0,comparedPixels:0,changedPixels:0,changedChannels:0,maximumChannelDifference:0,emptyReferences:0,emptyCandidates:0});
window.idleBrowserIdentityProof=async function(traceStates,additionalStates=[]){
  const stock=Object.keys(figures).concat(Object.keys(creatures)),groups=[];
  if(stock.length!==44)throw new Error(`Stock inventory changed: ${stock.length}`);
  for(const kind of stock)groups.push({scope:'stock-native',kind,appearanceLabel:'native',appearance:{},states:figures[kind]||creatures[kind]?.weapon?carryStates:carryStates.slice(0,1)});
  for(const state of traceStates){
    if(!stock.includes(state.kind)||state.appearanceLabel!=='native'||state.carry!==6||!Number.isInteger(state.carryAim)||Math.abs(state.carryAim)>6)throw new Error(`Unsupported trace input: ${JSON.stringify(state)}`);
    groups.push({scope:'actual-mixed-extra',kind:state.kind,appearanceLabel:'native',appearance:{},states:[state]});
  }
  groups.push(
    {scope:'equipment-representative',kind:'footman',appearanceLabel:'greatSword',appearance:{weapon:'greatSword'},states:[carryStates[0],{carry:1,carryAim:-6}]},
    {scope:'equipment-representative',kind:'lancer',appearanceLabel:'roundShield',appearance:{shield:true,shieldStyle:'round'},states:[carryStates[0],{carry:3,carryAim:0}]},
    {scope:'ember-representative',kind:'priest',appearanceLabel:'ember',appearance:appearanceForKind('priest','ember'),states:[carryStates[0],{carry:6,carryAim:-4}]},
    {scope:'ember-representative',kind:'summoner',appearanceLabel:'ember',appearance:appearanceForKind('summoner','ember'),states:[carryStates[0],{carry:6,carryAim:4}]}
  );
  for(const group of additionalStates){
    if(group.scope!=='mercenary-equipment-representative'||!['mercenary','contractArcher','fieldMedic'].includes(group.kind)||!group.appearanceLabel||!group.appearance||!Array.isArray(group.states)||!group.states.length)throw new Error(`Unsupported additional group: ${JSON.stringify(group)}`);
    for(const state of group.states)if(!Number.isInteger(state.carry)||state.carry<0||state.carry>6||!Number.isInteger(state.carryAim)||Math.abs(state.carryAim)>6)throw new Error(`Unsupported additional state: ${JSON.stringify(state)}`);
    groups.push(group);
  }
  const expectedComparisons=7776+additionalStates.reduce((sum,group)=>sum+group.states.length*pairs.length*densities.length*facings.length*teams.length,0);
  const report={schemaVersion:1,completed:false,passed:false,method:'Real Chromium HTMLCanvasElement Canvas2D; exact complete original-domain RGBA comparisons, including RGB under zero alpha; no resampling, tolerance, WebGL, WorldLayer or card-cache code.',
    settings:{pairs,densities,facings,teams,carryStates,traceStates,additionalStates,expectedComparisons,yieldEveryComparisons:16,context:{type:'2d',willReadFrequently:true},domain:'actionPaintSize(originalPose, kind)',opaqueVariants:'excluded',walking:'negative control only'},
    stock,groups,rows:[],totals:totals(),scopeTotals:{},negativeControls:[]};
  window.idleBrowserIdentityCheckpoint=report;
  let batch=0;
  for(const group of groups)for(const frames of pairs){
    const row={scope:group.scope,kind:group.kind,appearanceLabel:group.appearanceLabel,frames,...totals(),failures:[]};report.rows.push(row);
    const scopeTotal=report.scopeTotals[group.scope]??(report.scopeTotals[group.scope]=totals());
    for(const state of group.states)for(const density of densities)for(const facing of facings)for(const team of teams){
      const carry=state.carry?{carry:state.carry,carryAim:state.carryAim}:{};
      const before={mode:'idle',frame:frames[0],...carry},after={...before,frame:frames[1]};
      const a=raster(group.kind,before,team,density,facing,group.appearance),b=raster(group.kind,after,team,density,facing,group.appearance);
      const result=compare(a.rgba,b.rgba);
      for(const target of [row,scopeTotal,report.totals])summarize(target,result,a.size*a.size);
      if((result.changedPixels||!result.visibleA||!result.visibleB)&&row.failures.length<8)row.failures.push({state,density,facing,team,tile:a.tile,size:a.size,...result});
      if(++batch===16){batch=0;await new Promise(resolve=>setTimeout(resolve,0));}
    }
    console.info('IDLE_IDENTITY '+JSON.stringify({scope:row.scope,kind:row.kind,frames,comparisons:row.comparisons,changedPixels:row.changedPixels,maximumChannelDifference:row.maximumChannelDifference,emptyReferences:row.emptyReferences,emptyCandidates:row.emptyCandidates}));
  }
  for(const control of [
    {name:'unmerged idle motion',kind:'footman',aPose:{mode:'idle',frame:0},bPose:{mode:'idle',frame:2},aTeam:teams[0],bTeam:teams[0]},
    {name:'authored figure owner colors',kind:'footman',aPose:{mode:'idle',frame:0},bPose:{mode:'idle',frame:0},aTeam:teams[0],bTeam:teams[1]},
    {name:'mounted walking phase',kind:'knight',aPose:{mode:'walk',frame:0},bPose:{mode:'walk',frame:2},aTeam:teams[0],bTeam:teams[0]}
  ]){
    const a=raster(control.kind,control.aPose,control.aTeam,4,1),b=raster(control.kind,control.bPose,control.bTeam,4,1),result=compare(a.rgba,b.rgba);
    report.negativeControls.push({...control,...result,passed:result.changedChannels>0&&result.visibleA>0&&result.visibleB>0});
  }
  report.canvasContexts=[...canvases].map(([size,canvas])=>({size,attributes:canvas.getContext('2d').getContextAttributes()}));
  report.requestedContexts=[...requestedContexts];report.webglAttempts=webglAttempts;
  report.completed=true;
  report.passed=report.totals.comparisons===expectedComparisons&&report.totals.changedChannels===0&&report.totals.emptyReferences===0&&report.totals.emptyCandidates===0&&report.negativeControls.every(row=>row.passed)&&webglAttempts===0;
  console.info('IDLE_IDENTITY '+JSON.stringify({completed:true,passed:report.passed,totals:report.totals,scopeTotals:report.scopeTotals}));
  return report;
};
