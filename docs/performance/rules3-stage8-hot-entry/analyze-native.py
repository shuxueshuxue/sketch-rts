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
 g=load('/tmp/whole-stage8-portable-git/manifest.json');trees={}
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
 hashes='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997';base='0ea5beaee063c8443d66f7654333032b070d51ad';candidate='909886a7f61397e1c5fdbbc455eae181072c5a60'
 runs={};oracle=None;sources={};proofRoot='/tmp/terrain-wholes-hot-entry-validation-v1';traceRoot='/tmp/terrain-wholes-hot-entry-v8-v1'
 folders=[(f'r{n}-{label}',f'/tmp/whole-performance-abba-0ea-hot-entry-r{n}/{label}',label.startswith('B'),label=='Bplain') for n in [1,2] for label in ['A1','B1','B2','A2','Bplain']]+[(f'v8-{a}',traceRoot+'/'+a+'-native',a=='B',False) for a in ['A','B']]
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
  assert sha(raw(p+'/runtime.mjs'))==env['bundleSha256'] and sha(raw(p+'/probe-source.ts'))==env['probeSha256']=='42cb513fb2b7b03a69592348fcdd7873d662abb4854e6924e998906f4d4593c0'
  for field in ['wholeMs','frameMs','simMs','aiMs','renderSnapshotMs','observerMs']:eq(dist([t[field] for t in ticks]),s['timing'][field])
  if plain:assert all(t['simMs']==t['aiMs']==0 and not t['ownerPlans'] for t in ticks)
  else:assert len([t for t in ticks if t['ownerPlans']])==960 and all(t['mod15']==0 and len(t['ownerPlans'])==5 for t in ticks if t['ownerPlans'])
  sources[label]={'head':head,'files':len(code),'allGitBlobAndDeclaredBytesExact':True};runs[label]={'ticks':ticks,'summary':s,'code':code}
 for row in g['changedSnapshots'][candidate]['files']:
  b=raw(row['snapshot']);assert oid('blob',b)==row['gitBlobOid']==source_oid(candidate,row['path']) and sha(b)==row['sha256']
 changed=[n for n in runs['r1-A1']['code'] if runs['r1-A1']['code'][n]!=runs['r1-B1']['code'][n]];assert changed==['src/shared/terrain.ts']
 combined=load('/tmp/terrain-hot-entry-native-review-combined-v1/review.json');groups={a:[f'r{n}-{a}{suffix}' for n in [1,2] for suffix in ['1','2']] for a in ['A','B']}
 pooled={a:{f:dist([t[f] for k in keys for t in runs[k]['ticks']]) for f in ['wholeMs','simMs','aiMs','renderSnapshotMs','observerMs']} for a,keys in groups.items()};eq(groups,combined['groups']);eq(pooled,combined['pooled'])
 pairs=[]
 for n in [1,2]:
  review=load(f'/tmp/terrain-hot-entry-native-review-r{n}/review.json')
  for label in ['A1','B1','B2','A2','Bplain']:
   run=runs[f'r{n}-{label}'];record=review['runsDetail'][label];eq(dist([t['wholeMs'] for t in run['ticks']]),record['whole']);eq([t for t in run['ticks'] if t['wholeMs']>50],record['over50Ticks']);eq(run['summary']['memory'],record['sparseMemory'])
  for a,b in [('A1','B1'),('A2','B2')]:
   ak=f'r{n}-{a}';bk=f'r{n}-{b}';pairs.append({'A':ak,'B':bk,'meanDeltaPercent':100*(runs[bk]['summary']['timing']['wholeMs']['mean']/runs[ak]['summary']['timing']['wholeMs']['mean']-1)})
 eq(pairs,combined['paired'])
 special={k:{'tick0':v['ticks'][0]['wholeMs'],'tick1859':v['ticks'][1859]['wholeMs'],'tick5280':v['ticks'][5280]['wholeMs'],'tick6990':v['ticks'][6990]['wholeMs'],'whole':dist([t['wholeMs'] for t in v['ticks']]),'over50Ticks':[t for t in v['ticks'] if t['wholeMs']>50]} for k,v in runs.items() if not k.startswith('v8')};eq(special,combined['specialTicksAndAllSlowSamples'])
 minutes=[]
 for minute in range(12):
  m={a:dist([t['wholeMs'] for k in keys for t in runs[k]['ticks'][minute*1200:(minute+1)*1200]]) for a,keys in groups.items()};minutes.append({'minute':minute,**m,'meanDeltaPercent':100*(m['B']['mean']/m['A']['mean']-1)})
 eq(minutes,combined['perMinute']);delta=100*(pooled['B']['wholeMs']['mean']/pooled['A']['wholeMs']['mean']-1);eq(delta,combined['meanDeltaPercent']);assert combined['targetPassed'] is False
 correctness=load(proofRoot+'/CORRECTNESS.json');assert correctness['complete'] and correctness['head']==candidate and correctness['base']==base and correctness['privateRuntimeProofCases']==40 and correctness['typedArrayBytesCompared']==11544 and correctness['uniqueOriginalTests']==192 and correctness['uniqueOriginalTestFiles']==24 and correctness['noAssertionChanges']
 proof=load(proofRoot+'/private-wholes-proof.json');assert proof['status']=='PASS' and proof['cases']==40 and proof['arrayBytesCompared']==11544 and len(proof['witnesses'])==30 and len(proof['accessorModes'])==10 and all(w['coldOwnKeyInsertion'] and w['cachedObjectAndArraysRetained'] for w in proof['witnesses'])
 assert sum(w['labelsBytes']+w['deepBytes'] for w in proof['witnesses'])==5324
 # The original counter includes two comparisons per witness, two additional overlay comparisons and the successful accessor case; witnesses alone are not its total.
 for key in ['baselineSourceSha256','candidateSourceSha256']:assert proof[key]==sha(runs['r1-'+('A1' if key.startswith('baseline') else 'B1')]['code']['src/shared/terrain.ts'].encode())
 trace=load(traceRoot+'/trace-summary.json');traceChecks={}
 for label in ['A','B']:
  counts={n:{'bytecode':[],'inlineAsCallee':0,'deoptReasons':collections.Counter()} for n in ['wholesOf','buildWholes']};pending=None;selected=[];inlines=[]
  for line_no,line in enumerate(raw(traceRoot+'/'+label+'-stdout.log').decode().splitlines(keepends=True),1):
   h=re.search(r'^\[generated bytecode for function: (wholesOf|buildWholes) ',line)
   if h:pending=(h.group(1),line_no)
   length=re.match(r'^Bytecode length: (\d+)',line)
   if length and pending:counts[pending[0]]['bytecode'].append({'length':int(length.group(1)),'headerLine':pending[1],'lengthLine':line_no});selected.append(f'{line_no}:{line}');pending=None
   present=[n for n in counts if re.search(r'\b'+n+r'\b',line)]
   if present:selected.append(f'{line_no}:{line}')
   names=re.findall(r'<SharedFunctionInfo ([^>]+)>',line)
   for name in present:
    if line.startswith('Inlining ') and len(names)>=2 and names[0]==name:counts[name]['inlineAsCallee']+=1;inlines.append({'line':line_no,'callee':name,'caller':names[1],'record':line.rstrip()})
    if '[bailout ' in line and re.search(r'<JSFunction '+name+r' ',line):
     reason=re.search(r'reason: (.*)\): begin\. deoptimizing',line);assert reason;counts[name]['deoptReasons'][reason.group(1)]+=1
  assert ''.join(selected).encode()==raw(traceRoot+'/'+label+'-wholes-trace-lines.txt');eq(inlines,[json.loads(x) for x in raw(traceRoot+'/'+label+'-inline-target-records.jsonl').splitlines()])
  for name in counts:
   counts[name]['deoptReasons']=dict(counts[name]['deoptReasons'])
   for key in counts[name]:eq(counts[name][key],trace['runs'][label][name][key])
  traceChecks[label]=counts
 assert [traceChecks[a]['wholesOf']['bytecode'][0]['length'] for a in ['A','B']]==[445,19]
 assert [traceChecks[a]['wholesOf']['inlineAsCallee'] for a in ['A','B']]==[4,16] and sum(traceChecks['B']['buildWholes']['deoptReasons'].values())==19
 hook=load(traceRoot+'/hook-order-normalization.json');assert hook['AWillNotRerun'] and hook['BOnlyOneOriginalCommand'];assert load(traceRoot+'/A-failure.json')
 closure=load(traceRoot+'/closure.json');assert closure['nativeRunCounts']=={'A':1,'B':1} and closure['nativeChildrenExit0'] and closure['acceptedAsPerformanceEvidence'] is False
 result={'complete':True,'candidate':candidate,'base':base,'decision':'REJECTED; no candidate code publication','rawCommitCount':len(g['heads']),'rawTreeCount':len(trees),'changedSourceFiles':changed,'sourceChecks':sources,'fullCommandFiles':len(runs),'allCommandFullBytesEqual':True,'commandBytes':len(oracle),'commandSha256':hashes,'finalChecksum':'7d94a5e8','rulesVersion':3,'checksumVersion':18,'pooled':pooled,'paired':pairs,'meanDeltaPercent':delta,'targetPassed':False,'plain':{k:v['whole'] for k,v in special.items() if k.endswith('Bplain')},'allSlowSamplesVerifiedAgainstSavedReviews':True,'allMinuteStatisticsVerified':True,'coldTick0Included':True,'correctness':{'files':24,'tests':192,'privateCases':40,'typedBytes':11544,'originalAssertionsPreserved':True},'v8':traceChecks,'v8IsNotPerformanceEvidence':True,'originalHookOrderFailureAndNormalizationRetained':True}
 return result
def load_gzip(p):return json.loads(gzip.decompress(raw(p)))
if __name__=='__main__':
 result=main();dest=Path(sys.argv[1]) if len(sys.argv)>1 else None
 if dest:dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 else:eq(result,json.loads((ROOT/'analysis.json').read_bytes()))
 print(json.dumps({'complete':True,'sources':len(result['sourceChecks']),'commandFiles':result['fullCommandFiles'],'meanDeltaPercent':result['meanDeltaPercent'],'targetPassed':False,'traceRecordsVerified':True}))
