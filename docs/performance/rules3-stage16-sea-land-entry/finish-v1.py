"""Close Stage16 archived bytes and receipts. No application execution."""
import base64,gzip,hashlib,io,json,math,shutil,stat,subprocess,sys,tarfile,zlib
from pathlib import Path
T=Path(__file__).resolve().parent;Q=Path('/tmp/whole-stage16-resume-source-v1');sys.path.insert(0,str(T));import core
sys.path.insert(0,str(Q));import adapter
phase=sys.argv[1];adapter.LABEL='finish-'+phase;core.command=adapter.command
from core import R,P,S,OLD,BASE,GIT,sha,oid,zipped,write
m=json.loads((P/'manifest.json').read_bytes());lookup={base64.b64decode(r['originalPathBase64']).decode():r for r in m['files']};state=json.loads(gzip.decompress((T/'OLD-STATE.json.gz').read_bytes()))
def blob(key):return subprocess.check_output(GIT+['cat-file','blob',key])
def raw(path):
 r=lookup[str(path)];b=blob(r['storedGitBlobOid']);assert sha(b)==r['storedSha256'];d=gzip.decompress(b);assert len(d)==r['originalBytes'] and sha(d)==r['originalSha256'];return d
def save_manifest():
 m['supportingFiles']=sorted(p.name for p in P.iterdir() if p.is_file() and p.name!='manifest.json');write(P/'manifest.json',m)
def stats(xs):
 a=sorted(xs);n=len(a);return {'count':n,'mean':sum(xs)/n,'median':a[math.ceil(n*.5)-1],'p95':a[math.ceil(n*.95)-1],'p99':a[math.ceil(n*.99)-1],'max':a[-1],'over16':sum(x>16 for x in xs),'over50':sum(x>50 for x in xs)}
def same(a,b):
 for k,v in a.items():assert abs(v-b[k])<1e-8,(k,v,b[k])
if phase=='prepare':
 old=core.old_check(state);decision=json.loads((P/'ROOT-DECISION.json').read_bytes());assert decision['status']=='REJECTED_NOT_ADOPTED' and decision['cold']['execution']=='NOT_RUN'
 package=json.loads(gzip.decompress(raw(T/'portable/local-head-objects.json.gz')));sourceRepo='/tmp/sketch-rts-sea-distance-frontiers';srcgit=GIT[:-2]+['-C',sourceRepo];objects=package['objects'];assert len(objects)==20
 for key,r in objects.items():
  b=base64.b64decode(r['bodyBase64']);assert len(b)==r['bytes'] and sha(b)==r['sha256'] and oid(r['type'],b)==key;assert subprocess.check_output(srcgit+['cat-file',r['type'],key])==b
 actual=set(subprocess.check_output(srcgit+['rev-list','--objects',package['head'],'^'+BASE]).decode().splitlines());assert {v.split()[0] for v in actual}==set(objects)
 sourceCache={};sourceRows=[];runs=[];pooled={'A':[],'B':[]};checks=[];probe=None;initial=None;commands=None
 for roundNo in [1,2]:
  for label in ['A1','B1','B2','A2','Bplain']:
   folder=Path('/tmp/whole-performance-abba-0ea-sea-land-entry-r'+str(roundNo))/label;summary=json.loads(raw(folder/'summary.json'));env=json.loads(raw(folder/'environment.json'));ticks=json.loads(gzip.decompress(raw(folder/'ticks.json.gz')));cmd=gzip.decompress(raw(folder/'command-frames.jsonl.gz'));init=gzip.decompress(raw(folder/'initial-snapshot.json.gz'));pr=raw(folder/'probe-source.ts');sources=json.loads(gzip.decompress(raw(folder/'source-inputs.json.gz')))
   assert len(ticks)==14400 and len(sources)==241 and len(env['sourceInputs'])==241;assert [r['tick'] for r in ticks]==list(range(14400));assert summary['rulesVersion']==3 and summary['checksumVersion']==18 and summary['finalChecksum']=='7d94a5e8' and summary['nonEmptyFrames']==612
   assert len(cmd)==618189 and sha(cmd)=='771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997';assert len(init)==147891 and sha(init)=='5375d4a54cf3e0cc1d4c614c4442b07118c1f1e0dd47b6ea96c73206c2b882c7'
   if probe is None:probe=pr;initial=init;commands=cmd
   assert pr==probe and init==initial and cmd==commands
   head=BASE if label.startswith('A') else package['head'];assert env['gitHead']==head
   for rec in env['sourceInputs']:
    path=rec['path'];body=sources[path].encode();assert len(body)==rec['bytes'] and sha(body)==rec['sha256'];key=head+':'+path
    if key not in sourceCache:sourceCache[key]=subprocess.check_output(srcgit+['cat-file','blob',key])
    assert sourceCache[key]==body;sourceRows.append([head,path,len(body),sha(body)])
   for metric in ['wholeMs','simMs','aiMs','renderSnapshotMs','observerMs']:
    vals=[t[metric] for t in ticks];assert all(math.isfinite(v) and v>=0 for v in vals)
   runs.append({'round':roundNo,'label':label,'ticks':len(ticks),'head':head,'sourceRecords':len(sources),'commandsSha256':sha(cmd),'initialSha256':sha(init),'probeSha256':sha(pr),'whole':stats([r['wholeMs'] for r in ticks]),'memorySamples':len(summary['memory']) if isinstance(summary['memory'],list) else summary['memory']})
   if label!='Bplain':pooled[label[0]]+=ticks
 for arm in ['A','B']:
  for metric in ['wholeMs','simMs','aiMs','renderSnapshotMs','observerMs']:same(stats([r[metric] for r in pooled[arm]]),decision['native']['pooled'][arm][metric])
  for name,wanted in [('planning',True),('nonplanning',False)]:
   for metric in ['wholeMs','simMs','aiMs','frameMs']:same(stats([r[metric] for r in pooled[arm] if (r['mod15']==0)==wanted]),decision['native']['planningAndNonplanning'][arm][name][metric])
 sourceStatement={'argv':srcgit+['cat-file','blob','HEAD:path (each exact head/path in sourceRowsSha256)'],'actualCommands':len(sourceCache),'sourceRows':sourceRows,'allFullGitBodiesEqualCapturedSources':True,'stdoutBodiesRetainedInFullOriginalSourceInputsAndGit':True,'startedEnded':'enclosed by finish-prepare execution receipt'}
 # Complete head/path list, no duplicate source bodies or stdout spool.
 write(P/'source241-readback.json',sourceStatement)
 write(P/'analysis.json',{'complete':True,'nativeRuns':runs,'sourceRecords':len(sourceRows),'portableDeltaObjects':len(objects),'allTenCommandsInitialProbeFullBytesEqual':True,'allPooledAndPlanningDistributionsRecomputedFromArchivedRaw':True,'allColdAndSlowRowsRetained':True,'BplainExcludedFromPool':True,'oldPreservation':old,'goal':'FAILED','decision':'REJECTED_NOT_ADOPTED','cold':'SOURCE_ONLY_NOT_BOUND_NOT_RUN','profileCounterAreInstrumentedDiagnosticsNotAcceptance':True,'oldSdk14Rerun':False})
 restoreBytes=sum(math.ceil(r['storedBytes']/4096)*4096 for r in m['files'] if 'aliasOf' not in r)
 write(P/'storage-method.json',{'method':'ONECOPY Git-logical schema3; gzip RAM/stdin to Git; payload S/absent from first capture','oldFixedHead':OLD,'rawOriginalsUntouched':True,'initialCapture01':{'exitCode':-15,'tools3MiBCapExceeded':True,'success':False,'logsRetained':True},'resumeSource':str(Q),'resumeSourceSealSha256':sha((Q/'SOURCE-SEAL.json').read_bytes()),'allNewCapBytes':30*1048576,'toolsQReviewCapBytes':5*1048576,'scopeAndMetadataObjectsCapBytes':2*1048576,'indexGrowthGuardBytes':2*1048576,'index1MiBNotProven':True,'index2MiBNotAMathematicalGuarantee':True,'indexWriteConfig':['-c','splitIndex.maxPercentChange=100'],'oldSharedIndexMtimeMayChangeButBodyMustRemainExact':True,'freeReserveBytes':32*1048576,'hydrateCanonicalBlocksBytes':restoreBytes,'hydrateRequireAtLeastBytes':restoreBytes+34*1048576,'hydratePatternChange':{'removeExactly':'!/'+S+'/payloads/','keepAllOtherPatternsByteForByte':True},'hydrateArgv':GIT+['-c','splitIndex.maxPercentChange=100','sparse-checkout','set','--no-cone','--stdin'],'hydrateStdin':'Current .git/info/sparse-checkout bytes with only the declared exclusion line removed. Check free gate first. Then verify-git.py --hydrated; old SDK14 needs all older scopes restored separately.','portableRestoration':'rehydrate-local-heads.py requires base0ea; authenticate every original type/body/OID before new evidence ref','auxiliaryReceipts':'Standard gzip tar, Git-only; all members contain complete original source/log bytes and modes. Tar names are original absolute paths without the leading slash. Never extract over original evidence.'})
 with (P/'README.zh.md').open('a') as f:f.write('\n实际续接：首轮capture-01因工具3MiB分项超限被guard终止（exit−15），不是PASS；原source与完整日志保留。续接使用新prefix和已封adapter，保留旧partial Git objects并重新比较全文。storage-method.json列精确恢复pattern、argv及空间门；analysis.json从归档raw重算10臂分布和2410份源码记录，Bplain保持独立。完整新增日志以标准tar/gzip的Git-only支持对象保存，tar成员名为原绝对路径去掉首个斜线，正文/权限可独立读回，不能覆盖原件。\n')
 (P/'finish-v1.py').write_bytes(Path(__file__).read_bytes());save_manifest();print(json.dumps({'complete':True,'runs':len(runs),'sourceRecords':len(sourceRows),'portableObjects':len(objects),'old':old}))
elif phase=='receipts':
 primary=set(lookup);o=io.BytesIO();members=[]
 with tarfile.open(fileobj=o,mode='w',format=tarfile.PAX_FORMAT) as tar:
  for root in [T,Q,Path('/tmp/stage16-index-space-independent-v1')]:
   for p in sorted(root.rglob('*')):
    if not p.is_file() or p.is_symlink() or str(p) in primary or p.name.startswith('finish-receipts') or p.name.startswith('receipts-03'):continue
    b=p.read_bytes();i=tarfile.TarInfo(str(p).lstrip('/'));i.size=len(b);i.mode=stat.S_IMODE(p.stat().st_mode);tar.addfile(i,io.BytesIO(b));members.append([str(p),len(b),sha(b),i.mode])
 decoded=o.getvalue();packed=zipped(decoded);assert len(packed)<=850000,len(packed);key=oid('blob',packed);assert adapter.command(['hash-object','-w','--stdin'],packed).decode().strip()==key
 relative='payloads/archive-receipts.tar.gz';name=S+'/'+relative;adapter.command(['update-index','-z','--index-info'],('100644 '+key+'\t'+name+'\0').encode());adapter.command(['update-index','--skip-worktree','-z','--stdin'],(name+'\0').encode());assert not (P/relative).exists()
 m['gitOnlySupportingFiles']=[{'storedPath':relative,'storedGitBlobOid':key,'storedBytes':len(packed),'storedSha256':sha(packed),'decodedBytes':len(decoded),'decodedSha256':sha(decoded),'format':'gzip tar; complete original members','memberCount':len(members)}];write(P/'archive-receipts-index.json',{'members':members,'allFullBytesAndModesRetained':True});save_manifest();print(json.dumps({'complete':True,'members':len(members),'gzipBytes':len(packed),'oid':key}))
elif phase=='stage':
 save_manifest();names=[S+'/'+p.name for p in P.iterdir() if p.is_file()];adapter.command(['add','--sparse','--']+sorted(names));print(json.dumps({'metadataStaged':len(names),'old':core.old_check(state)}))
elif phase=='check':
 old=core.old_check(state);m=json.loads((P/'manifest.json').read_bytes());aux=m['gitOnlySupportingFiles'][0];packed=blob(aux['storedGitBlobOid']);assert sha(packed)==aux['storedSha256'];members=json.loads((P/'archive-receipts-index.json').read_bytes())['members'];byName={p.lstrip('/'):(p,n,h,mode) for p,n,h,mode in members};witness=0
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress(packed)),mode='r:') as tar:
  assert set(tar.getnames())==set(byName)
  for member in tar:
   p,n,h,mode=byName[member.name];b=tar.extractfile(member).read();assert len(b)==n and sha(b)==h and member.mode==mode;assert Path(p).read_bytes()==b and stat.S_IMODE(Path(p).stat().st_mode)==mode;witness+=n
 banned=b'leg'+b'acy';scanned=0
 for row in subprocess.check_output(GIT+['ls-files','--stage','-z','--',S]).split(b'\0'):
  if not row:continue
  meta,name=row.split(b'\t');assert banned not in name.lower();b=blob(meta.split()[1].decode());assert banned not in b.lower(),name;scanned+=1
 print(json.dumps({'complete':True,'old':old,'auxMembers':len(members),'auxFullBodyWitnessBytes':witness,'newScopeExactNamingFiles':scanned,'oldSdk14Rerun':False}))
else:raise AssertionError(phase)
