#!/usr/bin/env python3
"""Offline full-byte source/command/Git closure and complete native readback."""
import base64,datetime,gzip,hashlib,json,math,time
from pathlib import Path
OUT=Path(__file__).resolve().parent;STAGE=6 if 'stage6-' in OUT.name else 7
START=datetime.datetime.now(datetime.timezone.utc).isoformat();CLOCK=time.perf_counter()
M=json.loads((OUT/'manifest.json').read_text());INDEX={base64.b64decode(r['originalPathBase64']).decode():r for r in M['files']}
def sha(b):return hashlib.sha256(b).hexdigest()
def raw(path):
 r=INDEX[path];b=gzip.decompress((OUT/r['storedPath']).read_bytes());assert len(b)==r['originalBytes'] and sha(b)==r['originalSha256'];return b
def load(path):
 b=raw(path);return json.loads(gzip.decompress(b) if path.endswith('.gz') else b)
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
G='/tmp/whole-stage67-portable-git';GM=load(G+'/manifest.json');TREES={};ROOTS={}
for key,row in GM['trees'].items():
 b=raw(row['file']);assert oid('tree',b)==key;cursor=0;entries={}
 while cursor<len(b):
  end=b.index(b'\0',cursor);mode,name=b[cursor:end].split(b' ',1);cursor=end+1;entries[name.decode()]=(mode.decode(),b[cursor:cursor+20].hex());cursor+=20
 assert cursor==len(b);TREES[key]=entries
for head,row in GM['heads'].items():
 b=raw(row['commitFile']);assert oid('commit',b)==head;ROOTS[head]=b.splitlines()[0].split()[1].decode();assert ROOTS[head]==row['tree']
def blob(head,name):
 key=ROOTS[head];parts=name.split('/')
 for i,p in enumerate(parts):
  mode,key=TREES[key][p]
  if i==len(parts)-1:assert mode=='100644';return key
  assert mode=='40000'
SNAPSHOTS={}
for head,snapshot in GM['changedSnapshots'].items():
 for r in snapshot['files']:
  b=raw(r['snapshot']);assert len(b)==r['bytes'] and sha(b)==r['sha256'] and oid('blob',b)==r['gitBlobOid']==blob(head,r['path'])
 SNAPSHOTS[head]=len(snapshot['files'])
BASE='31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8';BAKE='863016831e25f75589e142c4560b71040902f726';CACHE='0ea5beaee063c8443d66f7654333032b070d51ad'
REF='/workspace/whole-performance-abba-49-31e4/B1';ORACLE=gzip.decompress(raw(REF+'/command-frames.jsonl.gz'));HASH='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997'
assert len(ORACLE)==618189 and sha(ORACLE)==HASH
PROBE=raw(REF+'/probe-source.ts');SOURCE=[];COMMANDS=[];FORMAL={};ALL={}
def source_check(directory,head,pins=None,original=None):
 code=load(original or directory+'/source-inputs.json.gz');expected=244 if head==BAKE else 241;assert len(code)==expected
 if pins is not None:
  assert len(pins)==len({p['path'] for p in pins})==expected;assert set(code)=={p['path'] for p in pins}
  for p in pins:
   b=code[p['path']].encode();assert len(b)==p['bytes'] and sha(b)==p['sha256']
 for name,text in code.items():
  assert oid('blob',text.encode())==blob(head,name)
  if head==BASE:assert blob(head,name)==blob('618f9f5170164aa33d1e21443e86e64fb14d38f8',name)
 SOURCE.append({'directory':directory,'head':head,'inputs':expected,'fullSourceBytesEqualAuthenticatedEmbeddedGit':True});return code
def dist(values):
 v=sorted(values);rank=lambda p:v[math.ceil(len(v)*p)-1]
 return {'count':len(v),'mean':sum(values)/len(values),'median':rank(.5),'p95':rank(.95),'p99':rank(.99),'max':v[-1],'over16':sum(x>16 for x in values),'over50':sum(x>50 for x in values)}
def equal_dist(a,b):
 assert a.keys()==b.keys()
 for k,v in a.items():assert math.isclose(v,b[k],rel_tol=1e-10,abs_tol=1e-9),(k,v,b[k])
DIRS=[('/tmp/whole-performance-abba-31-8630168','')] if STAGE==6 else [('/tmp/whole-performance-abba-31-cached-connectivity-r1','r1-'),('/tmp/whole-performance-abba-31-cached-connectivity-r2','r2-')]
for root,prefix in DIRS:
 pre=load(root+'/predeclaration.json');assert load(root+'/closure.json')['complete']
 for label in ['A1','B1','B2','A2','Bplain']:
  directory=root+'/'+label;env=load(directory+'/environment.json');summary=load(directory+'/summary.json');head=env['gitHead'];expected=BASE if label.startswith('A') else (BAKE if STAGE==6 else CACHE);assert head==expected and not env['gitStatus']
  source_check(directory,head,env['sourceInputs']);assert sha(raw(directory+'/probe-source.ts'))==env['probeSha256'] and raw(directory+'/probe-source.ts')==PROBE;assert sha(raw(directory+'/runtime.mjs'))==env['bundleSha256']
  cmd=gzip.decompress(raw(directory+'/command-frames.jsonl.gz'));assert cmd==ORACLE;frames=[json.loads(x) for x in cmd.splitlines()];assert len(frames)==14400 and sum(x['frame'] is not None for x in frames)==612 and [x['tick'] for x in frames]==list(range(14400))
  for k,v in {'ticks':14400,'finalTick':14400,'frames':14400,'nonEmptyFrames':612,'commandLogBytes':618189,'commandLogSha256':HASH,'finalChecksum':'7d94a5e8','rulesVersion':3,'checksumVersion':18,'winner':None}.items():assert summary[k]==v
  ticks=load(directory+'/ticks.json.gz');assert len(ticks)==14400 and [r['tick'] for r in ticks]==list(range(14400)) and [r['tickAfter'] for r in ticks]==list(range(1,14401))
  fields=['wholeMs','frameMs','simMs','aiMs','renderSnapshotMs','observerMs'];distributions={f:dist([r[f] for r in ticks]) for f in fields}
  for f,v in distributions.items():equal_dist(v,summary['timing'][f])
  if label=='Bplain':assert all(r['simMs']==r['aiMs']==0 and not r['ownerPlans'] for r in ticks);parts={'all':ticks}
  else:
   plan=[r for r in ticks if r['ownerPlans']];assert len(plan)==960 and all(r['mod15']==0 and len(r['ownerPlans'])==5 for r in plan);parts={'all':ticks,'planning':plan,'nonplanning':[r for r in ticks if not r['ownerPlans']]}
  label=prefix+label;ALL[label]=ticks;COMMANDS.append({'directory':directory,'bytes':len(cmd),'wholeBytesEqualFixedMap31':True,'sha256':HASH,'finalChecksum':'7d94a5e8'})
  FORMAL[label]={'distribution':{p:{f:dist([r[f] for r in rows]) for f in fields} for p,rows in parts.items()},'over50Ticks':[r for r in ticks if r['wholeMs']>50],'tick0':ticks[0],'keyTicks':{str(t):ticks[t] for t in [1859,3345,3360,5280,6990,7841,10960,11327,14072]},'maxTick':max(ticks,key=lambda r:r['wholeMs']),'minuteBlocks':[{f:dist([r[f] for r in ticks[n*1200:(n+1)*1200]]) for f in fields} for n in range(12)],'memoryOriginal':summary['memory'],'wholeTargetPassed':distributions['wholeMs']['p99']<=16 and distributions['wholeMs']['max']<=50,'plainOnlyHookTransparency':label.endswith('Bplain')}
source_check(REF,BASE,load(REF+'/environment.json')['sourceInputs']);COMMANDS.append({'directory':REF,'bytes':len(ORACLE),'wholeBytesEqualFixedMap31':True,'sha256':HASH,'finalChecksum':'7d94a5e8'})
GROUPS={arm:[k for k in ALL if k.rsplit('-',1)[-1] in [arm+'1',arm+'2']] for arm in ['A','B']}
POOLS={arm:{f:dist([r[f] for k in labels for r in ALL[k]]) for f in ['wholeMs','simMs','aiMs','renderSnapshotMs','observerMs']} for arm,labels in GROUPS.items()}
PAIRS=[{'A':prefix+'A'+n,'B':prefix+'B'+n,'meanDeltaPercent':100*(FORMAL[prefix+'B'+n]['distribution']['all']['wholeMs']['mean']/FORMAL[prefix+'A'+n]['distribution']['all']['wholeMs']['mean']-1)} for _,prefix in DIRS for n in ['1','2']]
MINUTES=[{'minute':n,'A':dist([r['wholeMs'] for k in GROUPS['A'] for r in ALL[k][1200*n:1200*(n+1)]]),'B':dist([r['wholeMs'] for k in GROUPS['B'] for r in ALL[k][1200*n:1200*(n+1)]])} for n in range(12)]
for r in MINUTES:r['meanDeltaPercent']=100*(r['B']['mean']/r['A']['mean']-1)
LOCAL={}
if STAGE==6:
 old=load('/tmp/terrain-bake-native-review-v1/review.json')
 for a in ['A','B']:
  for f in ['wholeMs','simMs','aiMs','renderSnapshotMs']:equal_dist(POOLS[a][f],old['pooled'][a][f])
 D='/tmp/terrain-bake-call-count-v13-tools';N=D+'/B-counter-native';E=load(N+'/environment.json');original=source_check(N,BAKE,original=D+'/B-original-git-source-inputs.json.gz');runtime=load(D+'/B-runtime-source-inputs.json.gz');captured=load(N+'/source-inputs.json.gz');assert runtime==captured and set(runtime)==set(original)
 assert original==runtime==captured
 changed=sorted(h['path'] for h in load(N+'/focused-diagnostics.json.gz')['hooks']);assert changed==['src/shared/terrain-bake-assets.generated.ts','src/shared/terrain-bake-codec.ts','src/shared/terrain-bake.ts','src/shared/terrain.ts']
 expectedHooks={'src/shared/terrain.ts':['v13:terrain-boundary-scalars'],'src/shared/terrain-bake.ts':['v13:bake-helper-scalars'],'src/shared/terrain-bake-codec.ts':['v13:codec-decode-scalars'],'src/shared/terrain-bake-assets.generated.ts':['v13:asset-provider-scalar']}
 hooks=load(N+'/focused-diagnostics.json.gz')['hooks'];assert len(hooks)==len({h['path'] for h in hooks})==4 and {h['path']:h['functions'] for h in hooks}==expectedHooks
 helper=raw(N+'/focused-instrumentation-source.ts');assert helper==raw(D+'/six-player-focused-instrumentation.ts') and sha(helper)==E['focusedInstrumentationSha256']
 for p in E['sourceInputs']:
  b=captured[p['path']].encode();assert len(b)==p['bytes'] and sha(b)==p['sha256']
 assert raw(N+'/probe-source.ts')==PROBE and sha(raw(N+'/runtime.mjs'))==E['bundleSha256'];assert gzip.decompress(raw(N+'/command-frames.jsonl.gz'))==ORACLE
 COMMANDS.append({'directory':N,'bytes':len(ORACLE),'wholeBytesEqualFixedMap31':True,'sha256':HASH,'finalChecksum':load(N+'/summary.json')['finalChecksum']});assert COMMANDS[-1]['finalChecksum']=='7d94a5e8'
 diag=load(N+'/focused-diagnostics.json.gz');rows=diag['scopedTicks'];assert len(rows)==33;counts=next(r['counts'] for r in rows if r['scope']=='all' and r['phase']=='whole')
 for k,v in {'createRuntimeCalls':46,'baseCreateLand':1,'baseCreateSea':1,'overlayCreate':44,'wholesCalls':4128613,'wholesHit':4128611,'wholesMiss':2,'inputSnapshotCalls':50,'currentSnapshotCalls':4,'semanticsCalls':3,'providerCalls':1}.items():assert counts[k]==v
 assert all(v==0 for r in rows if r['phase'] in ['setup','observer'] for v in r['counts'].values())
 missrows=[r for r in rows if r['scope']=='tick' and r['counts']['wholesMiss']];assert sum(r['counts']['wholesMiss'] for r in missrows)==2 and all(r['index']==0 for r in missrows)
 LOCAL['v13']={'scalarRows':len(rows),'allWholeCounters':counts,'missRows':missrows,'fourInstrumentedSourcePaths':changed,'notPerformanceAcceptance':True,'highFrequencyRuntimeRegistrationNotSupported':True,'doesNotEstablishWholeRegressionCause':True}
 C='/tmp/terrain-bake-cold-proof-v1';cold=[]
 for arm,head in [('A',BASE),('B',BAKE)]:
  d=C+'/build-'+arm;b=load(d+'/build.json');source_check(d,head,b['sourceInputs']);assert sha(raw(d+'/runtime.mjs'))==b['bundleSha256']
 for block in range(1,7):
  for position,arm in enumerate(['A','B','B','A'],1):
   label=f'{block:02d}-{position}-{arm}';d=C+'/'+label;r=load(d+'/sample.json');assert r['complete'] and r['facts']['firstTickChecksum']=='21709a99'
   for name,key in [('initial-snapshot.json','initialSnapshot'),('first-native-frame.jsonl','firstNativeFrame'),('first-tick-snapshot.json','firstTickSnapshot')]:
    b=raw(d+'/'+name);assert len(b)==r['facts'][key+'Bytes'] and sha(b)==r['facts'][key+'Sha256']
   assert raw(d+'/initial-snapshot.json')==raw(C+'/oracle-initial-snapshot.json');assert raw(d+'/first-native-frame.jsonl')==raw(C+'/oracle-first-native-frame.jsonl');cold.append({'label':label,'facts':r['facts'],'timing':r['timing'],'memory':r['memory']})
 LOCAL['cold24']={'samples':cold,'allCompleteSnapshotAndFrameBytesVerified':True,'firstTickChecksum':'21709a99'}
 x=load('/tmp/terrain-bake-validation-v1/MANIFEST.json')
 for r in x['files']:
  b=raw('/tmp/terrain-bake-validation-v1/'+r['path']);assert len(b)==r['bytes'] and sha(b)==r['sha256']
 LOCAL['originalValidationManifest']={'files':len(x['files']),'allRawShaExact':True}
else:
 combined=load('/tmp/cached-connectivity-native-review-combined-v1/review.json');replay=load('/tmp/cached-connectivity-native-review-combined-replay-v1/review.json')
 for key in ['createdUtc','analysisWallSeconds']:
  combined.pop(key,None);replay.pop(key,None)
 assert combined==replay
 for arm in ['A','B']:
  for f in POOLS[arm]:equal_dist(POOLS[arm][f],combined['pooled'][arm][f])
 assert PAIRS==combined['paired'];actual=[]
 for mode in ['none','groundWholes','shoreSpots44']:
  for suffix in ['one','two']:
   prefix='/tmp/cached-connectivity-validation-v1/proof-01/actual-'+mode+'-';a=load(prefix+'reference-'+suffix+'.json');b=load(prefix+'candidate-'+suffix+'.json');assert a.pop('name')=='reference-'+suffix and b.pop('name')=='candidate-'+suffix
   # Match the original proof's exact semantic projection. Keep raw early lazy-cache observations separately.
   af=a.pop('afterQueries');bf=b.pop('afterQueries');ar=a.pop('rawPrivateObservation');br=b.pop('rawPrivateObservation');assert a==b
   if mode=='none':assert af==bf and ar==br
   else:
    assert {k for k in af if af[k]!=bf[k]}=={'tiles','groundTiles'} and af['tiles'] is True and af['groundTiles'] is True and bf['tiles'] is False and bf['groundTiles'] is False
    assert {k for k in ar if ar[k]!=br[k]}=={'rawExactGraphSha256','groundOwnKeys','stateOwnKeys'}
    for key in ['groundOwnKeys','stateOwnKeys']:assert len(ar[key])==len(br[key]) and ar[key].count('tiles')==br[key].count('tiles')==1 and [k for k in ar[key] if k!='tiles']==[k for k in br[key] if k!='tiles']
   actual.append({'mode':mode,'instance':suffix,'allOriginalSemanticFieldsIncludingFullPostRequiredTilesFingerprintsEqual':True,'earlyAfterQueriesA':af,'earlyAfterQueriesB':bf,'earlyRawPrivateA':ar,'earlyRawPrivateB':br,'deferredPrivateTilesAreOriginalProofContract':mode!='none'})
 LOCAL['actualFullTypedSnapshots']=actual;LOCAL['combinedReplayAllSubstantiveJSONEqual']=True
RESULT={'schema':1,'complete':True,'stage':STAGE,'sourceByteClosure':SOURCE,'commandByteClosure':COMMANDS,'embeddedRawGitCommits':len(ROOTS),'embeddedRawGitTrees':len(TREES),'completeChangedGitSnapshots':SNAPSHOTS,'requiresLocalUnpublishedGitObjects':False,'formalPerRun':FORMAL,'formalPools':POOLS,'pairs':PAIRS,'minutes':MINUTES,'wholeMeanDeltaPercent':100*(POOLS['B']['wholeMs']['mean']/POOLS['A']['wholeMs']['mean']-1),'wholeTargetPassed':False,'plainExcludedFromPerformancePoolAndPlanningClassification':True,'removedOutliers':0,'localReadback':LOCAL,'limitations':['Native renderSnapshot measures state construction, not browser/GPU rendering.','13 sparse process-memory observations are not allocation rate, process peak, or leak proof.','No GC/JIT/inline cause is established.','All cold/slow/plain samples retained; exact simulation rules3/checksum18 and commands fixed.'],'execution':{'startedAt':START,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wallSeconds':time.perf_counter()-CLOCK}}
for name,value in [('analysis.json',RESULT),('local-proof.json',{'complete':True,'stage':STAGE,'localReadback':LOCAL,'execution':RESULT['execution']})]:
 p=OUT/name
 if p.exists():
  old=json.loads(p.read_text());old.pop('execution',None);new=dict(value);new.pop('execution',None);assert old==new
 else:p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'pass':True,'stage':STAGE,'sourceRuns':len(SOURCE),'sourceInputs':[r['inputs'] for r in SOURCE],'fullCommands':len(COMMANDS),'wholeMeanDeltaPercent':RESULT['wholeMeanDeltaPercent'],'wholeTargetPassed':False,'execution':RESULT['execution']}))
