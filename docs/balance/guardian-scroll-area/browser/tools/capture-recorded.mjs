import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const [beforeRoot,afterRoot,destination]=process.argv.slice(2);
if(!beforeRoot||!afterRoot||!destination)throw new Error('Expected BEFORE_ROOT AFTER_ROOT OUTPUT_DIRECTORY');
const output=resolve(destination),scratch=await mkdtemp('/workspace/guardian-webgl-');
const require=createRequire(resolve(afterRoot,'package.json'));
const {createServer}=await import(require.resolve('vite')),WebSocket=require('ws');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=['src/shared/sim.ts','src/shared/item-rules.ts','src/shared/rules-version.ts','src/sdk/scene.ts',
  'src/client/world-presentation.ts','src/client/world-renderer.ts','src/client/effect-renderer.ts','src/client/art/canvas-effects.ts',
  'src/client/world3d/projection.ts','src/client/world3d/world-layer.ts','src/client/world3d/model-library.ts','src/client/resources.ts'];
const hashes=async root=>Object.fromEntries(await Promise.all(inputs.map(async file=>[file,sha(await readFile(resolve(root,file)))])));
const html=await readFile(new URL('./page.html',import.meta.url),'utf8'),fixture=await readFile(new URL('./fixture.mjs',import.meta.url),'utf8');
await mkdir(output,{recursive:true});
let server,browser,socket,serial=0;
const pending=new Map(),errors=[],consoleMessages=[],networkFailures=[],captures=[];
try{
  browser=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${scratch}/chromium`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const stderr=[];
  const endpoint=await new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chromium timeout')),30000);browser.once('error',reject);browser.stderr.on('data',bytes=>{stderr.push(String(bytes));const match=String(bytes).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);done(match[1]);}});});
  socket=new WebSocket(endpoint);await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject);});
  socket.on('message',bytes=>{const data=JSON.parse(String(bytes));if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timeout);data.error?p.reject(new Error(JSON.stringify(data.error))):p.done(data.result);}return;}
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description??data.params.exceptionDetails.text);
    if(data.method==='Runtime.consoleAPICalled')consoleMessages.push({type:data.params.type,values:data.params.args.map(arg=>arg.value??arg.description)});
    if(data.method==='Network.loadingFailed')networkFailures.push(data.params);
  });
  const command=(method,params={},sessionId)=>new Promise((done,reject)=>{const id=++serial,timeout=setTimeout(()=>reject(new Error('CDP timeout '+method)),120000);pending.set(id,{done,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>command(method,params,sessionId);
  const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  await page('Page.enable');await page('Runtime.enable');await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  for(const [name,rootPath] of [['before',beforeRoot],['after',afterRoot]]){
    const root=resolve(rootPath),start=await hashes(root),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const trackedSourceDiffSha256=sha(execFileSync('git',['diff','HEAD','--','src'],{cwd:root}));
    const requests=[];
    const proofPlugin={name:'external-guardian-proof',configureServer(vite){vite.middlewares.use((req,res,next)=>{
      const url=req.url?.split('?')[0];
      if(url==='/guardian-proof.html'){res.setHeader('Content-Type','text/html');res.end(html);}
      else if(url==='/guardian-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);}
      else{requests.push(req.url);next();}
    });}};
    server=await createServer({root,configFile:resolve(root,'vite.config.ts'),cacheDir:resolve(scratch,`vite-${name}`),plugins:[proofPlugin],define:{'import.meta.env.VITE_SKETCH_RTS_DEPLOYMENT':JSON.stringify('static')},server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
    const url=`http://127.0.0.1:${server.httpServer.address().port}/guardian-proof.html?name=${name}`;
    await page('Page.navigate',{url});
    const report=await evaluate("new Promise((done,reject)=>{const deadline=performance.now()+90000;function check(){if(window.guardianProofReady)return window.guardianProofReady.then(done,reject);if(performance.now()>deadline)return reject(new Error('Guardian fixture timeout'));setTimeout(check,30)}check()})");
    await evaluate('document.fonts.ready');
    const shot=await page('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(shot.data,'base64');
    await writeFile(resolve(output,`${name}-1280x720.png`),bytes);
    const snapshotJson=report.snapshotJson;delete report.snapshotJson;
    await writeFile(resolve(output,`${name}-snapshot.json`),snapshotJson);
    const end=await hashes(root),sourceUnchanged=JSON.stringify(start)===JSON.stringify(end);
    const capture={name,source:root,headCommit:head,trackedSourceDiffSha256,start,end,sourceUnchanged,url,report,requests,
      png:`${name}-1280x720.png`,pngSha256:sha(bytes),snapshotSha256:sha(snapshotJson)};
    await writeFile(resolve(output,`${name}-capture.json`),JSON.stringify(capture,null,2)+'\n');captures.push(capture);
    if(!sourceUnchanged)throw new Error('Source changed during browser capture');
    console.log(JSON.stringify({name,sourceUnchanged,is3D:report.is3D,renderer:report.renderer,model:report.model,recipients:report.actors.filter(actor=>actor.protectedByScroll).map(actor=>actor.id),pngSha256:sha(bytes)}));
    await page('Page.navigate',{url:'about:blank'});await server.close();server=undefined;
  }
  const result={method:'Unmodified game Game/useItem/snapshotGame/WorldPresentation.prepare/draw; actual ground + WebGL2 + Canvas overlay, same soldiers and an unchanged native town hall; fixed tick/clock, exactly three draws per source; two 1280x720 screenshots, no simulation or performance benchmark.',browser:await command('Browser.getVersion'),harnessSha256:sha(await readFile(new URL(import.meta.url))),fixtureSha256:sha(fixture),htmlSha256:sha(html),captures,errors,consoleMessages,networkFailures};
  await writeFile(resolve(output,'capture.json'),JSON.stringify(result,null,2)+'\n');await writeFile(resolve(output,'chromium-stderr.log'),stderr.join(''));
  if(errors.length||consoleMessages.some(row=>row.type==='error'))process.exitCode=1;
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack,errors,consoleMessages,networkFailures,captures},null,2)+'\n');throw error;}
finally{for(const p of pending.values())clearTimeout(p.timeout);socket?.close();browser?.kill('SIGTERM');await server?.close();await rm(scratch,{recursive:true,force:true});}
