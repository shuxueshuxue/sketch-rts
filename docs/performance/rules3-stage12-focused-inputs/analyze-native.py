"""Future-grant archive-only byte/source/numeric readback, with no application run."""
import base64,collections,gzip,hashlib,json,math,struct,sys
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parent
HEAD='0ea5beaee063c8443d66f7654333032b070d51ad';SOURCE='/tmp/sketch-rts-cached-connectivity/'
V2='/tmp/ship-sweep-capture-v2';NAV='/tmp/ship-nav-hull-9375-count';REF='/tmp/whole-performance-abba-0ea-lazy-fields-r1/A1'
manifest=json.loads((ROOT/'manifest.json').read_bytes());records={base64.b64decode(r['originalPathBase64']).decode():r for r in manifest['files']};cache={}
def need(ok,detail):
 if not ok:raise AssertionError(detail)
def sha(b):return hashlib.sha256(b).hexdigest()
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def raw(path):
 path=str(path)
 if path not in cache:
  r=records[path];b=gzip.decompress((ROOT/r['storedPath']).read_bytes());need(len(b)==r['originalBytes'] and sha(b)==r['originalSha256'],('archive full decoded pin',path));cache[path]=b
 return cache[path]
def doc(path):return json.loads(raw(path))
def gz(path):return gzip.decompress(raw(path))
def intv(v):need(math.isfinite(v) and v>=0 and int(v)==v,('unsigned integer',v));return int(v)
def main():
 portable=doc('/tmp/whole-stage12-portable-git/manifest.json');need(set(portable['heads'])=={HEAD} and portable['changedSnapshots']=={} and portable['runtimeBaselineOnly'] and portable['candidateSourceHeads']==[],'single original baseline source object scope');trees={}
 for key,row in portable['trees'].items():
  b=raw(row['file']);need(oid('tree',b)==key and len(b)==row['bytes'] and sha(b)==row['sha256'],'raw tree object');entries={};cursor=0
  while cursor<len(b):
   space=b.index(b' ',cursor);end=b.index(b'\0',space);name=b[space+1:end].decode();need(name not in entries,'tree entry uniqueness');entries[name]=(b[cursor:space].decode(),b[end+1:end+21].hex());cursor=end+21
  need(cursor==len(b),'raw tree exact exhaustion');trees[key]=entries
 commit=raw(portable['heads'][HEAD]['commitFile']);need(oid('commit',commit)==HEAD and commit.splitlines()[0]==('tree '+portable['heads'][HEAD]['tree']).encode(),'raw baseline commit object')
 def blob_oid(path):
  key=portable['heads'][HEAD]['tree']
  for part in path.split('/'):key=trees[key][part][1]
  return key
 captures={};runrows=[];commands=None;initial=None
 for folder in [V2,NAV]:
  env=doc(folder+'/environment.json');summary=doc(folder+'/summary.json');code=json.loads(gz(folder+'/source-inputs.json.gz'));need(env['gitHead']==HEAD and env['gitStatus']=='' and len(code)==len(env['sourceInputs'])==241,'actual diagnostic source epoch and exact graph')
  rows=[]
  for r in env['sourceInputs']:
   b=code[r['path']].encode();need(len(b)==r['bytes'] and sha(b)==r['sha256'] and oid('blob',b)==blob_oid(r['path']),('portable Git source bytes',folder,r['path']));rows.append({'path':r['path'],'bytes':len(b),'sha256':sha(b)})
  need(len({r['path'] for r in rows})==241 and sha(json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode())==env['sourceManifestSha256'],'full source manifest')
  expected={'ticks':14400,'finalTick':14400,'rulesVersion':3,'checksumVersion':18,'finalChecksum':'7d94a5e8','frames':14400,'nonEmptyFrames':612,'commandLogBytes':618189,'commandLogSha256':'771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997','winner':None}
  for k,v in expected.items():need(summary[k]==v,('full native semantic pin',folder,k))
  need(summary['final']=={'units':109,'buildings':51} and summary['planningTicks']['count']==960 and summary['planningTicks']['allOnMod15Zero'] and summary['planningTicks']['allFiveOwners'],'original final entities and phase summary')
  current_commands=gz(folder+'/command-frames.jsonl.gz');current_initial=gz(folder+'/initial-snapshot.json.gz')
  if commands is None:commands=current_commands;initial=current_initial
  need(current_commands==commands and len(commands)==618189 and sha(commands)==expected['commandLogSha256'] and len(commands.splitlines())==14400,'complete original command bytes')
  need(current_initial==initial and len(initial)==147891 and sha(initial)=='5375d4a54cf3e0cc1d4c614c4442b07118c1f1e0dd47b6ea96c73206c2b882c7','complete initial snapshot')
  tools=folder+'-tools';pins=doc(tools+'/tool-pins.json');want=27 if folder==V2 else 23;wantsha='3bfe88d006fe391cf108a3ca1406b383b5c06c918185d35809767aa066791d8d' if folder==V2 else '4773fc821984503afb0f0367482bad10736ac0e8cd64b930d169426a76e23f5c'
  need(len(pins['files'])==want and sha(raw(tools+'/tool-pins.json'))==wantsha,'original tool manifest')
  for pin in pins['files']:
   b=raw(tools+'/'+pin['path']);need(len(b)==pin['bytes'] and sha(b)==pin['sha256'],'every tool payload SHA')
  execution=doc(tools+'/execution.json');need(execution['complete'] and execution['exitCode']==execution['native']['exitCode']==execution['analysis']['exitCode']==0 and execution['performanceAcceptance'] is False,'original executions complete without acceptance claim')
  captures[folder]=code;runrows.append({'directory':folder,'head':HEAD,'sourceInputs':241,'allPortableGitBytesExact':True,'originalExecution':execution})
 code=captures[V2];need(code==captures[NAV]==json.loads(gz(REF+'/source-inputs.json.gz')),'both current graphs equal separate historical oracle graph')
 for path in [V2+'-tools/source-before-inputs.json.gz',NAV+'-tools/source-before-inputs.json.gz',NAV+'-tools/prepared-source-before-inputs.json.gz']:need(json.loads(gz(path))==code,'all actual/prepared before source graphs exact')
 need(gz(REF+'/command-frames.jsonl.gz')==commands and gz(REF+'/initial-snapshot.json.gz')==initial and doc(REF+'/environment.json')['gitHead']==HEAD,'separate historical original semantic/source reference')
 # Reuse the frozen independent readers' numeric source only. Their outer
 # filesystem/Git execution and report-writing sections are not executed.
 common={'need':need,'sha':sha,'raw':raw,'doc':doc,'gz':gz,'intv':intv,'math':math,'struct':struct,'collections':collections,'json':json,'gzip':gzip,'Path':PurePosixPath,'capture':code,'SOURCE':PurePosixPath(SOURCE.rstrip('/')),'REF':PurePosixPath(REF)}
 v2reader=raw('/tmp/ship-sweep-capture-v2-independent-review-v1/review.py').decode();v2body='def buffers(prefix):'+v2reader.split('\ndef buffers(prefix):',1)[1].split("\nneed(git('rev-parse'",1)[0];v2ns={**common,'TOOLS':PurePosixPath(V2+'-tools'),'OUT':PurePosixPath(V2)};exec(compile(v2body,'frozen-v2-numeric-reader','exec'),v2ns)
 recorded_v2=doc('/tmp/ship-sweep-capture-v2-independent-review-v1/report.json');need(recorded_v2['complete'] and recorded_v2['naval']['counterfactualRows']==v2ns['counterfactual'] and recorded_v2['naval']['requiresRoadIndices']==v2ns['required']==[6,9,10,11] and recorded_v2['naval']['higherThreatSkipIndices']==v2ns['high']==list(range(6)) and recorded_v2['naval']['lowerBoundSkipIndices']==v2ns['bounded']==[7,8],'full naval counterfactual arithmetic reproduces')
 need(recorded_v2['naval']['candidateWasExecuted'] is recorded_v2['naval']['candidateMissCountMeasured'] is recorded_v2['naval']['timeSavingMeasured'] is False,'no measured candidate result')
 need(recorded_v2['physics']['sameRootBitExactScalarDuplicateGroups']==v2ns['duplicates'] and len(v2ns['duplicates'])==2 and recorded_v2['physics']['supportsBroadCacheImplementation'] is False,'physical limited repeated-input negative evidence')
 navreader=raw('/tmp/ship-nav-hull-9375-independent-review-v1/review.py').decode();marker="meta=doc(OUT/'nav-hull-capture.json')";need(marker in navreader,'frozen nav numeric source marker');navbody=marker+navreader.split(marker,1)[1].split("\nneed(raw(TOOLS/'original-ship-navigation.ts')",1)[0];navns={**common,'TOOLS':PurePosixPath(NAV+'-tools'),'OUT':PurePosixPath(NAV)};exec(compile(navbody,'frozen-nav-executed-prefix-reader','exec'),navns)
 recorded_nav=doc('/tmp/ship-nav-hull-9375-independent-review-v1/report.json');need(recorded_nav['complete'] and recorded_nav['allHull']==navns['all_counts'] and recorded_nav['withinPlanShipRouteImpl']==navns['inside'] and recorded_nav['outsidePlanShipRouteImpl']==navns['outside'],'all native prefix counts reproduce')
 need(recorded_nav['completeRebuiltCallFactsSha256']==sha(json.dumps(navns['facts'],separators=(',',':'),allow_nan=False).encode()) and recorded_nav['allActualAdjacentPairBitsExact'],'every actual raw endpoint pair reproduces')
 for report in [recorded_v2,recorded_nav]:
  for pin in report['inputPins']:
   path=pin['path'];b=code[path[len(SOURCE):]].encode() if path.startswith(SOURCE) else raw(path);need(len(b)==pin['bytes'] and sha(b)==pin['sha256'],('original independent read pin',path))
 # Stream phase/entity/owner data for the first diagnostic too. The frozen
 # nav numeric reader already checks all second-diagnostic phase rows.
 phase=navns['stream_array'];one=phase(PurePosixPath(V2+'/ticks.json.gz'));prior=phase(PurePosixPath(REF+'/ticks.json.gz'));count=0;planning=0
 for tick in range(14400):
  a=next(one);b=next(prior);need(all(a[k]==b[k] for k in ['tick','tickAfter','mod15','units','buildings']) and a['tick']==tick and a['tickAfter']==tick+1 and a['mod15']==tick%15,'first diagnostic complete original phase')
  owners=[(r['owner'],r['version']) for r in a['ownerPlans']];need(owners==[(r['owner'],r['version']) for r in b['ownerPlans']],'first diagnostic complete original owner order')
  if owners:need(len(owners)==5 and tick%15==0,'first diagnostic five owners original phase');planning+=1
  count+=1
 need(next(one,None) is None and next(prior,None) is None and planning==960,'first diagnostic full phase array')
 plans='/tmp/terrain-cache-followup-native-review-tools/';old_plan=doc(plans+'naval-mine-pruning-plan.prepared.json');status=doc(plans+'naval-only-plan-status.json');pending=doc(plans+'naval-hull-combined-plan.prepared.json')
 need(status['status']=='NOT_EXECUTED_SUPERSEDED_BEFORE_ANY_NATIVE_LAUNCH' and status['preparedPlanSha256']==sha(raw(plans+'naval-mine-pruning-plan.prepared.json')) and pending['status']=='SOURCE_PREPARATION_ONLY_NOT_EXECUTABLE' and pending['candidateHead'] is pending['sourceAfter'] is None,'unexecuted plans are historical provenance only')
 return {'complete':True,'scope':'rules3-stage12-focused-inputs','completedOriginalDiagnosticRuns':2,'runtimeBaselineHead':HEAD,'nativeSourceGraphs':2,'nativeSourceRecords':482,'historicalOracleSourceGraphs':1,'beforeSourceGraphs':3,'candidateNativeRuns':0,'candidateCountLimitedToThisScope':True,'preparedStatusIsHistoricalNotCurrentGlobalExecutionStatus':True,'performanceAcceptance':False,'wholePerformanceGoalEstablished':False,'runs':runrows,'allFullCommandsAndInitialBytesEqual':True,'commandBytes':len(commands),'commandSha256':sha(commands),'finalChecksum':'7d94a5e8','rulesVersion':3,'checksumVersion':18,'phaseRowsCompared':{'sweepV2':count,'nav9375':navns['count']},'physicalLimitedRepetition':recorded_v2['physics'],'navalCounterfactualOnly':recorded_v2['naval'],'navHullActualExecutedPrefix':{'allHull':navns['all_counts'],'withinPlan':navns['inside'],'outsidePlan':navns['outside'],'uncomputedSubdivisionCalls':recorded_nav['uncomputedSubdivisionCalls'],'pairsAreRawBitsWithinSameCall':True},'preparedPlansRemainUnexecutedHistoricalProvenance':True,'noNewApplicationExecution':True,'noTimingGainOrVerticesEquivalenceClaim':True}
if __name__=='__main__':
 result=main()
 if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
 else:need(result==json.loads((ROOT/'analysis.json').read_bytes()),'stored analysis exact deterministic readback')
 print(json.dumps({'complete':True,'completedDiagnosticRuns':2,'candidateNativeRuns':0,'candidateCountLimitedToThisScope':True,'preparedStatusIsHistoricalNotCurrentGlobalExecutionStatus':True,'performanceAcceptance':False,'physicalExtraRepeats':2,'navalCounterfactualSkip':8,'actualHullAdjacentPairs':2980}))
