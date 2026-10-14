#!/usr/bin/env python3
"""Verify captured source against embedded Git objects and recompute formal costs."""
import base64,datetime,gzip,hashlib,json,math,time
from pathlib import Path

OUT=Path(__file__).resolve().parent
BASE='31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8'
CAND='48e3d447e4640bdabbbb32ccc4348da3a40d6789'
SHA='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997'
began=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.perf_counter()
manifest=json.loads((OUT/'manifest.json').read_text())
lookup={base64.b64decode(r['originalPathBase64']).decode():r for r in manifest['files']}
def raw(path):
 r=lookup[path];b=gzip.decompress((OUT/r['storedPath']).read_bytes())
 assert len(b)==r['originalBytes'] and hashlib.sha256(b).hexdigest()==r['originalSha256'];return b
def load(path):
 b=raw(path);return json.loads(gzip.decompress(b) if path.endswith('.gz') else b)
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
G='/workspace/whole-stage5-integer-portable-git-objects'
gitmeta=load(G+'/manifest.json');trees={}
for key,row in gitmeta['trees'].items():
 b=raw(row['file']);assert oid('tree',b)==key;cursor=0;entries={}
 while cursor<len(b):
  end=b.index(b'\0',cursor);mode,name=b[cursor:end].split(b' ',1);cursor=end+1
  entries[name.decode()]=(mode.decode(),b[cursor:cursor+20].hex());cursor+=20
 assert cursor==len(b);trees[key]=entries
roots={}
for head in [BASE,CAND]:
 b=raw(gitmeta['heads'][head]['commitFile']);assert oid('commit',b)==head
 roots[head]=b.splitlines()[0].split()[1].decode();assert roots[head]==gitmeta['heads'][head]['tree']
def blob_oid(head,path):
 tree=roots[head];parts=path.split('/')
 for i,part in enumerate(parts):
  mode,key=trees[tree][part]
  if i==len(parts)-1:assert mode=='100644';return key
  assert mode=='40000';tree=key
sources=[];commands=[];formal={};all_ticks={}
F='/workspace/whole-performance-abba-31-48e3d4'
directories=[F+'/'+x for x in ['A1','B1','B2','A2','Bplain']]+['/workspace/whole-performance-map31-cpu-v11-first','/workspace/whole-performance-abba-49-31e4/B1','/workspace/whole-performance-diagnostics-v12/A-native','/workspace/whole-performance-diagnostics-v12/B-native']
oracle=gzip.decompress(raw('/workspace/whole-performance-abba-49-31e4/B1/command-frames.jsonl.gz'))
assert len(oracle)==618189 and hashlib.sha256(oracle).hexdigest()==SHA
for directory in directories:
 env=load(directory+'/environment.json');summary=load(directory+'/summary.json');head=env['gitHead'];assert head in roots
 code={p:v.encode() for p,v in load(directory+'/source-inputs.json.gz').items()};expected=241 if head==BASE else 243
 pins=env['sourceInputs'];assert len(code)==len(pins)==len({p['path'] for p in pins})==expected
 for p in pins:
  b=code[p['path']];assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256']
  assert oid('blob',b)==blob_oid(head,p['path'])
 assert hashlib.sha256(raw(directory+'/probe-source.ts')).hexdigest()==env['probeSha256']
 assert hashlib.sha256(raw(directory+'/runtime.mjs')).hexdigest()==env['bundleSha256']
 stream=gzip.decompress(raw(directory+'/command-frames.jsonl.gz'));assert stream==oracle
 frames=[json.loads(x) for x in stream.splitlines()];assert len(frames)==14400 and sum(x['frame'] is not None for x in frames)==612
 assert [x['tick'] for x in frames]==list(range(14400))
 for key,value in {'ticks':14400,'finalTick':14400,'frames':14400,'nonEmptyFrames':612,'commandLogBytes':618189,'commandLogSha256':SHA,'finalChecksum':'7d94a5e8','rulesVersion':3,'checksumVersion':18}.items():assert summary[key]==value
 sources.append({'directory':directory,'head':head,'sourceInputs':expected,'allFullSourceBlobsEqualAuthenticatedEmbeddedGitTree':True})
 commands.append({'directory':directory,'bytes':618189,'fullBytesEqualOldMap31Reference':True,'sha256':SHA,'checksum':'7d94a5e8'})
 if directory.startswith(F+'/'):
  label=directory.rsplit('/',1)[1];ticks=load(directory+'/ticks.json.gz');assert len(ticks)==14400
  assert [r['tick'] for r in ticks]==list(range(14400)) and [r['tickAfter'] for r in ticks]==list(range(1,14401))
  all_ticks[label]=ticks
def distribution(values):
 v=sorted(values);n=len(v);rank=lambda p:v[max(0,math.ceil(n*p)-1)]
 return {'n':n,'mean':sum(values)/n,'median':rank(.5),'p95':rank(.95),'p99':rank(.99),'max':v[-1],'over16':sum(x>16 for x in values),'over50':sum(x>50 for x in values)}
METRICS=['wholeMs','simMs','aiMs','aiSnapshotMs','renderSnapshotMs','observerMs']
oldstats=load('/workspace/whole-integer-grow-abba-review/statistics.json')
for label,ticks in all_ticks.items():
 parts={'all':ticks} if label=='Bplain' else {'all':ticks,'planning':[r for r in ticks if r['ownerPlans']],'nonplanning':[r for r in ticks if not r['ownerPlans']]}
 d={k:{m:distribution([r[m] for r in group]) for m in METRICS} for k,group in parts.items()}
 assert d==oldstats['perRun'][label]['distribution']
 formal[label]={'distribution':d,'maxTick':max(ticks,key=lambda r:r['wholeMs']),'over50':[r for r in ticks if r['wholeMs']>50],
                'minuteBlocks':oldstats['perRun'][label]['minuteBlocks'],'keyTicks':oldstats['perRun'][label]['keyTicks'],
                'memoryOriginal':oldstats['perRun'][label]['memoryOriginal'],'targetPassed':d['all']['wholeMs']['p99']<=16 and d['all']['wholeMs']['max']<=50}
pool={g:distribution([r['wholeMs'] for r in all_ticks[g+'1']+all_ticks[g+'2']]) for g in ['A','B']}
assert pool['A']==oldstats['pooled']['A']['all']['wholeMs'] and pool['B']==oldstats['pooled']['B']['all']['wholeMs']
snapshot=load('/workspace/whole-stage5-integer-evidence-preparation/candidate-source-manifest.json');assert len(snapshot['files'])==12
for p in snapshot['files']:
 b=raw(p['snapshot']);assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256']
 assert oid('blob',b)==p['gitBlobOid']==blob_oid(CAND,p['path'])
binary=raw('/workspace/whole-stage5-integer-evidence-preparation/production-kernel.wasm');assert len(binary)==684 and hashlib.sha256(binary).hexdigest()==snapshot['embeddedProductionWasmSha256']
local=[]
for root,name,key,pathkey,n in [('/workspace/whole-integer-kernel-feasibility-v1','EVIDENCE-MANIFEST.json','rows','path',39),('/workspace/whole-integer-kernel-v2-tools','EVIDENCE-MANIFEST.json','files','path',63),('/workspace/whole-integer-kernel-v2-micro','EVIDENCE-MANIFEST.json','files','path',34),('/workspace/whole-performance-diagnostics-v12','closure-pins.json','files','path',49)]:
 x=load(root+'/'+name);assert len(x[key])==n
 for p in x[key]:
  path=p[pathkey];path=path if path.startswith('/') else root+'/'+path;b=raw(path)
  assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256']
 local.append({'manifest':root+'/'+name,'payloads':n,'allFullOriginalPayloadShaExact':True})
x=load('/workspace/whole-performance-map31-cpu-v11-closure-first/manifest.json');assert len(x['files'])==54
for p in x['files']:
 b=raw(x['rootDirectories'][p['group']]+'/'+p['file']);assert len(b)==p['bytes'] and hashlib.sha256(b).hexdigest()==p['sha256']
local.append({'manifest':'v11 closed original manifest','payloads':54,'allFullOriginalPayloadShaExact':True})
cal=load('/workspace/whole-performance-map31-cpu-v11-calibration-first/report.json');assert cal['resolutionObservation']['zeroDeltaGroups']==999 and cal['negativeGapGroups']==1
assert cal['resolutionObservation']['guaranteedErrorBoundUs'] is None
answer={'schema':1,'complete':True,'portableCommitAndTreeVerification':True,'requiresUnpublishedCandidateGitObject':False,'sourceByteClosure':sources,'commandByteClosure':commands,
        'formalPerRun':formal,'formalWholePools':pool,'pairedRegressions':oldstats['pairs'],'minuteComparisons':oldstats['minuteComparisons'],
        'originalLocalManifestClosure':local,'candidateSnapshotFiles':12,'completeProductionBinaryBytes':684,'allSamplesAndColdOutliersRetained':True,
        'plainExcludedFromPerformancePoolAndPhaseCategories':True,'wholeTargetPassed':False,'candidateAdopted':False,
        'v11Precision':'Calibration999zero and1negative; separate native5negative; no guaranteed error bound, exact offCPU unavailable.',
        'v12Scope':'240alignedgrow calls in a different epoch: land+63.484292/sea-28.268922/net+35.215370ms; cannot explain/subtract formal+1438.457086ms/run.',
        'execution':{'startedAt':began,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wallSeconds':time.perf_counter()-clock}}
def save(path,value):
 target=OUT/path
 if target.exists() and json.loads(target.read_text()).get('complete'):
  old=json.loads(target.read_text());old.pop('execution',None);new=dict(value);new.pop('execution',None);assert old==new
 else:target.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
save('analysis.json',answer);save('local-proof.json',{'complete':True,'manifests':local,'candidateSnapshotFiles':12,'productionBinaryBytes':684,'execution':answer['execution']})
print(json.dumps({'pass':True,'commandLogs':len(commands),'sourceRuns':len(sources),'sourceCounts':[s['sourceInputs'] for s in sources],'localManifests':local,'wholeTargetPassed':False,'execution':answer['execution']}))
