/** Offline companion audit. Never rewrites the original failed capture. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const arg=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const directory=resolve(arg('--run')??'docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1');
const output=resolve(arg('--out')??resolve(directory,'runtime-http-companion-audit.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const [proofBytes,httpBytes,toolBytes]=await Promise.all(['proof.json','runtime-http-scripts.json'].map(name=>readFile(resolve(directory,name))).concat(readFile(new URL(import.meta.url))));
const proof=JSON.parse(proofBytes),http=JSON.parse(httpBytes),source=proof.sourceInventory;
const audit={version:1,method:'Companion offline mapping audit of already captured HTTP transformed JS bodies. Original run EXIT1, raw proof, six gaps, collector and runtime metadata remain unchanged. Only explicit graph JSON-module dependency + captured literal import + exact same-origin ?import response body can bridge a bare JSON graph ID.',originalProof:{file:'proof.json',sha256:hash(proofBytes),completed:proof.completed,failure:proof.failure,browserTeardownComplete:proof.browserTeardownComplete},originalHttpMetadata:{file:'runtime-http-scripts.json',sha256:hash(httpBytes),passed:http.passed,gaps:http.coverageGaps},toolSha256:hash(toolBytes),bodyChecks:[],coverage:[],literalEdges:[],violations:[],passed:false};
const fail=message=>audit.violations.push(message),origin=http.documentOrigins?.length===1?http.documentOrigins[0]:null;
if(!origin)fail('Exactly one actual document origin is required');
if(!proof.failure?.includes('Runtime HTTP Script coverage failed with 6 gap(s)'))fail('Original failure is not the expected preserved mapping failure');
if(proof.completed||!proof.browserTeardownComplete)fail('Original capture status differs');
if(http.coverageGaps.length!==6||http.scripts.length!==199||http.inventoryCoverage.length!==388)fail('Actual 199-body / 388-inventory / six-gap guards differ');
function identity(input,fallbackQuery=''){
 if(!input)return null;let path,query;const value=String(input).replaceAll('\\','/').split('#')[0];
 if(/^https?:\/\//.test(value)){const u=new URL(value);path=u.pathname;query=u.search.slice(1);}else{const at=value.indexOf('?');path=at<0?value:value.slice(0,at);query=at<0?fallbackQuery:value.slice(at+1);}
 try{path=decodeURIComponent(path);}catch{return null;}
 if(path.startsWith('/@fs/'))path=path.slice(4);else if(path.startsWith('/src/'))path=sourceRoot+path;else if(path.startsWith('src/'))path=sourceRoot+'/'+path;else if(path.startsWith('/scripts/'))path=harnessRoot+path;
 const params=new URLSearchParams(query);params.delete('t');params.sort();return{path,query:params.toString(),key:path+'?'+params.toString()};
}
const sourceRoot=proof.sourceRoot,harnessRoot=proof.harnessRoot,rows=http.scripts,byRequest=new Map(rows.map(row=>[row.requestId,row])),byUrl=new Map(),byKey=new Map(),texts=new Map();
for(const row of rows){
 if(!row.body||!row.response||row.bodyError||row.loadingFailed){fail('Incomplete actual response '+row.requestId);continue;}
 const bytes=await readFile(resolve(directory,row.body.file));const exact=bytes.length===row.body.bytes&&hash(bytes)===row.body.sha256;
 audit.bodyChecks.push({requestId:row.requestId,url:row.response.url,file:row.body.file,bytes:bytes.length,sha256:hash(bytes),exact});if(!exact)fail('Captured body SHA/size differs '+row.requestId);
 const url=new URL(row.response.url);if(url.origin!==origin)fail('Script origin differs '+row.response.url);if(row.response.status!==200)fail('Actual script status differs '+row.response.url);
 if(byUrl.has(url.href))fail('Duplicate complete Script URL needs explicit disambiguation '+url.href);byUrl.set(url.href,row);
 const key=identity(row.response.url)?.key;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(row);texts.set(row.requestId,bytes.toString('utf8'));
}
const graph=source.moduleGraph;
// An ?import bridge is admitted only when the actual importer JS says so and
// the frozen module graph has that exact normalized dependency. No query is
// globally deleted, nor is a bare JSON response guessed to be its JS module.
for(const importer of rows){
 const text=texts.get(importer.requestId);if(!text)continue;
 for(const match of text.matchAll(/^\s*import\s+[^\n]*?\sfrom\s+["']([^"']+)["'];?\s*$/gm)){
  const literal=match[1],targetUrl=new URL(literal,importer.response.url);if(targetUrl.origin!==origin||targetUrl.search!=='?import'||!targetUrl.pathname.endsWith('.json'))continue;
  const targetResponse=byUrl.get(targetUrl.href);if(!targetResponse)continue;
  const actual=identity(targetUrl.href),bare=actual.path+'?',importerKey=identity(importer.response.url)?.key;
  const importerNodes=graph.filter(node=>[node.id,node.url].some(value=>identity(value)?.key===importerKey));
  const targetNodes=graph.filter(node=>[node.id,node.url].some(value=>identity(value)?.key===bare));
  const linked=importerNodes.some(node=>node.dependencies.some(id=>targetNodes.some(target=>target.id===id)));
  if(!linked)continue;
  audit.literalEdges.push({bareGraphKey:bare,targetGraphIds:targetNodes.map(node=>node.id),importerGraphIds:importerNodes.map(node=>node.id),importerRequestId:importer.requestId,importerUrl:importer.response.url,importerBodySha256:importer.body.sha256,literalImport:literal,completeTargetUrl:targetUrl.href,targetRequestId:targetResponse.requestId,targetBodySha256:targetResponse.body.sha256,targetBytes:targetResponse.body.bytes,exactSameOrigin:true,actualGraphDependency:true,queryPreserved:true});
 }
}
const snapshots=new Set((source.helperSnapshots??[]).map(row=>identity(row.path)?.path));
const relevant=row=>row.kind==='production-source'||[row.path,row.id,row.url].some(value=>{const path=identity(value)?.path;return path&&(path.startsWith(sourceRoot+'/src/')||path.startsWith(harnessRoot+'/scripts/')||snapshots.has(path));});
const inventory=[];for(const [collection,list]of [['loadedModules',source.loadedModules],['moduleGraph',graph]])list.forEach((row,index)=>{if(relevant(row))inventory.push({collection,index,row});});
if(inventory.length!==388)fail('Recomputed relevant inventory is not 388');
for(const {collection,index,row}of inventory){
 const main=identity(row.id??row.url??row.path),aliases=new Set([row.id,row.url,row.path].map(value=>identity(value,main?.query??'')?.key).filter(Boolean));
 if(collection==='loadedModules')for(const node of graph)if(identity(node.id)?.key===main?.key){const key=identity(node.url,main?.query??'')?.key;if(key)aliases.add(key);}
 const direct=[...aliases].flatMap(key=>byKey.get(key)??[]),edges=audit.literalEdges.filter(edge=>aliases.has(edge.bareGraphKey));
 const responses=[...new Map([...direct,...edges.map(edge=>byRequest.get(edge.targetRequestId))].map(response=>[response.requestId,response])).values()];
 const record={collection,index,id:row.id??null,url:row.url??null,keys:[...aliases],responses:responses.map(response=>({requestId:response.requestId,url:response.response.url,file:response.body.file,sha256:response.body.sha256,bytes:response.body.bytes})),mapping:direct.length?'direct-exact-route-with-original-timestamp-policy':edges.length?'actual-literal-import-plus-graph-json-transform-edge':null,edges};
 audit.coverage.push(record);if(!responses.length)fail('Inventory entry has no actual captured body '+collection+'/'+index);
 const original=http.inventoryCoverage.find(previous=>previous.collection===collection&&previous.index===index);if(!original)fail('Original coverage inventory entry missing '+collection+'/'+index);
 else if(original.responses.length&&!direct.some(response=>original.responses.some(before=>before.requestId===response.requestId&&before.sha256===response.body.sha256&&before.url===response.response.url)))fail('Previously covered exact route failed independent recheck '+collection+'/'+index);
}
const corrected=audit.coverage.filter(row=>row.mapping==='actual-literal-import-plus-graph-json-transform-edge');if(corrected.length!==6)fail('Expected exactly six explicitly bridged inventory entries');
if(http.coverageGaps.some(gap=>!corrected.some(row=>row.collection===gap.collection&&row.index===gap.index)))fail('Original gap remains unresolved by exact evidence');
audit.summary={bodyChecks:audit.bodyChecks.length,recomputedInventoryEntries:audit.coverage.length,coveredInventoryEntries:audit.coverage.filter(row=>row.responses.length).length,correctedOriginalEntries:corrected.length,literalEdges:audit.literalEdges.length,originalExit1Retained:true};audit.passed=!audit.violations.length;
await writeFile(output,JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,passed:audit.passed,summary:audit.summary,violations:audit.violations},null,2));if(!audit.passed)process.exitCode=1;
