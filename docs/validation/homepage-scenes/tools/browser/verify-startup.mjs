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
const sources={};for(const name of mode==='perf'?['baseline','candidate']:['source'])sources[name]=await collectSource(resolve(arg(name)));
const bootstrap=String.raw`
 localStorage.setItem('sketch-rts-menu-scene',new URL(location.href).searchParams.get('scene')??'fleet');
 window.__homeProof={active:false,seek:null,draw:[],render:[],script:[],raf:[],frames:0,sequence:0,startup:{draw:[],render:[],prepare:[]},measurementBegan:false};
 const proof=window.__homeProof,raf=requestAnimationFrame.bind(window);
 let last;function observe(now){if(proof.active&&last!==undefined)proof.raf.push(now-last);last=now;raf(observe)}raf(observe);
 proof.begin=()=>{proof.draw=[];proof.render=[];proof.script=[];proof.raf=[];proof.frames=0;proof.activeStart=performance.now();proof.active=true;proof.measurementBegan=true;last=undefined;};
 proof.stop=()=>{proof.active=false;return {observedMs:performance.now()-proof.activeStart,draw:proof.draw,render:proof.render,script:proof.script,raf:proof.raf,frames:proof.frames};};
`;
const menuHook=String.raw`
;{
 const nativeDraw=MenuBackdrop.prototype.draw;
 MenuBackdrop.prototype.draw=function(...args){
  const proof=window.__homeProof;if(!proof)return nativeDraw.apply(this,args);
  proof.backdrop=this;
  if(proof.seek!==null&&proof.presentedSeek===proof.seek)return;
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
  if(previous!==this.lastPaint){const record={ms:performance.now()-before,tick:this.run?.game.tick,age:(args[3]-this.started)/1000};if(proof.active){proof.frames++;proof.draw.push(record);}else if(!proof.measurementBegan)proof.startup.draw.push(record);}
  if(proof.seek!==null){proof.presentedSeek=proof.seek;proof.presentedTick=this.run?.game.tick;}proof.sequence++;return result;
 };
}
`;
const presentationHook=String.raw`
;{
 const nativePrepare=WorldPresentation.prototype.prepare;
 if(nativePrepare)WorldPresentation.prototype.prepare=async function(...args){
  const p=window.__homeProof,start=performance.now();try{return await nativePrepare.apply(this,args);}finally{
   if(p&&!p.measurementBegan){const layer=this.layer;p.startup.prepare.push({ms:performance.now()-start,start,end:performance.now(),cards:layer?.cardStats(),remains:layer?.remainsStats(),view:layer?.viewStats()});}
  }
 };
 const nativeDraw=WorldPresentation.prototype.draw;
 WorldPresentation.prototype.draw=function(...args){
  const proof=window.__homeProof;if(!proof)return nativeDraw.apply(this,args);
  proof.lastFrame=args[0];proof.presentation=this;
  const before=performance.now();
  const result=nativeDraw.apply(this,args);
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
 }}],server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
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
 const state=()=>evaluate(`(()=>{const p=__homeProof,f=p.lastFrame,b=p.backdrop,g=b.run?.game??f.snapshot,box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{scene:b.scene.id,age:(performance.now()-b.started)/1000,submittedAge:(f.now-b.started)/1000,submittedTick:f.snapshot.tick,tick:g.tick,view:f.view,reducedMotion:f.reducedMotion,presentation:!!b.run?.presentation,unitCount:g.units.length,buildingCount:g.buildings.length,effectTypes:g.effects.map(e=>e.type),ships:g.units.filter(u=>u.sailing).map(u=>({id:u.id,kind:u.kind,owner:u.owner,hp:u.hp,x:u.x,y:u.y,deckScale:u.deckScale,heading:u.sailing.heading,gangway:u.sailing.gangway})),crew:g.units.filter(u=>u.deck).map(u=>({id:u.id,kind:u.kind,variant:u.variant,owner:u.owner,hp:u.hp,deck:u.deck,gangway:u.gangway,order:u.order})),props:b.run?.props??f.story?.props,units:g.units.filter(u=>!u.sailing&&!u.deck).map(u=>({id:u.id,kind:u.kind,variant:u.variant,owner:u.owner,x:u.x,y:u.y,hp:u.hp})),corpses:g.corpses,menu:box(document.querySelector('.menu-window')),buttons:[...document.querySelectorAll('.map-button')].map(e=>({text:e.textContent.trim(),...box(e)})),renderer:document.querySelector('.world-underlay')?.hidden?'Canvas fallback':'WebGL2 stack',scrollWidth:document.documentElement.scrollWidth,windowWidth:innerWidth}})()`);
 const memory=()=>evaluate("performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null");
 return{page,evaluate,wait,pause,viewport,navigate,click,screenshot,state,memory,errors,failures,browser:await command('Browser.getVersion'),close:async()=>{for(const p of pending.values())clearTimeout(p.timeout);socket?.close();if(browser&&browser.exitCode===null&&browser.signalCode===null)await new Promise(done=>{const stop=setTimeout(()=>browser.kill('SIGKILL'),5000);browser.once('exit',()=>{clearTimeout(stop);done();});browser.kill('SIGTERM');});await server?.close();await rm(scratch,{recursive:true,force:true});}};
 }catch(error){for(const p of pending.values())clearTimeout(p.timeout);socket?.close();if(browser&&browser.exitCode===null&&browser.signalCode===null)await new Promise(done=>{const stop=setTimeout(()=>browser.kill('SIGKILL'),5000);browser.once('exit',()=>{clearTimeout(stop);done();});browser.kill('SIGTERM');});await server?.close();await rm(scratch,{recursive:true,force:true});throw error;}
}
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b),q=p=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]??null;return{n:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1)??null,over50:values.filter(v=>v>50).length,over100:values.filter(v=>v>100).length};};
await writeFile(resolve(output,'inputs.json'),JSON.stringify({mode,sources,harnessSha256:sha(await readFile(new URL(import.meta.url)))},null,2)+'\n');
const results=[];
try{
 if(mode==='perf'||mode==='cycle'){
  const requestedSeconds=Number(arg('seconds')??15);if(!Number.isFinite(requestedSeconds)||requestedSeconds<5||requestedSeconds>90)throw new Error('Bound native observation to 5–90 seconds');
  for(const scene of arg('scene')?[arg('scene')]:['fleet','capital','woods'])for(const [ordinal,label] of (mode==='cycle'?['source']:['baseline','candidate','candidate','baseline']).entries()){
   const seconds=mode==='cycle'?{fleet:60,capital:90,woods:52}[scene]:requestedSeconds;
   const id=`${scene}-${ordinal+1}-${label}`,session=await launch(sources[label].root,id);
   try{
    await session.navigate(scene);const navigationReadyMs=await session.evaluate('performance.now()');await session.wait('__homeProof.backdrop?.run&&performance.now()-__homeProof.backdrop.started>=7000&&__homeProof.lastFrame?.snapshot.tick>=140');
    const before=await session.state(),memoryBefore=await session.memory(),startup=await session.evaluate('({...__homeProof.startup,cards:__homeProof.presentation?.layer?.cardStats(),remains:__homeProof.presentation?.layer?.remainsStats(),view:__homeProof.presentation?.layer?.viewStats()})');startup.navigationReadyMs=navigationReadyMs;
    await session.evaluate("if(__homeProof.seek!==null)throw new Error('Seeking during performance is forbidden');__homeProof.begin()");
    await session.pause(seconds*1000);const raw=await session.evaluate('__homeProof.stop()');
    const memoryAfter=await session.memory(),after=await session.state();
    const record={id,label,scene,seconds,browser:session.browser,before,after,memoryBefore,memoryAfter,startup,errors:session.errors,failures:session.failures,observedMs:raw.observedMs,summary:{rafIntervalMs:summary(raw.raf),paintDrawSubmitMs:summary(raw.draw.map(v=>v.ms)),renderSubmitMs:summary(raw.render),scriptMs:summary(raw.script.map(v=>v.ms)),paintFrames:raw.frames},raw};
    await writeFile(resolve(output,id+'.json.gz'),gzipSync(JSON.stringify(record,null,2)+'\n'));
    results.push({...record,raw:{file:id+'.json.gz'}});console.log(JSON.stringify({id,summary:record.summary,errors:record.errors,failures:record.failures}));
   }finally{await session.close();}
  }
 }else{
  const root=sources.source.root,session=await launch(root,'visual');
  try{
   if(mode==='visual'){
    const times={fleet:(arg('fleet-times')??'4.2,12,19,28,39').split(',').map(Number),capital:(arg('city-times')??'2,32,65').split(',').map(Number),woods:(arg('woods-times')??'2,18,36').split(',').map(Number)};
    for(const scene of arg('scene')?[arg('scene')]:['fleet','capital','woods'])for(const [width,height] of (arg('sizes')?arg('sizes').split(',').map(value=>value.split('x').map(Number)):[[1440,900],[1280,720],[390,844]])){
     await session.navigate(scene,width,height);await session.pause(150);
     for(const second of times[scene]){
      await session.evaluate(`__homeProof.presentedSeek=null;__homeProof.seek=${second}`);await session.wait(`__homeProof.presentedSeek===${second}&&Math.abs(__homeProof.presentedTick-${second}*20)<=1&&__homeProof.lastFrame.snapshot.tick===__homeProof.presentedTick`);
      const state=await session.state(),capture=await session.screenshot(`${scene}-${width}x${height}-t${second}.png`);
      const record={scene,width,height,second,capture,state};results.push(record);console.log(JSON.stringify({scene,width,height,second,capture,view:state.view,units:state.unitCount,corpses:state.corpses?.length,effectTypes:state.effectTypes}));
     }
    }
    if(!arg('skip-ui')){
    await session.evaluate('__homeProof.seek=null');await session.navigate('fleet',1280,720);await session.pause(150);
    await session.page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await session.wait("__homeProof.lastFrame.reducedMotion===true&&__homeProof.backdrop.run.game.tick===Math.floor(__homeProof.backdrop.run.stillSecond*20)");
    const reducedBefore=await session.state(),reducedSequence=await session.evaluate('__homeProof.sequence');await session.pause(1200);await session.wait(`__homeProof.lastFrame.reducedMotion===true&&__homeProof.sequence>${reducedSequence}`);const reducedAfter=await session.state();if(reducedBefore.tick!==reducedAfter.tick||JSON.stringify(reducedBefore.view)!==JSON.stringify(reducedAfter.view))throw new Error('Reduced motion did not freeze the authored scene');
    results.push({test:'reduced-motion',before:reducedBefore,after:reducedAfter,capture:await session.screenshot('reduced-motion.png'),stableTick:reducedBefore.tick===reducedAfter.tick});
    await session.page('Emulation.setEmulatedMedia',{features:[]});await session.viewport(390,844);await session.wait("__homeProof.lastFrame.reducedMotion===false&&__homeProof.lastFrame.view.width===390&&__homeProof.lastFrame.view.height===844");
    results.push({test:'live-resize',state:await session.state(),capture:await session.screenshot('live-resize-390x844.png')});
    await session.viewport(1280,720);await session.wait("__homeProof.lastFrame.view.width===1280&&__homeProof.lastFrame.view.height===720");await session.click('[data-open-profile]');await session.wait("document.querySelector('[data-main-menu]').dataset.menuView==='profile'");
    const profile=await session.evaluate("({view:document.querySelector('[data-main-menu]').dataset.menuView,buttons:[...document.querySelectorAll('.menu-window button')].map(e=>({text:e.textContent.trim(),disabled:e.disabled}))})");
    await session.evaluate("document.querySelector('[data-profile-form] input[name=name]').focus();document.querySelector('[data-profile-form] input[name=name]').select()");await session.page('Input.insertText',{text:'Homepage scene proof'});await session.click('[data-profile-form] button[type=submit]');await session.wait("document.querySelector('[data-main-menu]').dataset.menuView==='home'");const savedProfile=await session.evaluate("JSON.parse(localStorage.getItem('sketch-rts-user'))");if(savedProfile.name!=='Homepage scene proof')throw new Error('Profile did not save');
    await session.evaluate("document.querySelector('[data-scene-switch]').focus()");await session.page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await session.page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await session.wait("__homeProof.backdrop.scene.id==='capital'&&document.querySelector('.resource-screen')?.hidden");
    results.push({test:'settings-pointer-and-scene-keyboard',profile,savedProfile,state:await session.state(),capture:await session.screenshot('scene-switch-keyboard.png')});
    await session.click('[data-open-create]');await session.wait("document.querySelector('[data-main-menu]').dataset.menuView==='maps'");const mapView=await session.evaluate("({view:document.querySelector('[data-main-menu]').dataset.menuView,mapEntries:document.querySelectorAll('[data-map-id]').length,continueVisible:!!document.querySelector('[data-map-next]')})");await session.click('[data-back-home]');await session.wait("document.querySelector('[data-main-menu]').dataset.menuView==='home'");results.push({test:'play-pointer',mapView});await session.click('[data-open-room-browser]');await session.wait("document.querySelector('[data-main-menu]').dataset.menuView==='rooms'&&document.querySelector('[data-back-home]')");const roomsView=await session.evaluate("({view:document.querySelector('[data-main-menu]').dataset.menuView,state:document.querySelector('[data-room-list]')?.dataset.roomList,backVisible:!!document.querySelector('[data-back-home]')})");await session.click('[data-back-home]');await session.wait("document.querySelector('[data-main-menu]').dataset.menuView==='home'");results.push({test:'rooms-pointer',roomsView});
    }
   }else{
    const scene=arg('scene')??'fleet',duration=Number(arg('duration')??42),fps=Number(arg('fps')??12),width=Number(arg('width')??1280),height=Number(arg('height')??720);
    if(!Number.isFinite(duration)||duration<=0||duration>90||fps<1||fps>20)throw new Error('Bound demo parameters');
    await session.navigate(scene,width,height);await session.pause(150);await mkdir(resolve(output,'frames'));
    for(let frame=0;frame<Math.round(duration*fps);frame++){
     const second=frame/fps+1.6;await session.evaluate(`__homeProof.presentedSeek=null;__homeProof.seek=${second}`);await session.wait(`__homeProof.presentedSeek===${second}&&Math.abs(__homeProof.presentedTick-${second}*20)<=1&&__homeProof.lastFrame.snapshot.tick===__homeProof.presentedTick`);
     await session.screenshot(`frames/frame-${String(frame).padStart(5,'0')}.png`);
     if(frame%fps===0)console.log(JSON.stringify({frame,second}));
    }
    execFileSync('/usr/bin/ffmpeg',['-y','-framerate',String(fps),'-i',resolve(output,'frames/frame-%05d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','21','-movflags','+faststart',resolve(output,scene+'.mp4')],{stdio:'pipe'});
    results.push({scene,duration,fps,width,height,method:'Time-seek production homepage frames encoded in order. This demonstration is not a real-time performance recording.',file:scene+'.mp4',sha256:sha(await readFile(resolve(output,scene+'.mp4')))});
   }
   results.push({browser:session.browser,errors:session.errors,failures:session.failures});
  }finally{await session.close();}
 }
 for(const [file,code] of transformFiles)await writeFile(resolve(output,file),code);
 const end={};for(const [label,source] of Object.entries(sources))end[label]=await collectSource(source.root);
 const unchanged=Object.keys(sources).every(k=>JSON.stringify(sources[k])===JSON.stringify(end[k]));
 await writeFile(resolve(output,'proof.json'),JSON.stringify({mode,sources,end,unchanged,harnessSha256:sha(await readFile(new URL(import.meta.url))),bootstrapSha256:sha(bootstrap),results,limits:'Headless Chromium SwiftShader at deviceScaleFactor 1. Draw and renderer times are CPU wall time through command submission, never GPU timer duration. Startup.prepare includes awaited resource preparation and any prewarming, and navigationReadyMs is page-clock wall time including module/network setup; startup prewarm shifts must be reported separately from steady windows. rAF intervals are native scheduling observations, not an unbounded-game FPS claim. performance.memory is browser JS heap, excluding native/GPU memory. Visual seek only runs in presentation scenes and is disabled for performance. ABBA windows are partial native animation windows after naturally awaiting authored scene age at least 7 seconds and a submitted tick at least 140, without modifying the presentation clock; window start jitter is visible in before.age/submittedAge/submittedTick; cycle observation runs for each full nominal period and recorded ages show coverage. observedMs records the actual native sampling interval. A and B differences are recorded in source hashes; this run compares the same authored scene contents when using the frozen art checkpoint and an optimization candidate.',transforms:Object.fromEntries([...transformFiles].map(([file,code])=>[file,sha(code)]))},null,2)+'\n');
 if(!unchanged)process.exitCode=1;
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack,sources,results},null,2)+'\n');process.exitCode=1;throw error;}
