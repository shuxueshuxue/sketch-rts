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
 g=load('/tmp/whole-stage9-portable-git/manifest.json');trees={}
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
 hashes='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997';base='0ea5beaee063c8443d66f7654333032b070d51ad';candidate='558550bd1e530df1be246cdf299d87f9f0457ec7'
 runs={};oracle=None;sources={};proofRoot='/tmp/terrain-wholes-hot-entry-validation-v1';traceRoot='/tmp/terrain-wholes-hot-entry-v8-v1'
 folders=[(f'r{n}-{label}',f'/tmp/whole-performance-abba-0ea-lazy-fields-r{n}/{label}',label.startswith('B'),label=='Bplain') for n in [1,2] for label in ['A1','B1','B2','A2','Bplain']]+[('v14','/tmp/whole-performance-current-spikes-v14',False,False)]+[(f'light-r{n}-{label}',f'/tmp/remaining-spikes-light-v1/r{n}-{label}',False,False) for n in [1,2] for label in ['A1','A2']]
 for label,p,isB,plain in folders:
  s=load(p+'/summary.json');env=load(p+'/environment.json');ticks=load_gzip(p+'/ticks.json.gz');commands=gzip.decompress(raw(p+'/command-frames.jsonl.gz'))
  assert len(commands)==618189 and sha(commands)==hashes
  if oracle is None:oracle=commands
  assert commands==oracle
  assert s['rulesVersion']==3 and s['checksumVersion']==18 and s['finalChecksum']=='7d94a5e8'
  assert s['ticks']==s['finalTick']==s['frames']==len(ticks)==14400 and [t['tick'] for t in ticks]==list(range(14400)) and s['nonEmptyFrames']==612
  assert s['commandLogBytes']==len(commands) and s['commandLogSha256']==hashes and s['final']=={'units':109,'buildings':51} and s['winner'] is None
  head=candidate if isB else base;assert env['gitHead']==head and not env['gitStatus'];code=load_gzip(p+'/source-inputs.json.gz');declared={r['path']:r for r in env['sourceInputs']};assert code.keys()==declared.keys() and len(code)==241
  for name,text in code.items():
   b=text.encode();assert oid('blob',b)==source_oid(head,name);assert len(b)==declared[name]['bytes'] and sha(b)==declared[name]['sha256']
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
 combined=load('/tmp/terrain-lazy-fields-native-review-combined-v1/review.json');groups={a:[f'r{n}-{a}{suffix}' for n in [1,2] for suffix in ['1','2']] for a in ['A','B']}
 pooled={a:{f:dist([t[f] for k in keys for t in runs[k]['ticks']]) for f in ['wholeMs','simMs','aiMs','renderSnapshotMs','observerMs']} for a,keys in groups.items()};eq(groups,combined['groups']);eq(pooled,combined['pooled'])
 pairs=[]
 for n in [1,2]:
  review=load(f'/tmp/terrain-lazy-fields-native-review-r{n}/review.json')
  for label in ['A1','B1','B2','A2','Bplain']:
   run=runs[f'r{n}-{label}'];record=review['runsDetail'][label];eq(dist([t['wholeMs'] for t in run['ticks']]),record['whole']);eq([t for t in run['ticks'] if t['wholeMs']>50],record['over50Ticks']);eq(run['summary']['memory'],record['sparseMemory'])
  for a,b in [('A1','B1'),('A2','B2')]:
   ak=f'r{n}-{a}';bk=f'r{n}-{b}';pairs.append({'A':ak,'B':bk,'meanDeltaPercent':100*(runs[bk]['summary']['timing']['wholeMs']['mean']/runs[ak]['summary']['timing']['wholeMs']['mean']-1)})
 eq(pairs,combined['paired'])
 special={k:{'tick0':v['ticks'][0]['wholeMs'],'tick1859':v['ticks'][1859]['wholeMs'],'tick5280':v['ticks'][5280]['wholeMs'],'tick6990':v['ticks'][6990]['wholeMs'],'tick9375':v['ticks'][9375]['wholeMs'],'tick9659':v['ticks'][9659]['wholeMs'],'whole':dist([t['wholeMs'] for t in v['ticks']]),'over50Ticks':[t for t in v['ticks'] if t['wholeMs']>50]} for k,v in runs.items() if k in groups['A']+groups['B']+['r1-Bplain','r2-Bplain']};eq(special,combined['specialTicksAndAllSlowSamples'])
 minutes=[]
 for minute in range(12):
  m={a:dist([t['wholeMs'] for k in keys for t in runs[k]['ticks'][minute*1200:(minute+1)*1200]]) for a,keys in groups.items()};minutes.append({'minute':minute,**m,'meanDeltaPercent':100*(m['B']['mean']/m['A']['mean']-1)})
 eq(minutes,combined['perMinute']);delta=100*(pooled['B']['wholeMs']['mean']/pooled['A']['wholeMs']['mean']-1);eq(delta,combined['meanDeltaPercent']);assert combined['targetPassed'] is False
 api=load('/tmp/pr380-release-review/merged-main-commit-stdout.log');assert api['sha']=='4804631c22f7be3f83dc6374e71ce03d86068dd8' and api['tree']['sha']==g['heads'][base]['tree']
 proof=load('/tmp/terrain-lazy-tile-fields-preparation/proof-01/stdout.log');assert proof['status']=='PASS' and (proof['publicQueries'],proof['privateQueries'],proof['stateComparisons'],proof['materializedNodeComparisons'],proof['deferredNodeComparisons'])==(42,35231,208,7476,4136)
 assert proof['hashes']['baseline']==sha(runs['r1-A1']['code']['src/shared/terrain.ts'].encode()) and proof['hashes']['candidate']==sha(runs['r1-B1']['code']['src/shared/terrain.ts'].encode())
 allocations=proof['allocations'];assert allocations[0]['baseline']['int32Bytes']==41216 and allocations[0]['candidate']['int32Bytes']==0 and allocations[0]['baseline']['fields']==62 and allocations[0]['candidate']['fields']==0
 assert all(row['baseline']==row['candidate'] for row in allocations[2:]) and len(allocations)==10
 cr='/tmp/terrain-lazy-tile-fields-preparation/';coverage=load(cr+'acceptance-coverage.json');assert coverage['status']=='PASS' and len(coverage['originalFiles'])==23 and sum(x['tests'] for x in coverage['originalFiles'])==185 and coverage['addedPermanentTests']==3 and coverage['shipLaunchTests']==13
 out=(raw(cr+'terrain-navigation-ships-01/stdout.log')+raw(cr+'regression-supplement-01/stdout.log')).decode()
 for row in coverage['originalFiles']:assert re.search(re.escape(row['path'])+r' \('+str(row['tests'])+r' tests?\)',out),row
 classification=load(cr+'existing-failure-classification.json');assert classification['status']=='MATCH' and classification['candidateFailures']==classification['baselineTargetedFailures'] and len(classification['candidateFailures'])==4
 stderr=raw(cr+'terrain-navigation-ships-01/stderr.log');assert stderr==raw(cr+'baseline-existing-failures-01/stderr.log')
 failures=[];lines=stderr.decode().splitlines()
 for i,line in enumerate(lines):
  if line.startswith(' FAIL '):failures.append({'test':line[6:].strip(),'assertion':lines[i+1].strip()})
 eq(failures,classification['candidateFailures'])
 source=load(cr+'source-closure.json');assert source['clean'] and source['allOtherBasePathsUnchanged'] and source['commit']==candidate and source['productionChangedPaths']==['src/shared/terrain.ts']
 for execution in source['completedHeavyRuns']:eq(execution,load(cr+execution['label']+'/result.json'))
 attr=load('/tmp/whole-performance-current-spikes-v14-tools/source-qualified-profile-attribution.json');dec=load('/tmp/whole-performance-current-spikes-v14-tools/tick-decomposition.json');assert dec['notAcceptance'] and dec['inclusiveScopesMustNotBeSummed'] and dec['samplingIsApproximate'];cpu=[]
 for profile in attr['profiles']:
  tick=profile['tick'];p=load_gzip('/tmp/whole-performance-current-spikes-v14/cpu-window-'+str(tick)+'-'+str(tick)+'.cpuprofile.gz');negative=[{'index':i,'microseconds':v} for i,v in enumerate(p['timeDeltas']) if v<0];eq(negative,profile['negativeTimeDeltas']);assert len(p['samples'])==len(p['timeDeltas'])==profile['sampleCount'];assert profile['clockVerified'];assert profile['profileDurationAttributionAccepted']==(not negative)
  row=next(r for r in dec['rows'] if r['tick']==tick);assert row['durationAttributionAccepted']==(not negative);eq(row['wholeMs'],runs['v14']['ticks'][tick]['wholeMs'])
  if tick==0:
   assert negative==[{'index':3,'microseconds':-1}] and all(k not in profile for k in ['leafSamples','inclusiveStackSamples','tickIntersectingIntervals','tickHrtimeSpanUs'])
  cpu.append({'tick':tick,'negativeTimeDeltas':negative,'entireDurationWindowAccepted':not negative,'rawSamplesRetained':len(p['samples'])})
 assert [r['tick'] for r in cpu]==[0,6990,9375,9659]
 profile=next(p for p in attr['profiles'] if p['tick']==9659);scope=next(x for x in profile['focusedScopes'] if x['name']=='tilesOf');eq(scope['inclusiveMs'],45.128875000002154);assert scope['calls']==10
 block9659={a:[runs[k]['ticks'][9659]['wholeMs'] for k in keys] for a,keys in groups.items()};assert max(block9659['B'])<min(block9659['A'])
 rootIndependent=load('/tmp/terrain-lazy-fields-cold-independent-review-v1/report.json')
 namespace={'__name__':'archived_cold_proof'};exec(raw('/tmp/stage9-static-summary/cold-proof.py'),namespace);cold=namespace['analyze'](raw,lambda head,name,b: oid('blob',b)==source_oid(head,name))
 counterNamespace={'__name__':'archived_counter_proof'};exec(raw('/tmp/whole-stage9-archive-tools/counter-proof-v2.py'),counterNamespace);counterResult=counterNamespace['analyze'](raw,lambda head,name,b: oid('blob',b)==source_oid(head,name))
 result={'complete':True,'candidate':candidate,'base':base,'decision':'HOLD_NOT_ADOPTED; no candidate code push, PR or merge','wholeTargetPassed':False,'rawCommitCount':2,'rawTreeCount':len(trees),'sourceGraphs':sources,'originalFullCommandFiles':len(runs),'commandBytes':len(oracle),'commandSha256':hashes,'allFullCommandsByteEqual':True,'sourceRecords':sum(x['files'] for x in sources.values()),'pooled':pooled,'paired':pairs,'meanDeltaPercent':delta,'plain':{k:v['whole'] for k,v in special.items() if k.endswith('Bplain')},'tick9659':block9659,'coldFormalTick0':{a:[runs[k]['ticks'][0]['wholeMs'] for k in keys] for a,keys in groups.items()},'allSlowSamplesAndMinutesVerified':True,'correctnessProofReportedAndAuthenticated':proof,'originalTestCoverage':coverage,'existingFourFailuresExactlyReproducedOnCleanBase':True,'baselineWasTargetedFourFailuresOnly':True,'v14CpuWindows':cpu,'v14TilesOfInstrumentedScope':scope,'v14IsDiagnosticNotAcceptance':True,'cold24':cold,'coldScalarDiagnostic':counterResult,'independentColdReportRetained':True,'firstIndependentColdCheckerSourceFrozenBeforeExecution':False,'firstIndependentColdCheckerOnlyExecutionLogsRetained':True,'finalIndependentColdCheckerFullSourceRetained':True,'nearestRank':'ceil(n*p)-1','removedOutliers':0,'noGcJitOrOsCausalAttribution':True}
 return result
def load_gzip(p):return json.loads(gzip.decompress(raw(p)))
if __name__=='__main__':
 result=main();dest=Path(sys.argv[1]) if len(sys.argv)>1 else None
 if dest:dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 else:eq(result,json.loads((ROOT/'analysis.json').read_bytes()))
 print(json.dumps({'complete':True,'sourceGraphs':len(result['sourceGraphs']),'commands':result['originalFullCommandFiles'],'meanDeltaPercent':result['meanDeltaPercent'],'wholeTargetPassed':False,'decision':result['decision'],'cold24Verified':True}))
