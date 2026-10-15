"""Bounded Git-logical Stage16 codec. No application execution."""
import base64,datetime,gzip,hashlib,io,json,os,stat,subprocess,time
from pathlib import Path
T=Path(__file__).resolve().parent
R=Path('/tmp/whole-stage67-evidence-repo')
S='docs/performance/rules3-stage16-sea-land-entry'
P=R/S
OLD='4a2a195f0cd4264ecab731f8314d191b1888dc48'
BASE='0ea5beaee063c8443d66f7654333032b070d51ad'
GIT=['git','-c','gc.auto=0','-c','maintenance.auto=false','-c','core.looseCompression=6','-c','core.compression=6','-c','pack.threads=1','-c','pack.windowMemory=8m','-c','pack.window=0','-C',str(R)]
MiB=1048576

def sha(b):return hashlib.sha256(b).hexdigest()
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(p,o):p.write_text(json.dumps(o,ensure_ascii=False,separators=(',',':'))+'\n')
def command(args,data=None,repo=None,journal='commands.jsonl'):
 argv=GIT+args if repo is None else GIT[:-2]+['-C',str(repo)]+args
 start=utc();p=subprocess.run(argv,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 row={'argv':argv,'cwd':str(T),'startedUTC':start,'endedUTC':utc(),'exitCode':p.returncode,'stdinBytes':len(data or b''),'stdinSha256':sha(data or b''),'stdoutBytes':len(p.stdout),'stdoutSha256':sha(p.stdout),'stderrBase64':base64.b64encode(p.stderr).decode()}
 if args[:2]==['cat-file','blob']:row['stdoutGitBlobLosslessReference']=args[-1]
 elif len(p.stdout)<4096:row['stdoutBase64']=base64.b64encode(p.stdout).decode()
 else:row['stdoutLosslessRepresentation']='Content addressed Git bodies/metadata; binary stdout SHA and full bodies independently retained.'
 with (T/journal).open('a') as f:f.write(json.dumps(row,separators=(',',':'))+'\n')
 assert p.returncode==0,(argv,p.returncode,p.stderr)
 return p.stdout

def inv_load():
 x=json.loads((T/'inventory-t0.json').read_bytes())
 for name in ['inventory-final-delta.json','inventory-t2-delta.json']:
  if (T/name).exists():
   d=json.loads((T/name).read_bytes());assert d['baseInventorySha256']==sha((T/'inventory-t0.json').read_bytes());x['roots']+=d['roots'];x['files']+=d['files'];x['objects']+=d['objects']
 return x

def source_path(inv,row):return Path(inv['roots'][row[0]][0])/row[1]
def full_read(path,n,h,mode):
 s=path.stat();assert not path.is_symlink() and stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==mode and s.st_size==n,str(path)
 b=path.read_bytes();a=path.stat();assert (s.st_mode,s.st_size,s.st_mtime_ns)==(a.st_mode,a.st_size,a.st_mtime_ns) and len(b)==n and sha(b)==h,str(path)
 return b

def zipped(b):
 out=io.BytesIO()
 with gzip.GzipFile(filename='',mode='wb',fileobj=out,compresslevel=6,mtime=0) as f:f.write(b)
 return out.getvalue()
def parse_tree(b):
 out={}
 for row in b.split(b'\0'):
  if row:
   meta,name=row.split(b'\t');mode,kind,key=meta.split();out[name.decode()]=[mode.decode(),kind.decode(),key.decode()]
 return out

def old_state():
 assert command(['rev-parse','HEAD']).decode().strip()==OLD and command(['status','--porcelain=v1'])==b''
 tree=command(['ls-tree','-r','-z',OLD]);entries=parse_tree(tree);assert len(entries)==20190
 stage=command(['ls-files','--stage','-z']);flags=command(['ls-files','-v','-z']);present=[];hNames=[]
 for row in flags.split(b'\0'):
  if row:
   flag,name=row[:1],row[2:].decode();p=R/name
   if flag==b'H':
    assert p.is_file() and not p.is_symlink();b=p.read_bytes();assert oid('blob',b)==entries[name][2];present.append([name,len(b),sha(b),stat.S_IMODE(p.stat().st_mode)]);hNames.append(name)
   else:assert flag==b'S' and not p.exists()
 assert len(present)==110 and len(entries)-len(present)==20080
 expectedStage=b''.join((entries[n][0]+' '+entries[n][2]+' 0\t'+n+'\0').encode() for n in sorted(entries));expectedFlags=b''.join((('H' if n in set(hNames) else 'S')+' '+n+'\0').encode() for n in sorted(entries));assert stage==expectedStage and flags==expectedFlags
 return {'head':OLD,'treeBytes':len(tree),'treeSha256':sha(tree),'stageBytes':len(stage),'stageSha256':sha(stage),'flagsBytes':len(flags),'flagsSha256':sha(flags),'present':present,'patternsBase64':base64.b64encode((R/'.git/info/sparse-checkout').read_bytes()).decode(),'indexBytes':(R/'.git/index').stat().st_size,'fullOldStdoutLosslesslyReconstructibleFromFixedGitTreeAnd110PresentNames':True}

def old_check(state,committed=False):
 before=parse_tree(command(['ls-tree','-r','-z',OLD]));current=parse_tree(command(['ls-tree','-r','-z','HEAD']));assert len(before)==20190 and all(current.get(n)==r for n,r in before.items());present={r[0] for r in state['present']}
 expectedStage=b''.join((before[n][0]+' '+before[n][2]+' 0\t'+n+'\0').encode() for n in sorted(before));expectedFlags=b''.join((('H' if n in present else 'S')+' '+n+'\0').encode() for n in sorted(before));stage=command(['ls-files','--stage','-z']);flags=command(['ls-files','-v','-z']);stageOld=b'\0'.join(r for r in stage.split(b'\0') if r and not r.split(b'\t',1)[1].startswith((S+'/').encode()))+b'\0';flagsOld=b'\0'.join(r for r in flags.split(b'\0') if r and not r[2:].startswith((S+'/').encode()))+b'\0';assert stageOld==expectedStage and flagsOld==expectedFlags and sha(stageOld)==state['stageSha256'] and sha(flagsOld)==state['flagsSha256']
 for n in before:
  if n not in present:assert not (R/n).exists()
 for n,nb,h,m in state['present']:full_read(R/n,nb,h,m)
 assert command(['status','--porcelain=v1'])==b'' if committed else command(['rev-parse','HEAD']).decode().strip()==OLD
 return {'oldModeBlobRows':20190,'oldFlagsFullBytesExact':True,'oldAbsentAllTrackedPaths':20080,'oldAbsentCanonicalPayloads':5491,'oldPresentFilesFullBytesModes':110}
