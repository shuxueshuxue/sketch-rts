"""Execute one authorized archive step with bounded disk metadata and safe process tracing."""
import datetime,hashlib,json,os,signal,shutil,subprocess,sys,threading,time,urllib.parse,math
from pathlib import Path
T=Path(__file__).resolve().parent;R=Path('/tmp/whole-stage67-evidence-repo');P=R/'docs/performance/rules3-stage15-sea-distance-frontiers';G=R/'.git';O=G/'objects';MiB=1024*1024
label=sys.argv[1];args=sys.argv[2:];assert args[0]=='--';argv=args[1:];assert argv;reportPath=T/(label+'-execution.json');assert not reportPath.exists();plan=json.loads((T/'STORAGE-PLAN-ONECOPY.json').read_bytes());baselinePath=T/'GIT-OBJECT-BASELINE.json'
def files(root):return {str(p.relative_to(root)):p.stat().st_blocks*512 for p in root.rglob('*') if p.is_file() and not p.is_symlink()} if root.exists() else {}
if not baselinePath.exists():baselinePath.write_text(json.dumps({'files':files(O),'indexBytes':(G/'index').stat().st_size},indent=2)+'\n')
oldObjects=json.loads(baselinePath.read_bytes())['files'];beforeFree=shutil.disk_usage('/tmp').free;assert beforeFree>=32*MiB,beforeFree
isPush='push' in argv and argv[0]=='git';env=os.environ.copy();env['PYTHONDONTWRITEBYTECODE']='1'
for k in ['GIT_TRACE','GIT_TRACE_PACKET','GIT_TRACE_CURL','GIT_CURL_VERBOSE','GIT_TRACE2_CONFIG_PARAMS','GIT_TRACE2_ENV_VARS','GIT_TRACE2_EVENT']:env.pop(k,None)
traceRows=[];traceErrors=[];rfd,wfd=os.pipe();env['GIT_TRACE2_EVENT']=str(wfd)
def safeArgv(values):
 if any(('credential' in s.lower() or 'askpass' in s.lower()) for s in values):return ['<authentication helper argv omitted>']
 result=[]
 for v in values:
  if '://' in v:
   u=urllib.parse.urlsplit(v);v=urllib.parse.urlunsplit((u.scheme,u.hostname or '',u.path,'',''))
  result.append(v)
 return result
def trace():
 with os.fdopen(rfd,'r') as f:
  for line in f:
   try:r=json.loads(line)
   except Exception:traceErrors.append('malformed process trace event');continue
   if r.get('event') not in ['version','start','child_start','child_exit','exec','exit','atexit']:continue
   keep={k:r[k] for k in ['event','sid','thread','time','child_id','pid','code','t_rel'] if k in r}
   if 'argv' in r:
    a=r['argv'];keep['argv']=safeArgv(a)
    if 'pack-objects' in a:
     keep['packStdoutVerified']='--stdout' in a
     if '--stdout' not in a:traceErrors.append('pack-objects missing --stdout')
   traceRows.append(keep)
thread=threading.Thread(target=trace,daemon=True);thread.start();start=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.perf_counter();samples=[];violations=[]
with (T/(label+'.stdout.log')).open('xb') as stdout,(T/(label+'.stderr.log')).open('xb') as stderr:
 proc=subprocess.Popen(argv,cwd=T,stdout=stdout,stderr=stderr,env=env,pass_fds=(wfd,),start_new_session=True);os.close(wfd)
 while True:
  free=shutil.disk_usage('/tmp').free;objects=files(O);newObjects=sum(n for p,n in objects.items() if p not in oldObjects);archive=sum(files(P).values());locks={str(p):p.stat().st_blocks*512 for p in G.glob('*.lock') if p.is_file()};newPacks=[p for p in objects if p.startswith('pack/') and p not in oldObjects]
  tools=sum(files(T).values())+sum(files(Path('/tmp/whole-stage15-analysis-source-v1')).values());lockTotal=sum(locks.values())+max(0,(G/'index').stat().st_blocks*512+sum(p.stat().st_blocks*512 for p in G.glob('sharedindex*') if p.is_file())-math.ceil(plan['currentIndexBytes']/4096)*4096);allNew=tools+archive+newObjects+lockTotal
  sample={'allNewBytes':allNew,'toolsPortableBytes':tools,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freeBytes':free,'scopeBytes':archive,'newObjectBytes':newObjects,'indexBytes':(G/'index').stat().st_size,'locks':locks,'newPackFiles':newPacks};samples.append(sample)
  if free<32*MiB:violations.append('free fell below32MiB safety stop')
  if archive>4*MiB:violations.append('scope worktree exceeded4MiB')
  if newObjects>31*MiB:violations.append('new objects exceeded31MiB')
  if tools>10*MiB:violations.append('tools and analysis exceeded10MiB')
  if allNew>40*MiB:violations.append('ALL new allocated bytes exceeded40MiB')
  if lockTotal>4*MiB:violations.append('Git index and lock exceeded4MiB')
  if newPacks:violations.append('unexpected client pack/spool file')
  if traceErrors:violations.extend(traceErrors)
  if violations and proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM)
  status=proc.poll()
  if status is not None:break
  time.sleep(.1)
thread.join(timeout=5);assert not thread.is_alive(),'trace pipe still held after owned process exit'
packRows=[r for r in traceRows if 'pack-objects' in r.get('argv',[])]
if isPush and status==0 and not packRows:violations.append('push completed without observed pack-objects argv')
row={'schema':1,'argv':argv,'cwd':str(T),'startedAt':start,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wallSeconds':time.perf_counter()-clock,'exitCode':status,'freeBeforeBytes':beforeFree,'minimumFreeBytes':min(r['freeBytes'] for r in samples),'hard32MiBReservePreserved':all(r['freeBytes']>=32*MiB for r in samples),'maxScopeBytes':max(r['scopeBytes'] for r in samples),'maxNewObjectBytes':max(r['newObjectBytes'] for r in samples),'maximumAllNewAllocatedBytes':max(r['allNewBytes'] for r in samples),'maximumToolsPortableAllocatedBytes':max(r['toolsPortableBytes'] for r in samples),'metadataSamplingSeconds':.1,'sampleCount':len(samples),'violations':violations,'safeFilteredTraceOnly':True,'noRawTraceOrCredentialProtocolLogWritten':True,'packObjectsArgv':packRows,'allObservedPackObjectsUseStdout':all(r['packStdoutVerified'] for r in packRows),'newClientPackFileObserved':any(r['newPackFiles'] for r in samples)}
for key in ['stdout','stderr']:
 b=(T/(label+'.'+key+'.log')).read_bytes();row[key]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
(T/(label+'-disk-samples.json')).write_text(json.dumps(samples,separators=(',',':'))+'\n');(T/(label+'-process-events.json')).write_text(json.dumps(traceRows,separators=(',',':'))+'\n');reportPath.write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row));print((T/(label+'.stdout.log')).read_text()[:2500]);print((T/(label+'.stderr.log')).read_text()[:2500]);sys.exit(status or bool(violations))
