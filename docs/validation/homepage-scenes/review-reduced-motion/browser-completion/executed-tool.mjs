/** Real homepage browser lane. Production files stay untouched.
 * visual: --source ROOT --out NEW --fleet-times 4.2,12,19,28,39 --city-times 2,32,65
 * perf: --baseline ROOT --candidate ROOT --out NEW --seconds 15 [--scene fleet|capital]
 */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
const mode=process.argv[2],arg=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
const startAge=Number(arg('start-age')??7);if(!Number.isFinite(startAge)||startAge<1||startAge>25)throw new Error('Native start age must be bounded to 1–25 seconds');
if(!['visual','perf','cycle','demo'].includes(mode))throw new Error('Choose visual, perf, cycle or demo');
const output=resolve(arg('out')),toolRoot=resolve(arg('source')??arg('candidate'));
const require=createRequire(resolve(toolRoot,'package.json'));
const {createServer}=await import(require.resolve('vite'));
const WebSocket=require('ws');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(output); // Refuse to overwrite a completed evidence run.
const transformFiles=new Map();
const collectSource=async root=>{
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','src','public/art/world3d'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 const extras=['src/client/menu-scene-world.ts','src/client/menu-pirate-boarding.ts','src/client/menu-capital-street.ts'];
 for(const file of extras)try{await readFile(resolve(root,file));if(!files.includes(file))files.push(file);}catch{}
 const hashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f)))])));
 return {root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hashes};
};
const sources={};for(const name of ['baseline','candidate'])sources[name]=await collectSource(resolve(arg(name)));
const bootstrap=String.raw`
 localStorage.setItem('sketch-rts-menu-scene',new URL(location.href).searchParams.get('scene')??'fleet');
 window.__homeProof={halted:false,pauseAfterPaint:false,created:0,active:false,seek:null,draw:[],render:[],script:[],raf:[],frames:0,sequence:0,startup:{draw:[],render:[],prepare:[]},measurementBegan:false};
 const proof=window.__homeProof,raf=requestAnimationFrame.bind(window);
 let last;function observe(now){if(proof.active&&last!==undefined)proof.raf.push(now-last);last=now;raf(observe)}raf(observe);
 proof.begin=()=>{proof.draw=[];proof.render=[];proof.script=[];proof.raf=[];proof.frames=0;proof.activeStart=performance.now();proof.active=true;proof.measurementBegan=true;last=undefined;};
 proof.stop=()=>{proof.active=false;return {observedMs:performance.now()-proof.activeStart,draw:proof.draw,render:proof.render,script:proof.script,raf:proof.raf,frames:proof.frames};};
`;
const menuHook=String.raw`
;{
 const nativeBegin=MenuBackdrop.prototype.begin;MenuBackdrop.prototype.begin=function(...args){const value=nativeBegin.apply(this,args);if(window.__homeProof)window.__homeProof.created++;return value;};
 const nativeDraw=MenuBackdrop.prototype.draw;
 MenuBackdrop.prototype.draw=function(...args){
  const proof=window.__homeProof;if(!proof)return nativeDraw.apply(this,args);
  proof.backdrop=this;
  if(proof.halted||proof.seek!==null&&proof.presentedSeek===proof.seek)return;
  const run=this.run;
  if(run&&!run.__proofWrapped){
   run.__proofWrapped=true;const nativeScript=run.script;
   run.script=function(...values){if(!proof.active)return nativeScript.apply(this,values);const before=performance.now();try{return nativeScript.apply(this,values)}finally{proof.script.push({tick:values[0].tick,ms:performance.now()-before});}};
  }
  if(proof.seek!==null&&this.run?.presentation){
   const t=proof.seek,now=args[3];this.started=now-t*1000;this.clock=now;this.carry=0;this.lastPaint=-Infinity;
   this.snapshot=undefined;
  }
  const previous=this.lastPaint,before=performance.now();
  const result=nativeDraw.apply(this,args);
  if(proof.lastFrame?.now!==args[3])return result;
  if(args[4]===false){proof.normalFrames??=[];proof.normalFrames.push({now:args[3],age:(args[3]-this.started)/1000,tick:proof.lastFrame.snapshot.tick,created:proof.created,runAlive:!!this.run});if(proof.normalFrames.length>128)proof.normalFrames.shift();}
  if(proof.stopAfterNormalRebuild!==undefined&&args[4]===false&&proof.created>proof.stopAfterNormalRebuild&&this.run){proof.halted=true;delete proof.stopAfterNormalRebuild;}
  if(previous!==this.lastPaint){const record={ms:performance.now()-before,tick:this.run?.game.tick,age:(args[3]-this.started)/1000};if(!proof.measurementBegan){record.pageNow=args[3];record.resourceHidden=document.querySelector('.resource-screen')?.hidden;}if(proof.active){proof.frames++;proof.draw.push(record);}else if(!proof.measurementBegan)proof.startup.draw.push(record);}
  proof.paintNow=args[3];proof.paintAge=(args[3]-this.started)/1000;proof.paintReduced=args[4];proof.runAlive=!!this.run;
  if(proof.pauseAfterPaint){proof.halted=true;proof.pauseAfterPaint=false;}
  if(proof.seek!==null){proof.presentedSeek=proof.seek;proof.presentedTick=proof.lastFrame?.snapshot.tick;}proof.sequence++;return result;
 };
}
`;
const presentationHook=String.raw`
;{
 const nativePrepare=WorldPresentation.prototype.prepare;
 if(nativePrepare)WorldPresentation.prototype.prepare=async function(...args){
  const p=window.__homeProof,start=performance.now();try{return await nativePrepare.apply(this,args);}finally{
   if(p&&!p.measurementBegan){const layer=this.layer;p.startup.prepare.push({ms:performance.now()-start,start,end:performance.now(),cards:layer?.cardStats(),remains:layer?.remainsStats(),view:layer?.viewStats(),preparedRemainsKeys:[...(layer?.remainsCards?.rasterCache?.entries?.keys()??[])]});}
  }
 };
 const nativeDraw=WorldPresentation.prototype.draw;
 WorldPresentation.prototype.draw=function(...args){
  const proof=window.__homeProof;if(!proof)return nativeDraw.apply(this,args);
  proof.lastFrame=args[0];proof.presentation=this;
  const before=performance.now();
  const result=nativeDraw.apply(this,args);
  if(proof.lastFrame?.now!==args[3])return result;
  if(args[4]===false){proof.normalFrames??=[];proof.normalFrames.push({now:args[3],age:(args[3]-this.started)/1000,tick:proof.lastFrame.snapshot.tick,created:proof.created,runAlive:!!this.run});if(proof.normalFrames.length>128)proof.normalFrames.shift();}
  if(proof.stopAfterNormalRebuild!==undefined&&args[4]===false&&proof.created>proof.stopAfterNormalRebuild&&this.run){proof.halted=true;delete proof.stopAfterNormalRebuild;}
  if(proof.active)proof.render.push(performance.now()-before);else if(!proof.measurementBegan)proof.startup.render.push(performance.now()-before);
  return result;
 };
}
`;
let browserSerial=0;
async function launch(root,label){
 const scratch=await mkdtemp('/workspace/homepage-proof-browser-');
 const errors=[],failures=[];let server,browser,socket;
 const pending=new Map();let serial=0;
 try{
 server=await createServer({root,configFile:resolve(root,'vite.config.ts'),cacheDir:resolve(scratch,'vite'),define:{'import.meta.env.VITE_SKETCH_RTS_DEPLOYMENT':JSON.stringify('static')},plugins:[{name:'homepage-proof-observer',enforce:'pre',transform(code,id){let hook;
  if(id.split('?')[0]===resolve(root,'src/client/menu-scenes.ts'))hook=menuHook;
  if(id.split('?')[0]===resolve(root,'src/client/world-presentation.ts'))hook=presentationHook;
  if(!hook)return;const name=`${label}-${id.endsWith('menu-scenes.ts')?'menu-scenes':'world-presentation'}.ts`,executed=code+hook;transformFiles.set(name,executed);return {code:executed,map:null};
 }}],server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/docs/**']}}});await server.listen();
 browser=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--enable-precise-memory-info','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/chromium`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',bytes=>{const match=String(bytes).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
 socket.on('message',bytes=>{const data=JSON.parse(String(bytes));if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timeout);data.error?p.reject(new Error(JSON.stringify(data.error))):p.done(data.result);}return;}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description??data.params.exceptionDetails.text);if(data.method==='Runtime.consoleAPICalled'&&data.params.type==='error')errors.push(data.params.args.map(v=>v.value??v.description).join(' '));if(data.method==='Network.loadingFailed')failures.push(data.params);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},120000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 const page=(method,params)=>command(method,params,sessionId);
 const evaluate=async expression=>{const value=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
 const wait=condition=>evaluate(`new Promise((done,reject)=>{const deadline=performance.now()+90000;function check(){if(${condition})return done(true);if(performance.now()>deadline)return reject(new Error('Homepage condition timeout: '+JSON.stringify({scene:window.__homeProof?.backdrop?.scene.id,seek:window.__homeProof?.seek,presentedSeek:window.__homeProof?.presentedSeek,tick:window.__homeProof?.presentedTick,frameTick:window.__homeProof?.lastFrame?.snapshot?.tick,menu:document.querySelector('[data-main-menu]')?.dataset.menuView,resourceHidden:document.querySelector('.resource-screen')?.hidden,activeTag:document.activeElement?.tagName,activeText:document.activeElement?.textContent})));setTimeout(check,25)}check()})`);
 const pause=ms=>evaluate(`new Promise(done=>setTimeout(done,${ms}))`);
 await page('Page.enable');await page('Runtime.enable');await page('Network.enable');await page('Page.addScriptToEvaluateOnNewDocument',{source:bootstrap});
 const viewport=async(width,height)=>page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
 const navigate=async(scene,width=1440,height=900)=>{await viewport(width,height);await page('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/?scene=${scene}`});await wait("window.__homeProof?.lastFrame&&document.querySelector('[data-open-profile]')&&document.querySelector('.resource-screen')?.hidden");await evaluate('document.fonts.ready');};
 const click=async selector=>{const at=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await page('Input.dispatchMouseEvent',{type:'mousePressed',...at,button:'left',clickCount:1});await page('Input.dispatchMouseEvent',{type:'mouseReleased',...at,button:'left',clickCount:1});};
 const screenshot=async file=>{const gpu=await evaluate(`(async()=>{const gl=__homeProof.presentation?.context;if(!gl)return{available:false};const start=performance.now(),sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync)throw new Error('GPU fence creation failed');gl.flush();let polls=0;try{for(;;){const status=gl.clientWaitSync(sync,0,0);polls++;if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return{available:true,waitMs:performance.now()-start,polls,status};if(status===gl.WAIT_FAILED||gl.isContextLost())throw new Error('GPU fence failed');if(performance.now()-start>90000)throw new Error('GPU fence timeout');await new Promise(done=>setTimeout(done,0));}}finally{gl.deleteSync(sync)}})()`);const shot=await page('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(shot.data,'base64');await writeFile(resolve(output,file),bytes);return{file,sha256:sha(bytes),gpuCompletion:gpu};};
 const state=()=>evaluate(`(()=>{const p=__homeProof,f=p.lastFrame,b=p.backdrop,g=b.run?.game??f.snapshot,box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{scene:b.scene.id,age:(performance.now()-b.started)/1000,submittedAge:(f.now-b.started)/1000,submittedTick:f.snapshot.tick,tick:g.tick,view:f.view,reducedMotion:f.reducedMotion,presentation:!!b.run?.presentation,unitCount:g.units.length,buildingCount:g.buildings.length,effectTypes:g.effects.map(e=>e.type),ships:g.units.filter(u=>u.sailing).map(u=>({id:u.id,kind:u.kind,owner:u.owner,hp:u.hp,x:u.x,y:u.y,deckScale:u.deckScale,heading:u.sailing.heading,gangway:u.sailing.gangway})),crew:g.units.filter(u=>u.deck).map(u=>({id:u.id,kind:u.kind,variant:u.variant,owner:u.owner,hp:u.hp,deck:u.deck,gangway:u.gangway,order:u.order})),props:b.run?.props??f.story?.props,preparedRemainsKeys:[...(p.presentation?.layer?.remainsCards?.rasterCache?.entries?.keys()??[])],remainsCacheStats:p.presentation?.layer?.remainsStats(),units:g.units.filter(u=>!u.sailing&&!u.deck).map(u=>({id:u.id,kind:u.kind,variant:u.variant,owner:u.owner,x:u.x,y:u.y,hp:u.hp})),corpses:g.corpses,menu:box(document.querySelector('.menu-window')),buttons:[...document.querySelectorAll('.map-button')].map(e=>({text:e.textContent.trim(),...box(e)})),renderer:document.querySelector('.world-underlay')?.hidden?'Canvas fallback':'WebGL2 stack',scrollWidth:document.documentElement.scrollWidth,windowWidth:innerWidth}})()`);
 const memory=()=>evaluate("performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null");
 return{page,evaluate,wait,pause,viewport,navigate,click,screenshot,state,memory,errors,failures,browser:await command('Browser.getVersion'),close:async()=>{for(const p of pending.values())clearTimeout(p.timeout);socket?.close();if(browser&&browser.exitCode===null&&browser.signalCode===null)await new Promise(done=>{const stop=setTimeout(()=>browser.kill('SIGKILL'),5000);browser.once('exit',()=>{clearTimeout(stop);done();});browser.kill('SIGTERM');});await server?.close();await rm(scratch,{recursive:true,force:true});}};
 }catch(error){for(const p of pending.values())clearTimeout(p.timeout);socket?.close();if(browser&&browser.exitCode===null&&browser.signalCode===null)await new Promise(done=>{const stop=setTimeout(()=>browser.kill('SIGKILL'),5000);browser.once('exit',()=>{clearTimeout(stop);done();});browser.kill('SIGTERM');});await server?.close();await rm(scratch,{recursive:true,force:true});throw error;}
}

const checks=[],results=[],runtime={},limits='Seek-based visual age regression in real Chromium SwiftShader WebGL2 + Canvas composition. No five-minute waiting or performance claim. Reduced actors/camera/tick remain static; atmosphere and motes may use age. Canvas RGBA checks the fade overlay only; the fenced full screenshot shows all three world layers. Normal age=end draws an intentional black transition then starts a new run on the next production draw.';
const harnessSha256=sha(await readFile(new URL(import.meta.url)));
await writeFile(resolve(output,'executed-tool.mjs'),await readFile(new URL(import.meta.url)));
await writeFile(resolve(output,'inputs.json'),JSON.stringify({mode:'reduced-motion-age-regression',sources,harnessSha256,viewportSizes:[[1440,900],[390,844]],probeFormula:['length-0.1','length','length+0.1','2*length','300'],extendsEvidence:'/workspace/homepage-reduced-motion-visual-1',skipAlreadyCaptured:['before all six300s','after capital1440x900 five reduced ages'],limits,watchIgnore:['**/docs/**']},null,2)+'\n');
function check(name,pass,details={}){const item={name,pass,...details};checks.push(item);if(!pass)console.error(JSON.stringify(item));}
const signature=state=>JSON.stringify({tick:state.tick,view:state.view,ships:state.ships,crew:state.crew,units:state.units,corpses:state.corpses,effectTypes:state.effectTypes,unitCount:state.unitCount,buildingCount:state.buildingCount});
const metricsExpression=`(()=>{const c=document.querySelector('.game-canvas'),b=c.getContext('2d'),data=b.getImageData(0,0,c.width,c.height).data;let alpha255=0,fadeRGB=0,nearBlack=0,sumAlpha=0;for(let k=0;k<data.length;k+=4){const r=data[k],g=data[k+1],v=data[k+2],a=data[k+3];if(a===255)alpha255++;if(a===255&&r===12&&g===7&&v===3)fadeRGB++;if(a>250&&r<25&&g<25&&v<25)nearBlack++;sumAlpha+=a;}return{canvas:{width:c.width,height:c.height},pixels:data.length/4,alpha255,fadeRGB,fadeCoverRatio:fadeRGB/(data.length/4),nearBlackRatio:nearBlack/(data.length/4),meanAlpha:sumAlpha/(data.length/4),note:'Main overlay canvas, excludes separate ground/WebGL actors and DOM menu.'};})()`;
async function probe(session,label,scene,width,height,age,tag){
 await session.evaluate(`__homeProof.halted=false;__homeProof.presentedSeek=null;__homeProof.seek=${age}`);
 await session.wait(`__homeProof.presentedSeek===${age}&&__homeProof.paintReduced===true&&Math.abs(__homeProof.paintAge-${age})<0.00001&&__homeProof.lastFrame.reducedMotion===true&&__homeProof.lastFrame.snapshot.tick===Math.floor(__homeProof.backdrop.run.stillSecond*20)`);
 const state=await session.state(),paint=await session.evaluate('({now:__homeProof.paintNow,age:__homeProof.paintAge,reduced:__homeProof.paintReduced,created:__homeProof.created,runAlive:__homeProof.runAlive})');
 const file=`${label}-${scene}-${width}x${height}-${tag}.png`,capture=await session.screenshot(file);
 if(!capture.gpuCompletion.available)throw new Error('Real WebGL2 GPU completion required');
 const overlay=await session.evaluate(metricsExpression),record={label,scene,width,height,requestedAge:age,tag,paint,state,overlay,capture};
 results.push(record);await writeFile(resolve(output,file.replace('.png','.json')),JSON.stringify(record,null,2)+'\n');
 check('exact-painted-age',Math.abs(paint.age-age)<1e-5,{label,scene,tag,age,paintAge:paint.age});
 check('reduced-static-tick',state.reducedMotion&&state.tick===Math.floor((await session.evaluate('__homeProof.backdrop.run.stillSecond'))*20),{label,scene,tag,tick:state.tick});
 if(label==='after')check('no-opaque-fade-in-reduced-motion',overlay.fadeCoverRatio<.01,{scene,tag,fadeCoverRatio:overlay.fadeCoverRatio});
 if(label==='before'&&age===300)check('reproduces-original-opaque-fade',overlay.fadeCoverRatio>.999,{scene,tag,fadeCoverRatio:overlay.fadeCoverRatio});
 console.log(JSON.stringify({label,scene,size:[width,height],age,file,fadeCoverRatio:overlay.fadeCoverRatio,tick:state.tick,created:paint.created}));
 return record;
}
async function ordinaryAndRestart(session,scene,width,height){
 const created=await session.evaluate('__homeProof.created');
 await session.evaluate(`__homeProof.normalFrames=[];__homeProof.stopAfterNormalRebuild=${created}`);
 await session.page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await session.evaluate('__homeProof.halted=false;__homeProof.seek=null;__homeProof.presentedSeek=null');
 await session.wait(`__homeProof.halted===true&&__homeProof.created>${created}&&__homeProof.lastFrame.reducedMotion===false&&__homeProof.backdrop.run`);
 const rebuilt=await session.evaluate('({created:__homeProof.created,now:__homeProof.paintNow,age:__homeProof.paintAge,tick:__homeProof.lastFrame.snapshot.tick,normalFrames:__homeProof.normalFrames})');
 check('normal-mode-restarts-ended-run',rebuilt.created===created+1,{scene,size:[width,height],created,rebuilt});
 await session.evaluate('__homeProof.halted=false;__homeProof.presentedSeek=null;__homeProof.seek=2.6');
 await session.wait('__homeProof.presentedSeek===2.6&&__homeProof.lastFrame.reducedMotion===false&&Math.abs(__homeProof.paintAge-2.6)<.00001');
 const ordinary={scene,width,height,kind:'ordinary-after-reduced',state:await session.state(),overlay:await session.evaluate(metricsExpression),capture:await session.screenshot(`after-${scene}-${width}x${height}-ordinary-age2.6.png`)};
 check('ordinary-opening-readable',ordinary.overlay.fadeCoverRatio<.01,{scene,size:[width,height],fadeCoverRatio:ordinary.overlay.fadeCoverRatio});
 const identity=await session.evaluate(`(()=>{const p=__homeProof,b=p.backdrop;p.preRestart={run:b.run,game:b.run.game,models:b.run.models,corpses:b.run.warmCorpses,created:p.created};p.seek=null;p.presentedSeek=null;p.halted=false;p.pauseAfterPaint=true;b.startPresentation(performance.now());return{created:p.created};})()`);
 await session.wait('__homeProof.halted===true&&__homeProof.lastFrame.reducedMotion===false&&__homeProof.lastFrame.snapshot.tick===0');
 const restart=await session.evaluate(`(()=>{const p=__homeProof,b=p.backdrop,s=p.preRestart;return{tick:p.lastFrame.snapshot.tick,age:p.paintAge,created:p.created,sameRun:b.run===s.run,sameGame:b.run.game===s.game,sameModels:b.run.models===s.models,sameCorpses:b.run.warmCorpses===s.corpses};})()`);
 check('explicit-restart-keeps-prepared-cast',restart.tick===0&&restart.created===identity.created&&restart.sameRun&&restart.sameGame&&restart.sameModels&&restart.sameCorpses,{scene,size:[width,height],restart});
 await session.evaluate('__homeProof.halted=false;__homeProof.presentedSeek=null;__homeProof.seek=1.6');
 await session.wait('__homeProof.presentedSeek===1.6&&__homeProof.lastFrame.reducedMotion===false&&Math.abs(__homeProof.paintAge-1.6)<.00001');
 const afterRestart={scene,width,height,kind:'ordinary-after-explicit-restart',restart,state:await session.state(),overlay:await session.evaluate(metricsExpression),capture:await session.screenshot(`after-${scene}-${width}x${height}-restart-age1.6.png`)};
 check('ordinary-restart-opening-readable',afterRestart.overlay.fadeCoverRatio<.01,{scene,size:[width,height],fadeCoverRatio:afterRestart.overlay.fadeCoverRatio});
 results.push(ordinary,afterRestart);
 await writeFile(resolve(output,`after-${scene}-${width}x${height}-ordinary-restart.json`),JSON.stringify({rebuilt,ordinary,afterRestart},null,2)+'\n');
}
try{
 // First supply the six direct before/after desktop comparisons; then complete
 // the requested boundary matrix and the mobile composition independently.
 for(const label of ['after']){
  const root=sources[label==='before'?'baseline':'candidate'].root,session=await launch(root,label);
  runtime[label]={browser:session.browser};
  try{
   for(const [width,height] of [[1440,900],[390,844]])for(const scene of ['capital','woods','fleet']){
    if(width===1440&&scene==='capital')continue;
    await session.page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await session.navigate(scene,width,height);await session.wait('__homeProof.lastFrame.reducedMotion===true');
    const length=await session.evaluate('__homeProof.backdrop.run.length'),ages=label==='before'?[300]:[length-.1,length,length+.1,2*length,300];
    const initialCreated=await session.evaluate('__homeProof.created');let reference;
    for(const age of ages){
     const tag=age===300?'age300':'age'+String(age).replace('.','p');
     const record=await probe(session,label,scene,width,height,age,tag);
     reference??=signature(record.state);
     check('reduced-actors-camera-unchanged',signature(record.state)===reference,{label,scene,size:[width,height],age});
     check('reduced-keeps-same-run',record.paint.created===initialCreated&&record.paint.runAlive,{label,scene,size:[width,height],age,initialCreated,created:record.paint.created});
    }
    await writeFile(resolve(output,'partial-checks.json'),JSON.stringify({checks,results},null,2)+'\n');
   }
   for(const [width,height] of [[1440,900],[390,844]])for(const scene of ['capital','woods','fleet']){
    await session.page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await session.navigate(scene,width,height);await session.wait('__homeProof.lastFrame.reducedMotion===true');
    await session.evaluate('__homeProof.presentedSeek=null;__homeProof.seek=300');
    await session.wait('__homeProof.presentedSeek===300&&__homeProof.lastFrame.reducedMotion===true&&Math.abs(__homeProof.paintAge-300)<.00001');
    await ordinaryAndRestart(session,scene,width,height);
    await writeFile(resolve(output,'partial-checks.json'),JSON.stringify({checks,results},null,2)+'\n');
   }
  }finally{runtime[label].errors=session.errors;runtime[label].networkFailures=session.failures;await session.close();}
  check('no-browser-errors',runtime[label].errors.length===0&&runtime[label].networkFailures.length===0,{label,errors:runtime[label].errors,networkFailures:runtime[label].networkFailures});
 }
 const end={};for(const [label,source] of Object.entries(sources))end[label]=await collectSource(source.root);
 const unchanged=JSON.stringify(sources)===JSON.stringify(end);check('source-unchanged-during-proof',unchanged);
 for(const [file,code] of transformFiles)await writeFile(resolve(output,file),code);
 const proof={pass:checks.every(item=>item.pass),method:'Seek-based reduced-motion visual age regression',limits,sources,end,unchanged,harnessSha256,runtime,checks,results,transforms:Object.fromEntries([...transformFiles].map(([file,code])=>[file,sha(code)]))};
 await writeFile(resolve(output,'proof.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({pass:proof.pass,checks:checks.length,failures:checks.filter(c=>!c.pass),captures:results.length,output}));
 if(!proof.pass)process.exitCode=1;
}catch(error){
 for(const [file,code] of transformFiles)await writeFile(resolve(output,file),code);
 await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack,sources,harnessSha256,checks,results,runtime,limits},null,2)+'\n');
 console.error(error);process.exitCode=1;
}
