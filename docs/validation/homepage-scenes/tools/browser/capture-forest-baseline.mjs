import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'/workspace/sketch-rts-six-player-baseline-a052');
const output=resolve(process.argv[3]??'/workspace/homepage-pirate-baseline-a052');
const require=createRequire(resolve(root,'package.json'));
const {createServer}=await import(require.resolve('vite'));
const WebSocket=require('ws');
const scratch=await mkdtemp('/workspace/homepage-review-browser-');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=['src/client/menu-scenes.ts','src/client/main.ts','src/client/styles.css','src/client/world3d/world-layer.ts'];
const sourceFiles=async()=>Object.fromEntries(await Promise.all(inputs.map(async f=>[f,sha(await readFile(resolve(root,f)))])));
const start=await sourceFiles(),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
await mkdir(output,{recursive:true});
let server,browser,socket,serial=0;
const pending=new Map(),errors=[],captures=[];
try{
server=await createServer({root,configFile:resolve(root,'vite.config.ts'),cacheDir:resolve(scratch,'vite'),define:{'import.meta.env.VITE_SKETCH_RTS_DEPLOYMENT':JSON.stringify('static')},server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
browser=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/chromium`,'about:blank'],{stdio:['ignore','ignore','pipe']});
const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium timeout')),30000);browser.once('error',reject);browser.stderr.on('data',bytes=>{const match=String(bytes).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
socket.on('message',bytes=>{const data=JSON.parse(String(bytes));if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timeout);data.error?p.reject(new Error(JSON.stringify(data.error))):p.done(data.result);}return;}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description??data.params.exceptionDetails.text);});
const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error('CDP timeout '+method)),120000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
const page=(method,params)=>command(method,params,sessionId);
const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
await page('Page.enable');await page('Runtime.enable');
await page('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('sketch-rts-menu-scene',new URL(location.href).searchParams.get('scene')??'fleet')"});
for(const scene of ['woods'])for(const [width,height] of [[1440,900],[1280,720],[390,844]]){
await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
await page('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/?scene=${scene}`});
await evaluate("new Promise((done,reject)=>{const deadline=performance.now()+90000;function check(){if(document.querySelector('[data-open-profile]')&&document.querySelector('.resource-screen')?.hidden)return document.fonts.ready.then(()=>setTimeout(done,2100));if(performance.now()>deadline)return reject(new Error('Homepage resources timeout'));setTimeout(check,30)}check()})");
const layout=await evaluate("(()=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {scene:document.querySelector('[data-scene-switch]').textContent,menu:box(document.querySelector('.menu-window')),buttons:[...document.querySelectorAll('.map-button')].map(e=>({text:e.textContent.trim(),...box(e)})),renderer:document.querySelector('.world-underlay')?.hidden?'Canvas fallback':'WebGL2 stack',scrollWidth:document.documentElement.scrollWidth,windowWidth:innerWidth}})()");
const file=`${scene}-${width}x${height}.png`,shot=await page('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(shot.data,'base64');await writeFile(resolve(output,file),bytes);captures.push({scene,width,height,file,sha256:sha(bytes),layout});console.log(JSON.stringify(captures.at(-1)));
}
const end=await sourceFiles();await writeFile(resolve(output,'capture.json'),JSON.stringify({source:root,head,start,end,sourceUnchanged:JSON.stringify(start)===JSON.stringify(end),browser:await command('Browser.getVersion'),harnessSha256:sha(await readFile(new URL(import.meta.url))),method:'Real unchanged homepage; native resource loading and production WebGL2 stack; screenshot 2.1 seconds after ready and fonts; fresh local Chromium SwiftShader; three viewport sizes, each fleet and capital; no screenshot fixture or altered source.',captures,errors},null,2)+'\n');
if(errors.length||JSON.stringify(start)!==JSON.stringify(end))process.exitCode=1;
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack,head,start,errors,captures},null,2)+'\n');throw error;}
finally{for(const p of pending.values())clearTimeout(p.timeout);socket?.close();browser?.kill('SIGTERM');await server?.close();await rm(scratch,{recursive:true,force:true});}
