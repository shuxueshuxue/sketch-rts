/** node --import tsx scripts/unit-sheet-proof.mjs [--out path.json] */
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import WebSocket from 'ws';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const output=resolve(arg('--out')??'docs/art/refactor/followup/ui-portrait-resources/unit-sheet-proof.json');await mkdir(dirname(output),{recursive:true});const scratch=await mkdtemp('/tmp/unit-sheet-proof-');
let server,browser,socket;const errors=[];
try{
 server=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
 browser=spawn(process.env.CHROMIUM_PATH??'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium startup timeout')),30000);browser.once('error',reject);browser.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
 socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});let serial=0;const pending=new Map();
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timeout);message.error?request.reject(message.error):request.done(message.result);}}if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(arg=>arg.value??arg.description).join(' '));if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
 const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),90000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});await command('Runtime.enable',{},sessionId);await command('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/unit-sheet.html`},sessionId);
 const result=await command('Runtime.evaluate',{expression:`(async()=>{
 await new Promise((resolve,reject)=>{const until=performance.now()+30000;function check(){if(document.body.dataset.ready==='true')resolve();else if(performance.now()>until)reject(new Error('Sheet timeout'));else setTimeout(check,20);}check();});
 const [{drawAtlasUnit},{appearanceForKind},{unitGlyphScale},{UNIT_DEFS}]=await Promise.all([import('/src/client/atlas-art.ts'),import('/src/client/art/unit-appearance.ts'),import('/src/client/glyphs.ts'),import('/src/shared/catalog.ts')]);
 const proof=document.createElement('canvas');proof.width=640;proof.height=640;const out=proof.getContext('2d');out.fillStyle='#e8e2c8';out.fillRect(0,0,640,640);out.font='18px sans-serif';out.fillStyle='#2f4a3c';out.fillText('Actual unit-sheet.html · shared caster outfits',16,28);
 const report=[];let index=0;
 const data=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 const diff=(a,b)=>{let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])count++;return count;};
 for(const [race,title,color] of [['grove','Grove Kin','#387d72'],['ember','Ember Pact','#a85644']])for(const kind of ['priest','summoner']){
  const section=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.includes(title));
  const card=[...section.querySelectorAll('figure')].find(f=>f.querySelector('figcaption span')?.textContent===kind),actual=card.querySelector('canvas');
  const expected=document.createElement('canvas');expected.width=300;expected.height=280;const b=expected.getContext('2d');b.scale(2,2);
  drawAtlasUnit(b,kind,{x:75,y:140*.66},Math.min(1.75,unitGlyphScale(UNIT_DEFS[kind].radius)*1.25),color,1,undefined,appearanceForKind(kind,race));
  const raw=data(actual),differencePixels=diff(raw,data(expected));
  let defaultOutfitDifferencePixels=0;if(race==='ember'){b.clearRect(0,0,150,140);drawAtlasUnit(b,kind,{x:75,y:140*.66},Math.min(1.75,unitGlyphScale(UNIT_DEFS[kind].radius)*1.25),color);defaultOutfitDifferencePixels=diff(raw,data(expected));}
  report.push({race,kind,differencePixels,defaultOutfitDifferencePixels});
  const x=16+(index%2)*310,y=45+Math.floor(index/2)*295;out.drawImage(actual,x,y);out.fillStyle='#2f4a3c';out.fillText(race+' / '+kind,x+12,y+282);index++;
 }
 return{report,obsoleteCaption:document.body.textContent.includes('薪火召唤者'),image:proof.toDataURL('image/png'),method:'Actual dev unit-sheet page DOM canvases versus same renderer with explicit race; Ember also compared with omitted-race regression input. Screenshot copies the four actual DOM canvases.'};
 })()`,awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
 const proof=result.result.value;await writeFile(output.replace(/\.json$/,'.png'),Buffer.from(proof.image.split(',')[1],'base64'));delete proof.image;
 const evidence={...proof,errors,passed:errors.length===0&&!proof.obsoleteCaption&&proof.report.every(row=>row.differencePixels===0&&(row.race!=='ember'||row.defaultOutfitDifferencePixels>0)),browser:await command('Browser.getVersion')};await writeFile(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1;

}finally{socket?.close();if(browser&&browser.exitCode===null){const exited=new Promise(done=>{browser.once('exit',done);setTimeout(done,5000).unref();});browser.kill();await exited;}await server?.close();await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
