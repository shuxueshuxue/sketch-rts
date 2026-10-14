#!/usr/bin/env python3
"""Strict offline queue diagnostic integrity/sequence comparison; not formal timing."""
import argparse, hashlib, json, subprocess, collections, base64, gc
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('--input',default='docs/art/refactor/followup/card-streaming/stall-followup/queue-bracket-v3');p.add_argument('--out');a=p.parse_args()
root=Path(a.input).resolve();out=Path(a.out).resolve() if a.out else root/'analysis-strict-v3';out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest();encode=lambda x:json.dumps(x,sort_keys=True,separators=(',',':')).encode()
violations=[]
def check(ok,msg):
 if not ok:violations.append(msg)
reports=[];proofs={};sequences={};imageHashes={};inputs=[]
# Original fixture completion polling remains outside content draws; preserve its counts separately.
completionApis={'fenceSync','flush','clientWaitSync','deleteSync','isContextLost'}
def normalizedCalls(calls):
 ids={};counts=collections.Counter()
 def normalize(x):
  if isinstance(x,dict):return {k:normalize(v) for k,v in x.items()}
  if isinstance(x,list):return [normalize(v) for v in x]
  if isinstance(x,str) and ':' in x and x.rsplit(':',1)[1].isdigit() and x.split(':')[0].startswith(('WebGL','Float','Uint','Int')):
   if x not in ids:
    kind=x.split(':')[0];counts[kind]+=1;ids[x]=kind+':'+str(counts[kind])
   return ids[x]
  return x
 return (normalize({'api':x['api'],'rowIndex':x['rowIndex'],'n':x['expectedN'],'arguments':x['arguments'],'binding':x['observedBinding'],'rendererScope':x['rendererScope']}) for x in calls)
def localArtifact(folder,name):
 path=(folder/name).resolve()
 if not path.is_relative_to(folder.resolve()):raise ValueError('Artifact outside capture folder: '+name)
 return path
def readExport(folder,r,label):
 entries=[e for e in r['diagnostic']['boundedExports'] if e['label']==label]
 if len(entries)!=1:raise ValueError('Missing/duplicate export '+label)
 e=entries[0];header=json.loads(localArtifact(folder,label+'.export-header.json').read_bytes())
 check(all(e.get(k)==v for k,v in header.items()),label+' header agrees with raw')
 check(e['file']==label+'.json' and e['sliceCharacters']==1048576 and e['afterCycleMeasurements'] is True,label+' export protocol')
 data=localArtifact(folder,e['file']).read_bytes()
 check(len(data)==header['bytes'] and sha(data)==header['sha256'],label+' complete UTF8 bytes/SHA')
 text=data.decode('utf-8');del data
 characters=len(text.encode('utf-16-le'))//2
 check(characters==header['characters'] and e['chunks']==(characters+1048575)//1048576,label+' UTF16 character/chunk count')
 value=json.loads(text);del text
 check(header['rows']==(len(value['rows']) if 'rows' in value else None),label+' full row count')
 check(header['glCalls']==(len(value['glSequenceCalls']) if 'glSequenceCalls' in value else None),label+' full GL count')
 return value,header
for strategy in ['control','pre','pre-post']:
 folder=root/strategy;raw=(folder/'raw.json').read_bytes();r=json.loads(raw);proofs[strategy]=r;inputs.append({'strategy':strategy,'rawSha256':sha(raw)})
 inv=r['diagnostic']['sourceInventory'];commit=inv['expectedCommit'];check(r['sourceCommit']==commit and commit.startswith('42bd'),strategy+' commit')
 check(r['completed'] and r['validation']['passed'] and not r['errors'] and not r['failed'],strategy+' completed')
 check(inv['sourceStayedFrozen'] and inv['helpersStayedFrozen'] and inv['sourceSha256']==inv['finalSourceSha256'],strategy+' frozen sources')
 tree=subprocess.check_output(['git','ls-tree','-r',commit,'src'],text=True);blobs={line.split('\t',1)[1]:line.split()[2] for line in tree.splitlines()}
 check(set(blobs)==set(inv['sourceSha256']),strategy+' complete Git source set')
 check(inv['gitSourceBlobSha1']==blobs,strategy+' captured Git blob guard')
 check(r['diagnostic']['boundedJSONExport'] is True and r['diagnostic']['fullGLSequenceStoredAsSeparateCompleteArtifact'] is True,strategy+' v3 artifact protocol')
 check(sorted(e['label'] for e in r['diagnostic']['boundedExports'])==['cycle-0-profile','cycle-0-result','cycle-1-profile','cycle-1-result'],strategy+' exact exports')
 archived={}
 for e in inv['sourceSnapshots']+inv['helperSnapshots']:
  data=(folder/e['snapshot']).read_bytes();h=sha(data);archived[e['path']]=h;check(h==e['sha256'],strategy+' archived '+e['snapshot'])
  if e.get('relativePath'):
   file=e['relativePath'];check(hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==blobs[file] and inv['sourceSha256'][file]==h,strategy+' Git '+file)
 for file,h in {'harness.mjs':r['harnessSha256'],'profiler.js':r['diagnostic']['profilerSha256'],'source-freeze.mjs':r['diagnostic']['sourceFreezeHelperSha256'],'entry.html':r['diagnostic']['entryHtmlSha256']}.items():check(sha((folder/file).read_bytes())==h,strategy+' '+file)
 for e in inv['loadedModules']:
  expected=archived.get(e['path'])
  if expected is None and e['path'].endswith('/queue-profiler.js'):expected=r['diagnostic']['profilerSha256']
  check(e['frozenRunStartBytes'] and expected==e['sha256'],strategy+' loaded '+e['path'])
 check(all(x['unchangedAtFinish'] for x in inv['thirdPartyModules']),strategy+' thirdparty')
 dep=inv['dependencyPreparation'];check(dep['stayedStable'] and {k:v for k,v in dep['startup'].items() if k!='label'}=={k:v for k,v in dep['finish'].items() if k!='label'},strategy+' prebundle metadata')
 check(dep['startupWait']['polls']>=0 and dep['startupWait']['waitMs']>=0,strategy+' startup wait recorded')
 for phase in [dep['startup'],dep['finish']]:
  check(phase['optimizationComplete'] and not phase['discovered'] and sorted(x['name'] for x in phase['entries'])==sorted(dep['include']),strategy+' optimized entries')
  for e in phase['entries']+phase['chunks']:
   data=(folder/e['snapshot']).read_bytes();check(len(data)==e['bytes'] and sha(data)==e['sha256'],strategy+' optimized bundle')
 check(inv['sameContextThreeResolvedIds']==[next(x['resolvedId'] for x in dep['startup']['entries'] if x['name']=='three')],strategy+' Three query identity')
 check(bool(inv['moduleGraph']),strategy+' module graph')
 check(inv['sourcePublicTree']==subprocess.check_output(['git','rev-parse',commit+':public'],text=True).strip(),strategy+' immutable public tree')
 check(len(r['cycles'])==2 and r['cpuFrames']==60 and r['realFrames']==12,strategy+' cycle/sample header')
 for c in r['cycles']:
  tag=strategy+'/'+str(c['cycle']);lp=c['latencyProfile'];q=c['queueBracket']
  exportedResult,resultHeader=readExport(folder,r,'cycle-'+str(c['cycle'])+'-result')
  added={'latencyProfile','pixelProofSha256','heapAfterGc'}
  check(set(c)==set(exportedResult)|added,tag+' raw result transformation keys')
  check({k:v for k,v in exportedResult.items() if k!='screenshots'}=={k:v for k,v in c.items() if k not in added|{'screenshots'}},tag+' complete result export equals raw')
  for name,dataurl in exportedResult['screenshots'].items():
   encoded=base64.b64decode(dataurl.split(',',1)[1],validate=True)
   check(name in c['screenshots'] and sha(encoded)==c['screenshots'][name]['sha256'],tag+' exported screenshot '+name)
  del exportedResult
  fullProfile,profileHeader=readExport(folder,r,'cycle-'+str(c['cycle'])+'-profile')
  calls=fullProfile.pop('glSequenceCalls');artifact=lp['glSequenceCallsArtifact']
  check({k:v for k,v in lp.items() if k!='glSequenceCallsArtifact'}==fullProfile,tag+' complete profile nonGL equals raw')
  check(artifact=={'file':'cycle-'+str(c['cycle'])+'-profile.json','jsonPointer':'/glSequenceCalls','sha256':profileHeader['sha256'],'bytes':profileHeader['bytes'],'calls':len(calls),'completeUnfiltered':True},tag+' full GL artifact pointer and hash')
  del fullProfile
  rows=lp['rows'];check(len(rows)==152 and lp['scheduleValidation']['allExpectedRows'] and not lp['scheduleValidation']['mismatches'],tag+' all rows')
  check(c['cpu']['sampleTicks']==[n//3 for n in range(114,174)] and len(c['cpu']['valuesMs'])==60 and len(c['real']['completeWallValuesMs'])==12,tag+' sample grid')
  for row in rows:
   if row['phase'] in ['cpu-warmup','cpu-sample']:check(not row['before']['rendererRenderHookActive'] and not row['calls'].get('renderer.render',{}).get('calls'),tag+' render noop')
   if row['expectedN'] is not None:check(abs(row['now']-row['expectedN']*1000/60)<1e-5 and row['tick']==row['expectedN']//3,tag+' row clock')
  check([x['sequence'] for x in calls]==list(range(1,len(calls)+1)),tag+' GL sequence continuous')
  observer=[x for x in calls if x['observerDomain'] is not None]
  completion=[x for x in calls if x['observerDomain'] is None and x['rowIndex'] is None and x['api'] in completionApis]
  content=[x for x in calls if x['observerDomain'] is None and not(x['rowIndex'] is None and x['api'] in completionApis)]
  sequenceDigest=hashlib.sha256();rowDigests={}
  for entry in normalizedCalls(content):
   encoded=encode(entry)+b'\n';sequenceDigest.update(encoded)
   key=str(entry['rowIndex']);rowDigests.setdefault(key,hashlib.sha256()).update(encoded)
  sequenceSummary={'calls':len(content),'sha256':sequenceDigest.hexdigest(),'rowSha256':{k:v.hexdigest() for k,v in rowDigests.items()}}
  sequences[(strategy,c['cycle'])]=sequenceSummary
  drains=q['drains'];expectedPhases={'control':[],'pre':['pre'],'pre-post':['pre','post']}[strategy]
  check([x['phase'] for x in drains]==expectedPhases and all(x['n']==135 and not x.get('error') and x['polls'][-1]['status'] in [37146,37148] for x in drains),tag+' bracket completion')
  timing=next(x for x in q['cpuFrameTimings'] if x['n']==135);check(abs(timing['elapsedMs']-c['cpu']['valuesMs'][21])<1e-5,tag+' draw timer')
  start=drains[0]['started'] if drains else timing['started'];end=drains[-1]['ended'] if strategy=='pre-post' else timing['ended']
  row135=next(x for x in rows if x['expectedN']==135)
  apiSummary={}
  for call in content:
   bucket=apiSummary.setdefault(call['api'],{'calls':0,'inclusiveMs':0,'maxMs':0,'roiTexels':0,'unknownRoiCalls':0})
   bucket['calls']+=1;bucket['inclusiveMs']+=call['elapsedMs'];bucket['maxMs']=max(bucket['maxMs'],call['elapsedMs'])
   if call['api'] in ['texSubImage2D','texSubImage3D','copyTexSubImage2D','copyTexSubImage3D']:
    args=call['arguments']
    if args.get('width') is not None and args.get('height') is not None:bucket['roiTexels']+=args['width']*args['height']*args.get('depth',1)
    else:bucket['unknownRoiCalls']+=1
  n135calls=[x for x in content if x['expectedN']==135]
  n135long=sorted(n135calls,key=lambda x:x['elapsedMs'],reverse=True)[:12]
  # Capture only a compact surrounding sequence; full original calls remain in the verified artifact.
  windows=[]
  for call in n135long[:3]:
   i=call['sequence']-1
   windows.append({'centerSequence':call['sequence'],'calls':calls[max(0,i-20):i+6]})
  for name,e in c['screenshots'].items():
   data=(folder/e['path']).read_bytes();check(sha(data)==e['sha256'],tag+' PNG SHA')
   with Image.open(folder/e['path']) as im:imageHashes[(strategy,c['cycle'],name)]=(im.size,sha(im.convert('RGBA').tobytes()))
  reports.append({'strategy':strategy,'cycle':c['cycle'],'allRows':rows,'cpuValuesMs':c['cpu']['valuesMs'],'real':c['real'],'bracket':q,'preMs':next((x['totalWallMs'] for x in drains if x['phase']=='pre'),0),'drawMs':timing['elapsedMs'],'postMs':next((x['totalWallMs'] for x in drains if x['phase']=='post'),0),'inclusiveCombinedMs':end-start,'pureGpuMs':None,'n135':row135,'n135LongGlCalls':n135long,'n135SequenceWindows':windows,'apiSummary':apiSummary,'roiScope':'ROI texels from actual call scalar dimensions; not exposed buffer-view bytes, transfer bytes, or independently measured GPU execution. Format/type were not captured for texSubImage overloads.','contentCallCount':len(content),'contentSequenceSha256':sequenceSummary['sha256'],'contentRowSha256':sequenceSummary['rowSha256'],'observerCounts':dict(collections.Counter(x['api'] for x in observer)),'originalCompletionCounts':dict(collections.Counter(x['api'] for x in completion)),'resources':{k:c[k] for k in ['before','empty','returned']}})
  del calls,observer,completion,content
  gc.collect() # Analyzer memory only; no renderer or capture is running.
for strategy,r in proofs.items():
 base=proofs['control'];check(r['diagnostic']['sourceInventory']['sourceSha256']==base['diagnostic']['sourceInventory']['sourceSha256'],strategy+' cross source')
 for key in ['harnessSha256','factFixtureSha256','variantHelperSha256','viewportMetadataSha256','entryFixtureSha256']:check(r[key]==base[key],strategy+' helper '+key)
 for c,o in zip(r['cycles'],base['cycles']):
  tag=strategy+'/'+str(c['cycle']);check(c['pixelProof']==o['pixelProof'] and c['pixelProofSha256']==o['pixelProofSha256'],tag+' raw facts')
  check(c['latencyProfile']['snapshots']==o['latencyProfile']['snapshots'],tag+' snapshot sequence')
  current=sequences[(strategy,c['cycle'])];reference=sequences[('control',c['cycle'])]
  mismatch=[k for k in set(current['rowSha256'])|set(reference['rowSha256']) if current['rowSha256'].get(k)!=reference['rowSha256'].get(k)]
  check(current==reference,tag+' content GL sequence differs in rows '+str(mismatch))
  check(set(c['screenshots'])==set(o['screenshots']),tag+' screenshot set')
  for name in o['screenshots']:check(imageHashes[(strategy,c['cycle'],name)]==imageHashes[('control',c['cycle'],name)],tag+' RGBA '+name)
result={'passed':not violations,'violations':violations,'inputs':inputs,'analyzerSha256':sha(Path(__file__).read_bytes()),'reports':reports,'scope':'Perturbed queue diagnosis, not formal timing. Combined is end-to-start envelope, not additive nested timers or pure GPU time. Excludes explicitly tagged observer calls from content comparison; original out-of-row completion polling is reported separately. Typed-resource WeakIDs are deterministically canonicalized by first occurrence within content stream. Trace flow analysis is separate; cgroup run-level deltas are background only. Every v3 external profile JSON is checked against its browser UTF8 SHA, character/chunk count, exported header and complete raw nonGL profile; all GL calls are retained and compared in sequence after explicit observer/poll separation. Failed v1/v2 captures are excluded, not repaired. Captured source/optimized bundle provenance does not imply transformed production JS was archived. WaitForToken staging-reclaim paths in matching Chromium source establish a possible mechanism, not an observed call stack or unique causal attribution in this capture.'}
(out/'analysis.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'violations':violations,'out':str(out)}));raise SystemExit(0 if not violations else 1)
