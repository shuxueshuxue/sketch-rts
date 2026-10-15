"""Replay only archived Python data analysis; never launch application code."""
import base64,builtins,collections,gzip,hashlib,json,math,sys,types
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parent;manifest=json.loads((ROOT/'manifest.json').read_bytes());records={base64.b64decode(r['originalPathBase64']).decode():r for r in manifest['files']};virtual={}
def sha(b):return hashlib.sha256(b).hexdigest()
def raw(p):
 p=str(p)
 if p in virtual:return virtual[p]
 r=records[p];b=gzip.decompress((ROOT/r['storedPath']).read_bytes());assert len(b)==r['originalBytes'] and sha(b)==r['originalSha256'];return b
def load(p):return json.loads(raw(p))
def gz(p):return json.loads(gzip.decompress(raw(p)))
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def eq(a,b):
 if isinstance(a,dict):assert set(a)==set(b),(set(a)-set(b),set(b)-set(a));[eq(a[k],b[k]) for k in a]
 elif isinstance(a,list):assert len(a)==len(b);[eq(x,y) for x,y in zip(a,b)]
 elif isinstance(a,(int,float)) and not isinstance(a,bool):assert math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-9),(a,b)
 else:assert a==b,(a,b)
def main():
 graph=load('/tmp/whole-stage14-portable-git/manifest.json');trees={}
 for key,row in graph['trees'].items():
  b=raw(row['file']);assert oid('tree',b)==key;entries={};i=0
  while i<len(b):
   sp=b.index(b' ',i);end=b.index(b'\0',sp);entries[b[sp+1:end].decode()]=(b[i:sp].decode(),b[end+1:end+21].hex());i=end+21
  assert i==len(b);trees[key]=entries
 for head,row in graph['heads'].items():assert oid('commit',raw(row['commitFile']))==head and raw(row['commitFile']).splitlines()[0]==('tree '+row['tree']).encode()
 def source_oid(head,name):
  key=graph['heads'][head]['tree']
  for part in name.split('/'):key=trees[key][part][1]
  return key
 base='0ea5beaee063c8443d66f7654333032b070d51ad';candidate='1cfcc0e418930d5c38925f94b4793554a526f2b6';assert set(graph['heads'])=={base,candidate}
 profile='/tmp/whole-performance-joint-tail-focus-v1';tools=profile+'-tools';execution=profile+'-execution';config=load(tools+'/plan-v2.json');phase=load(tools+'/phase-baseline-v2.json');oracle=None;initial=None;runrows={};codes={}
 folders=[(profile+'/A',base),(profile+'/B',candidate),('/tmp/terrain-bucket-allocation-count-v1',base)]+[(f'/tmp/whole-performance-abba-0ea-naval-hull-combined-r1/{name}',base if name=='A1' else candidate) for name in ['A1','B1','Bplain']]
 for p,head in folders:
  env=load(p+'/environment.json');s=load(p+'/summary.json');code=gz(p+'/source-inputs.json.gz');ticks=gz(p+'/ticks.json.gz');cmd=gzip.decompress(raw(p+'/command-frames.jsonl.gz'));init=gzip.decompress(raw(p+'/initial-snapshot.json.gz'))
  assert env['gitHead']==head and not env['gitStatus'];assert len(code)==len(env['sourceInputs'])==241 and set(code)=={r['path'] for r in env['sourceInputs']}
  source_rows=[]
  for r in env['sourceInputs']:
   b=code[r['path']].encode();assert len(b)==r['bytes'] and sha(b)==r['sha256'] and oid('blob',b)==source_oid(head,r['path']);source_rows.append({k:v for k,v in r.items() if k!='esbuildBytes'})
  assert sha(json.dumps(source_rows,separators=(',',':'),ensure_ascii=False).encode())==env['sourceManifestSha256']
  assert len(cmd)==618189 and sha(cmd)=='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997';assert len(init)==147891 and sha(init)=='5375d4a54cf3e0cc1d4c614c4442b07118c1f1e0dd47b6ea96c73206c2b882c7'
  if oracle is None:oracle=cmd;initial=init
  assert cmd==oracle and init==initial
  frames=[json.loads(line) for line in cmd.splitlines()];assert [r['tick'] for r in frames]==list(range(14400)) and sum(r['frame'] is not None for r in frames)==612
  for k,v in {'ticks':14400,'finalTick':14400,'frames':14400,'nonEmptyFrames':612,'rulesVersion':3,'checksumVersion':18,'finalChecksum':'7d94a5e8','commandLogBytes':618189,'commandLogSha256':sha(cmd),'final':{'units':109,'buildings':51},'winner':None}.items():assert s[k]==v,(p,k)
  assert len(ticks)==14400 and all(t['tick']==i and t['tickAfter']==i+1 and t['mod15']==i%15 for i,t in enumerate(ticks))
  assert sha(raw(p+'/probe-source.ts'))==env['probeSha256']
  if p+'/runtime.mjs' in records:assert sha(raw(p+'/runtime.mjs'))==env['bundleSha256']
  runrows[p]=ticks;codes[p]=code
 for arm in 'AB':
  prefix=config['arms'][arm]['source']+'/'
  for name,text in codes[profile+'/'+arm].items():virtual[prefix+name]=text.encode()
 owners=[('enemy','v9_archer'),('enemy2','v9_archer'),('player-4','v9_knight'),('player-5','v9_summoner'),('player-6','v9_knight')]
 for arm in 'AB':
  current=runrows[profile+'/'+arm];prior=runrows[phase['arms'][arm]['directory']]
  for i,(a,b) in enumerate(zip(current,prior)):
   assert all(a[k]==b[k] for k in ['tick','tickAfter','mod15','units','buildings']);assert [(r['owner'],r['version']) for r in a['ownerPlans']]==[(r['owner'],r['version']) for r in b['ownerPlans']]==(owners if i%15==0 else [])
 # Replay the exact archived analyzer in a read-only virtual filesystem. Its Git
 # callback is replaced by the already portable-object-authenticated source bytes.
 class ArchivePath(PurePosixPath):
  def resolve(self):return self
  def read_bytes(self):return raw(self)
  def read_text(self,*args,**kwargs):return raw(self).decode()
 captured={};originalImport=builtins.__import__;oldArgv=sys.argv[:]
 for arm in 'AB':
  phaseModule=types.ModuleType('phase_reference_v2');phaseModule.qualify_phase_reference=lambda a:(runrows[phase['arms'][a]['directory']],load(execution+'/'+a+'/phase-reference-qualification.json'))
  def archived_import(name,*args,**kwargs):
   if name=='pathlib':return types.SimpleNamespace(Path=ArchivePath)
   if name=='phase_reference_v2':return phaseModule
   return originalImport(name,*args,**kwargs)
  source=raw(tools+'/analyze-diagnostic-v2.py');ns={'__name__':'archived_profile_analyzer','__file__':tools+'/analyze-diagnostic-v2.py','__builtins__':{**vars(builtins),'__import__':archived_import}};sys.argv=['analyze-diagnostic-v2.py',arm]
  try:
   exec(compile(source,ns['__file__'],'exec'),ns);outputs={};ns['write']=lambda name,data:outputs.__setitem__(name,json.loads(json.dumps(data)));ns['git_blob_batch']=lambda inputs:{r['path']:codes[profile+'/'+arm][r['path']].encode() for r in inputs};ns['main']()
  finally:sys.argv=oldArgv
  for name in ['oracle-source-closure.json','full-phase-readback.json','phase-reference-qualification.json']:
   actual=outputs[name];recorded=load(execution+'/'+arm+'/'+name)
   if 'createdUtc' in actual:actual=dict(actual);recorded=dict(recorded);actual.pop('createdUtc');recorded.pop('createdUtc')
   eq(actual,recorded)
  actual=outputs['source-qualified-profile-attribution.json'];recorded=gz(execution+'/'+arm+'/source-qualified-profile-attribution.json.gz');actual.pop('createdUtc');recorded.pop('createdUtc');eq(actual,recorded);captured[arm]=recorded['profiles']
  diagnostics=gz(profile+'/'+arm+'/focused-diagnostics.json.gz')
  for w in diagnostics['profileWindows']:
   cpu=gz(profile+'/'+arm+'/'+w['file']);valid=w['beforeStart']['hrtimeUs']<=cpu['startTime']<=w['afterStart']['hrtimeUs'] and w['beforeStop']['hrtimeUs']<=cpu['endTime']<=w['afterStop']['hrtimeUs'];assert valid==w['clockVerified'] is True
  assert len(captured[arm])==3 and all(w['profileDurationAttributionAccepted'] for w in captured[arm])
 # The source-restored55-file proof and generated-bytecode failure remain distinct.
 inv=load('/tmp/whole-stage14-archive-tools/inventory.json');toolRows=[r for r in inv['files'] if r['p'].startswith(tools+'/')];assert len(toolRows)==55 and sum(r['n'] for r in toolRows)==512808
 for r in inv['files']:assert len(raw(r['p']))==r['n'] and sha(raw(r['p']))==r['h']
 from counter_adapter import read_counter
 counter=read_counter(raw,source_oid)
 return {'complete':True,'originalPaths':583,'fullOriginalAliasByteWitnessPreserved':True,'portableHeads':[base,candidate],'sourceGraphs':len(folders),'sourceRecords':241*len(folders),'fullCommandsInitialFinalAndPhasePass':True,'commandBytes':618189,'commandSha256':sha(oracle),'initialBytes':len(initial),'finalChecksum':'7d94a5e8','restoredOriginalProfileSourceFiles':55,'restoredProfileSourceBytes':512808,'validCpuWindows':6,'allOriginalProfileClippedIntervalsLeafInclusiveAndSourceQualificationsRecomputed':True,'counter':counter,'oldSdkRerun':False,'oldPayloadsSparse':True,'wholeTargetPassed':False,'candidateDecision':'HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED','performanceAcceptance':False,'applicationEngineExecuted':False,'limitations':['Sampled intervals and inclusive walls do not establish exact CPU or causal attribution.','5280 was not reproduced;1859 launch and10950 sea goal22916 are diagnostic context.','Allocation mover identities unavailable; cumulative payload is not peak, rate, malloc calls, or CPU saving.','Historical SDK13/14 belongs to Stage13 before old payload dehydration; Stage14 does not claim an SDK rerun.']}
if __name__=='__main__':
 result=main()
 if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 else:eq(result,json.loads((ROOT/'analysis.json').read_bytes()))
 print(json.dumps(result))
