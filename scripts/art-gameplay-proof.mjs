/** Real local game UI proof, without Playwright or renderer fixtures.
 * node scripts/art-gameplay-proof.mjs [--suite art|shared-units] [--port 34615] [--out docs/art/refactor/after]
 * Starts the repository dev server and a disposable Chromium profile; never contacts deployment hosts.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
const argument=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const suite=argument('--suite')??'art';
if(!['art','shared-units'].includes(suite))throw new Error(`Unknown gameplay proof suite: ${suite}`);
const port=Number(argument('--port')??34615),origin=`http://127.0.0.1:${port}`,out=resolve(argument('--out')??'docs/art/refactor/after');
const scratch=await mkdtemp('/tmp/art-gameplay-proof-');await mkdir(out,{recursive:true});
const evidence={suite,origin,startedAt:new Date().toISOString(),screenshots:[],steps:[],errors:[],commands:[],harnessAdjustments:['DOM controls invoke their native click handlers atomically; map Canvas uses CDP pointer input.','Hide pointer-lock invitation overlay after match entry (same adjustment as existing room UI proofs).','Seed a local authoritative bareDuel scenario through existing reset API after completing real map/setup/start UI.']};
let server,browser,socket,sessionId,command,read;let serverLog='';
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function until(run,label,timeout=45000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{const result=await run();if(result)return result;}catch(e){error=e;}await delay(100);}throw new Error(`${label} timed out${error?': '+error.message:''}`);}
const must=(condition,message)=>{if(!condition)throw new Error(message);};
async function api(path,body){const response=await fetch(origin+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`${path}: ${response.status} ${await response.text()}`);return response.json();}
async function screenshot(name){const {data}=await command('Page.captureScreenshot',{format:'png'},sessionId);const file=`gameplay-${name}.png`;await writeFile(resolve(out,file),Buffer.from(data,'base64'));evidence.screenshots.push(file);}
async function clickAt(x,y,button='left'){await command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y},sessionId);await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,buttons:button==='right'?2:1,clickCount:1},sessionId);await delay(60);await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button,clickCount:1},sessionId);}
async function click(selector){console.log('UI click',selector);await until(()=>read(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return false;const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;el.click();return true})()`),`click ${selector}`);}
try{
 server=spawn(process.execPath,['--import','tsx','src/server/index.ts'],{cwd:process.cwd(),env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});server.stdout.on('data',chunk=>serverLog+=chunk);server.stderr.on('data',chunk=>serverLog+=chunk);
 await until(async()=>{const response=await fetch(origin+'/api/catalog');return response.ok;},'local dev server');
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(JSON.stringify(message.error))):request.done(message.result);}}if(message.method==='Runtime.exceptionThrown')evidence.errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')evidence.errors.push(message.params.args.map(arg=>arg.value??arg.description).join(' '));if(message.method==='Network.webSocketFrameSent'){try{const payload=JSON.parse(message.params.response.payloadData);if(payload.type==='command'||payload.command)evidence.commands.push(payload);}catch{}}});
 command=(method,params={},session)=>new Promise((done,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},60000);pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'});({sessionId}=await command('Target.attachToTarget',{targetId,flatten:true}));
 for(const domain of ['Runtime','Page','Network'])await command(`${domain}.enable`,{},sessionId);
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 read=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 evidence.browser=await command('Browser.getVersion');await command('Page.navigate',{url:origin},sessionId);
 await until(()=>read(`document.readyState==='complete'`),'page module startup');await delay(500);
 await click('[data-open-create]');await click('[data-map-entries] [data-map-id="pineshade"]');await screenshot('map-selection');
 evidence.steps.push({step:'select-map',state:await read(`({url:location.href,selected:document.querySelector('[data-map-entries] [aria-pressed="true"]')?.dataset.mapId})`)});
 await click('[data-map-next]');await until(()=>read(`!!document.querySelector('[data-room-setup]')`),'room setup');
 const localId=await read(`document.querySelector('[data-room-setup]').dataset.roomSetup`);
 await click('.game-mode-switch label:has(input[value="multiplayer"])');
 const roomId=await until(()=>read(`(()=>{const id=document.querySelector('[data-room-setup]')?.dataset.roomSetup;return id&&id!==${JSON.stringify(localId)}&&new URLSearchParams(location.search).get('room')===id?id:null})()`),'authoritative room setup');evidence.roomId=roomId;
 const openSlots=await read(`[...document.querySelectorAll('[data-slot-id]')].filter(row=>row.querySelector('[data-slot-controller]')?.value==='open').map(row=>row.dataset.slotId)`);
 for(const slotId of openSlots){await read(`(()=>{const select=document.querySelector(${JSON.stringify(`[data-slot-id="${slotId}"] [data-slot-controller]`)});select.value='ai';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>read(`(()=>{const el=document.querySelector(${JSON.stringify(`[data-slot-id="${slotId}"] [data-slot-controller]`)});return el?.value==='ai'&&!el.disabled})()`),'AI slot');}
 await screenshot('room-setup');await click('[data-start-room]');
 await until(()=>read(`document.querySelector('[data-main-menu]')?.classList.contains('hidden')&&window.__sketchRtsView?.tick!==undefined`),'real match entry');
 const started=await api(`/api/rooms/${roomId}`);must(started.status==='inMatch'&&started.mapId==='pineshade','UI did not start selected map');evidence.steps.push({step:'start-match',status:started.status,mapId:started.mapId});await screenshot('started');
 if(suite==='shared-units'){
  const {runSharedUnitProof}=await import('./shared-unit-gameplay-proof.mjs');
  await runSharedUnitProof({api,origin,roomId,read,command,sessionId,click,clickAt,screenshot,until,delay,must,evidence});
 }else{
 await api(`/api/rooms/${roomId}/pause`,{});
 const fixture={replaceDefaultUnits:true,replaceDefaultResources:true,addUnits:[{id:'art-proof-soldier',owner:'player',kind:'footman',x:1200,y:960},{id:'art-proof-priest',owner:'player',kind:'priest',x:1130,y:1030},{id:'art-proof-archer',owner:'player',kind:'archer',x:1270,y:1030}],addItems:[{id:'art-proof-sword',kind:'greatSword',carrierId:'art-proof-soldier',slot:'carry0',x:1200,y:960,cooldownRemaining:0}]};
 await api(`/api/rooms/${roomId}/reset`,{mapId:'bareDuel',options:{aiPlayers:[],scenario:fixture}});await api(`/api/rooms/${roomId}/resume`,{});
 await command('Page.reload',{},sessionId);await until(()=>read(`window.__sketchRtsView?.unitIds.includes('art-proof-soldier')&&document.querySelector('[data-main-menu]')?.classList.contains('hidden')`),'fixture synchronized');
 await read(`(()=>{const gate=document.querySelector('[data-pointer-lock-gate]');if(gate){gate.classList.add('hidden');gate.style.pointerEvents='none';}})()`);
 const snapshot=await api(`/api/rooms/${roomId}/snapshot`),soldier=snapshot.units.find(unit=>unit.id==='art-proof-soldier');
 const navigate=await read(`(()=>{const frame=document.querySelector('[data-minimap-frame]'),canvas=document.querySelector('.game-canvas'),t=new DOMMatrixReadOnly(getComputedStyle(frame).transform),r=canvas.getBoundingClientRect();return{minimap:{x:r.x+t.m41+parseFloat(frame.style.width)*${soldier.x/snapshot.map.width},y:r.y+t.m42+parseFloat(frame.style.height)*${soldier.y/snapshot.map.height}},center:{x:r.x+r.width/2,y:r.y+r.height/2}}})()`);
 await clickAt(navigate.minimap.x,navigate.minimap.y);await delay(300);await clickAt(navigate.center.x,navigate.center.y);
 await until(()=>read(`window.__sketchRtsView?.focusedSelectionId==='art-proof-soldier'`),'select soldier');await screenshot('selected');
 evidence.steps.push({step:'select-unit',view:await read('window.__sketchRtsView')});
 await clickAt(navigate.center.x+110,navigate.center.y-70,'right');
 const moved=await until(async()=>{const snapshot=await api(`/api/rooms/${roomId}/snapshot`),unit=snapshot.units.find(unit=>unit.id==='art-proof-soldier');return Math.hypot(unit.x-soldier.x,unit.y-soldier.y)>30?unit:null;},'real move command');evidence.steps.push({step:'move',before:{x:soldier.x,y:soldier.y},after:{x:moved.x,y:moved.y},order:moved.order});await screenshot('moving');
 await click('[data-command-dock] [data-hotkey="I"]');await until(()=>read(`document.querySelector('.equipment-panel')?.classList.contains('open')||!!document.querySelector('.equipment-panel [data-item-id="art-proof-sword"]')`),'equipment panel');await screenshot('equipment-before');
 await click('.equipment-panel [data-item-id="art-proof-sword"]');
 const action=await read(`(()=>{const el=[...document.querySelectorAll('.equipment-action')].find(el=>/拿到主手|Main hand/.test(el.textContent));if(!el)return;const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);must(action,'main-hand equipment action missing');await clickAt(action.x,action.y);
 const wielded=await until(async()=>{const snap=await api(`/api/rooms/${roomId}/snapshot`),unit=snap.units.find(unit=>unit.id==='art-proof-soldier');return unit.hands?.right==='art-proof-sword'?unit:null;},'authoritative wieldItem');
 const clientEquipment=await until(()=>read(`(()=>{const item=document.querySelector('.equipment-panel [data-item-id="art-proof-sword"]'),hand=document.querySelector('.equipment-hand-name');if(!item||!hand||hand.textContent!==item.getAttribute('aria-label'))return;return{hand:hand.textContent,stats:document.querySelector('[data-equipment-stats]')?.textContent,tick:window.__sketchRtsView?.tick}})()`),'client equipment applies authoritative wield',60000);
 evidence.steps.push({step:'wield-via-equipment-ui',hands:wielded.hands,unitId:wielded.id,clientEquipment});await screenshot('equipment-after');await click('.equipment-close');await screenshot('weapon-world');
 evidence.finalView=await read('window.__sketchRtsView');evidence.passed=evidence.errors.length===0&&evidence.steps.some(step=>step.step==='move')&&evidence.steps.some(step=>step.step==='wield-via-equipment-ui');must(evidence.passed,'browser errors during gameplay proof');
 }
}catch(error){evidence.passed=false;evidence.failure=error.stack??String(error);if(command&&sessionId)try{await screenshot('failure');evidence.failureDom=await read('document.body.innerText');}catch{}process.exitCode=1;
}finally{
 evidence.finishedAt=new Date().toISOString();await writeFile(resolve(out,'gameplay-proof.json'),JSON.stringify(evidence,null,2)+'\n');await writeFile(resolve(out,'gameplay-server.log'),serverLog);
 socket?.close();for(const process of [browser,server])if(process&&process.exitCode===null){const exited=new Promise(done=>{process.once('exit',done);setTimeout(done,5000).unref();});process.kill();await exited;}await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 console.log(JSON.stringify({passed:evidence.passed,steps:evidence.steps.map(step=>step.step),failure:evidence.failure,report:resolve(out,'gameplay-proof.json')}));
}
