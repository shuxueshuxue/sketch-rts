#!/usr/bin/env python3
"""Independently authenticate and recompute from this archive alone."""
import base64,collections,gzip,hashlib,json,math,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
manifest=json.loads((ROOT/'manifest.json').read_bytes())
records={base64.b64decode(r['originalPathBase64']).decode():r for r in manifest['files']}
def raw(p):
 r=records[str(p)];b=gzip.decompress((ROOT/r['storedPath']).read_bytes());assert len(b)==r['originalBytes'] and hashlib.sha256(b).hexdigest()==r['originalSha256'];return b
def load(p):return json.loads(raw(p))
def sha(b):return hashlib.sha256(b).hexdigest()
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def eq(a,b):
 if isinstance(a,dict):assert set(a)==set(b);[eq(a[k],b[k]) for k in a]
 elif isinstance(a,list):assert len(a)==len(b);[eq(x,y) for x,y in zip(a,b)]
 elif isinstance(a,(int,float)) and not isinstance(a,bool):assert math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-9),(a,b)
 else:assert a==b,(a,b)
def dist(v):
 s=sorted(v);return {'count':len(s),'mean':sum(v)/len(v),'median':s[math.ceil(len(s)*.5)-1],'p95':s[math.ceil(len(s)*.95)-1],'p99':s[math.ceil(len(s)*.99)-1],'max':s[-1],'over16':sum(x>16 for x in v),'over50':sum(x>50 for x in v)}
def main():
 g=load('/tmp/whole-stage11-portable-git/manifest.json');trees={}
 for key,row in g['trees'].items():
  b=raw(row['file']);assert oid('tree',b)==key;entries={};i=0
  while i<len(b):
   space=b.index(b' ',i);end=b.index(b'\0',space);name=b[space+1:end].decode();entries[name]=(b[i:space].decode(),b[end+1:end+21].hex());i=end+21
  assert i==len(b);trees[key]=entries
 for head,row in g['heads'].items():assert oid('commit',raw(row['commitFile']))==head and raw(row['commitFile']).splitlines()[0]==('tree '+row['tree']).encode()
 def source_oid(head,name):
  key=g['heads'][head]['tree'];parts=name.split('/')
  for part in parts:key=trees[key][part][1]
  return key
 hashes='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997';base='0ea5beaee063c8443d66f7654333032b070d51ad';candidate='591216adc44703fdf9788c24237241299dbc85cf'
 runs={};oracle=None;initial_oracle=None;sources={}
 folders=[(f'r{n}-{label}',f'/tmp/whole-performance-abba-0ea-lazy-whole-next-r{n}/{label}',label.startswith('B'),label=='Bplain') for n in [1,2] for label in ['A1','B1','B2','A2','Bplain']]
 for label,p,isB,plain in folders:
  s=load(p+'/summary.json');env=load(p+'/environment.json');ticks=load_gzip(p+'/ticks.json.gz');commands=gzip.decompress(raw(p+'/command-frames.jsonl.gz'))
  assert len(commands)==618189 and sha(commands)==hashes
  if oracle is None:oracle=commands
  assert commands==oracle
  initial=gzip.decompress(raw(p+'/initial-snapshot.json.gz'))
  if initial_oracle is None:initial_oracle=initial
  assert initial==initial_oracle and len(initial)==147891 and sha(initial)=='5375d4a54cf3e0cc1d4c614c4442b07118c1f1e0dd47b6ea96c73206c2b882c7'
  assert s['rulesVersion']==3 and s['checksumVersion']==18 and s['finalChecksum']=='7d94a5e8'
  assert s['ticks']==s['finalTick']==s['frames']==len(ticks)==14400 and [t['tick'] for t in ticks]==list(range(14400)) and s['nonEmptyFrames']==612
  assert s['commandLogBytes']==len(commands) and s['commandLogSha256']==hashes and s['final']=={'units':109,'buildings':51} and s['winner'] is None
  head=candidate if isB else base;assert env['gitHead']==head and not env['gitStatus'];code=load_gzip(p+'/source-inputs.json.gz');declared={r['path']:r for r in env['sourceInputs']};assert code.keys()==declared.keys() and len(code)==241
  for name,text in code.items():
   b=text.encode();assert oid('blob',b)==source_oid(head,name);assert len(b)==declared[name]['bytes'] and sha(b)==declared[name]['sha256']
  source_rows=[{'path':r['path'],'bytes':len(code[r['path']].encode()),'sha256':sha(code[r['path']].encode())} for r in env['sourceInputs']]
  assert sha(json.dumps(source_rows,ensure_ascii=False,separators=(',',':')).encode())==env['sourceManifestSha256']
  assert sum(n.endswith('.ts') for n in code)==238
  assert sha(raw(p+'/probe-source.ts'))==env['probeSha256']=='42cb513fb2b7b03a69592348fcdd7873d662abb4854e6924e998906f4d4593c0'
  if p+'/runtime.mjs' in records:assert sha(raw(p+'/runtime.mjs'))==env['bundleSha256']
  for field in ['wholeMs','frameMs','simMs','aiMs','renderSnapshotMs','observerMs']:eq(dist([t[field] for t in ticks]),s['timing'][field])
  if plain:assert all(t['simMs']==t['aiMs']==0 and not t['ownerPlans'] for t in ticks)
  else:assert len([t for t in ticks if t['ownerPlans']])==960 and all(t['mod15']==0 and len(t['ownerPlans'])==5 for t in ticks if t['ownerPlans'])
  sources[label]={'head':head,'files':len(code),'allGitBlobAndDeclaredBytesExact':True};runs[label]={'ticks':ticks,'summary':s,'code':code}
 for row in g['changedSnapshots'][candidate]['files']:
  b=raw(row['snapshot']);assert oid('blob',b)==row['gitBlobOid']==source_oid(candidate,row['path']) and sha(b)==row['sha256']
 changed=[n for n in runs['r1-A1']['code'] if runs['r1-A1']['code'][n]!=runs['r1-B1']['code'][n]];assert changed==['src/shared/terrain.ts']
 combined=load('/tmp/terrain-lazy-whole-next-native-review-combined-v1/review.json');groups={a:[f'r{n}-{a}{suffix}' for n in [1,2] for suffix in ['1','2']] for a in ['A','B']}
 pooled={a:{f:dist([t[f] for k in keys for t in runs[k]['ticks']]) for f in ['wholeMs','simMs','aiMs','renderSnapshotMs','observerMs']} for a,keys in groups.items()};eq(groups,combined['groups']);eq(pooled,combined['pooled'])
 pairs=[]
 for n in [1,2]:
  review=load(f'/tmp/terrain-lazy-whole-next-native-review-r{n}/review.json')
  for label in ['A1','B1','B2','A2','Bplain']:
   run=runs[f'r{n}-{label}'];record=review['runsDetail'][label];eq(dist([t['wholeMs'] for t in run['ticks']]),record['whole']);eq([t for t in run['ticks'] if t['wholeMs']>50],record['over50Ticks']);eq(run['summary']['memory'],record['sparseMemory'])
  for a,b in [('A1','B1'),('A2','B2')]:
   ak=f'r{n}-{a}';bk=f'r{n}-{b}';pairs.append({'A':ak,'B':bk,'meanDeltaPercent':100*(runs[bk]['summary']['timing']['wholeMs']['mean']/runs[ak]['summary']['timing']['wholeMs']['mean']-1)})
 eq(pairs,combined['paired'])
 special={k:{'specialTicks':{str(t):v['ticks'][t] for t in [0,1859,5280,6990,9375,9659,10960]},'whole':dist([t['wholeMs'] for t in v['ticks']]),'over50Ticks':[t for t in v['ticks'] if t['wholeMs']>50],'sparseMemory':v['summary']['memory']} for k,v in runs.items()};eq(special,combined['specialTicksAndAllSlowSamples'])
 minutes=[]
 for minute in range(12):
  m={a:dist([t['wholeMs'] for k in keys for t in runs[k]['ticks'][minute*1200:(minute+1)*1200]]) for a,keys in groups.items()};minutes.append({'minute':minute,**m,'meanDeltaPercent':100*(m['B']['mean']/m['A']['mean']-1)})
 eq(minutes,combined['perMinute']);delta=100*(pooled['B']['wholeMs']['mean']/pooled['A']['wholeMs']['mean']-1);eq(delta,combined['meanDeltaPercent']);assert combined['targetPassed'] is False
 validation=load('/tmp/terrain-lazy-whole-next-validation-v1/VALIDATION.json')
 assert validation['status']=='PASS' and validation['head']==candidate and validation['uniqueRegressionFiles']==32 and validation['uniqueRegressionTests']==244 and validation['originalRegressionFiles']==23 and validation['originalRegressionTests']==185 and validation['sdkTests']==7
 assert all(validation[k]=='PASS' for k in ['aaProof','abProof','tscBuild','resourceClosure','source241Closure']) and len(validation['initialFailures'])==1 and validation['initialFailures'][0]['label']=='terrain-tests-01'
 source=load('/tmp/terrain-lazy-whole-next-validation-v1/source-closure.json')
 assert source['status']=='PASS' and source['head']==candidate and source['base']==base and source['sourceInputCount']==241 and source['productionChangedPaths']==['src/shared/terrain.ts'] and source['changedPaths']==['src/shared/terrain-multi-source.test.ts','src/shared/terrain-route-next.test.ts','src/shared/terrain.ts']
 assert all(source[k] is True for k in ['all241ReferenceGitNativeFullBytesEqual','all241ActualGitLiveFullBytesEqual','all241ProofHeadVersusFinalHeadFullBytesEqual'])
 proof=load('/tmp/terrain-lazy-whole-next-validation-v1/private-public-proof-01/stdout.log');assert proof['status']=='PASS' and proof['baselineRef']==base and proof['candidateHead']==source['proofHead']
 assert proof['sourceSha256']=={'baseline':sha(runs['r1-A1']['code']['src/shared/terrain.ts'].encode()),'candidate':sha(runs['r1-B1']['code']['src/shared/terrain.ts'].encode())}
 assert [r['mode'] for r in proof['results']]==['AA','AB'] and all(r['operations']==552 and r['fullStateComparisons']==566 and r['retainedFieldPairs']==275 for r in proof['results'])
 assert proof['results'][0]['permittedDeferredComparisons']==0 and proof['results'][1]['permittedDeferredComparisons']==72963
 assert proof['results'][1]['realMapRetainedFieldPayloadBeforeConsumption']==[{'fields':12,'distinctDistAndNextBuffers':24,'bytes':9953664},{'fields':12,'distinctDistAndNextBuffers':12,'bytes':4976832}]
 decision=load('/tmp/terrain-lazy-whole-next-native-review-combined-v1/decision.json');assert decision['head']==candidate and decision['status']=='HELD_UNSTABLE_NOT_ADOPTED' and decision['targetPassed'] is False and decision['coldIndependentReview']=='PENDING_SEPARATE_CHECKER';eq(delta,decision['nativeMeanDeltaPercent']);eq(combined['blockMeanDeltaPercent'],decision['nativeBlockMeanDeltaPercent'])
 phase_slow={a:{'planning':sum(t['wholeMs']>50 and t['mod15']==0 for k in keys for t in runs[k]['ticks']),'nonplanning':sum(t['wholeMs']>50 and t['mod15']!=0 for k in keys for t in runs[k]['ticks'])} for a,keys in groups.items()};assert phase_slow=={'A':{'planning':20,'nonplanning':6},'B':{'planning':12,'nonplanning':10}}
 cold=read_cold(source_oid)
 return {'complete':True,'candidate':candidate,'base':base,'decision':'HELD_UNSTABLE_NOT_ADOPTED','wholeTargetPassed':False,'originalNativeSourceGraphs':sources,'originalNativeSourceRecords':sum(v['files'] for v in sources.values()),'coldBuildSourceGraphs':2,'coldBuildSourceRecords':482,'commandFiles':len(runs),'allCompleteCommandAndInitialBytesEqual':True,'commandBytes':len(oracle),'commandSha256':hashes,'rulesVersion':3,'checksumVersion':18,'finalChecksum':'7d94a5e8','pooled':pooled,'paired':pairs,'blockMeanDeltaPercent':combined['blockMeanDeltaPercent'],'meanDeltaPercent':delta,'phaseOver50':phase_slow,'allSlowSamplesColdTicksAndSparseMemoryRetained':True,'plain':{k:v['whole'] for k,v in special.items() if k.endswith('Bplain')},'correctnessReported':validation,'privatePublicProofReported':proof,'correctnessSourceClosureReported':source,'coldIndependentArithmeticAndBytes':cold,'historicalDecisionPreserved':decision,'historicalPendingColdReviewNowFollowedByIndependentPass':True,'noNewEngineOrPerformanceRun':True,'noGcJitOrOsCauseInferred':True}
def load_gzip(p):return json.loads(gzip.decompress(raw(p)))
def read_cold(source_oid):
 from pathlib import PurePosixPath
 reviewroot='/tmp/terrain-lazy-whole-next-cold-independent-review-v1';coldroot='/tmp/terrain-lazy-whole-next-cold-proof-v1';recorded=load(reviewroot+'/report.json')
 assert recorded['complete'] and recorded['status']=='INDEPENDENT_RAW_BYTE_SOURCE_AND_ARITHMETIC_READBACK_PASS'
 class ArchivePath(PurePosixPath):
  def is_file(self):return str(self) in records
  def iterdir(self):return (ArchivePath(p) for p in records if PurePosixPath(p).parent==self)
  def rglob(self,pattern):
   assert pattern=='*';return (ArchivePath(p) for p in records if p.startswith(str(self).rstrip('/')+'/'))
 ns={'__name__':'archive_cold_checker'};exec(compile(raw(reviewroot+'/cold-proof.py'),reviewroot+'/cold-proof.py','exec'),ns);ns['Path']=ArchivePath
 def authenticate(head,path,b):assert oid('blob',b)==source_oid(head,path);return True
 result=ns['analyze'](raw,authenticate);eq(result,recorded['coldEvidenceReadback'])
 assert result['toolAdaptation']['toolPins']==20 and result['toolAdaptation']['actualToolFiles']==44 and result['toolAdaptation']['manifestFiles']==42 and result['toolAdaptation']['sha256SumEntries']==43 and result['toolAdaptation']['firstSealHistoricalPayloadClosureComplete'] is False
 for row in load(reviewroot+'/SOURCE-SEAL-v2.json')['files']:
  b=raw(reviewroot+'/'+row['path']);assert len(b)==row['bytes'] and sha(b)==row['sha256']
 inputs={a:load_gzip(coldroot+'/build-'+a+'/source-inputs.json.gz') for a in 'AB'}
 source_roots={'A':'/tmp/sketch-rts-cached-connectivity/','B':'/tmp/sketch-rts-lazy-whole-next/'}
 for pin in recorded['inputReadPins']:
  path=pin['path'];arm=next((a for a,p in source_roots.items() if path.startswith(p)),None)
  b=inputs[arm][path[len(source_roots[arm]):]].encode() if arm else raw(path)
  assert len(b)==pin['bytes'] and sha(b)==pin['sha256']
 for a in 'AB':
  env=load('/tmp/whole-performance-abba-0ea-lazy-whole-next-r1/'+('A1' if a=='A' else 'Bplain')+'/environment.json');native=load_gzip('/tmp/whole-performance-abba-0ea-lazy-whole-next-r1/'+('A1' if a=='A' else 'Bplain')+'/source-inputs.json.gz');assert inputs[a]==native
  assert len(env['sourceInputs'])==len(inputs[a])==241
 first=load(reviewroot+'/raw-readback-01-execution.json');second=load(reviewroot+'/raw-readback-02-execution.json');assert first['exitCode']==1 and second['exitCode']==0 and b'JSONDecodeError' in raw(reviewroot+'/raw-readback-01.stderr.log') and raw(reviewroot+'/raw-readback-02.stderr.log')==b''
 assert recorded['actualOuterExecution']['exitCode']==0
 return {'complete':True,'arithmeticAndAll24SnapshotBytesRecomputedFromArchive':True,'sourceGitAuthenticatedUsingPortableObjects':True,'nativeAndColdBuildFullSourceBytesEqual':True,'inputPinsAllMatchArchiveOrAuthenticatedSourceGraphs':len(recorded['inputReadPins']),'everyCheckerSourceAndFailureRetained':True,'toolClosure':result['toolAdaptation'],'comparisons':result['comparisons'],'pairedBlocks':result['pairedBlocks'],'outerExecution':recorded['actualOuterExecution'],'limits':recorded['limitations']}
if __name__=='__main__':
 result=main()
 if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 else:eq(result,json.loads((ROOT/'analysis.json').read_bytes()))
 print(json.dumps({'complete':True,'nativeSourceGraphs':len(result['originalNativeSourceGraphs']),'coldBuildSourceGraphs':2,'commandFiles':result['commandFiles'],'meanDeltaPercent':result['meanDeltaPercent'],'decision':result['decision'],'wholeTargetPassed':False}))
