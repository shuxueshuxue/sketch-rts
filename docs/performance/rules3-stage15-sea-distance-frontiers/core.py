"""Bounded Git-logical Stage15 codec. No application execution."""
import base64,datetime,gzip,hashlib,io,json,os,stat,subprocess,time
from pathlib import Path
T=Path(__file__).resolve().parent
R=Path('/tmp/whole-stage67-evidence-repo')
S='docs/performance/rules3-stage15-sea-distance-frontiers'
P=R/S
OLD='63e274af2e243fd5aad3c8d1522c0805bda4c010'
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
 if len(p.stdout)<16384:row['stdoutBase64']=base64.b64encode(p.stdout).decode()
 else:row['stdoutLosslessRepresentation']='Content addressed Git bodies/metadata; binary stdout SHA and full bodies independently retained.'
 with (T/journal).open('a') as f:f.write(json.dumps(row,separators=(',',':'))+'\n')
 assert p.returncode==0,(argv,p.returncode,p.stderr)
 return p.stdout

def inv_load():
 x=json.loads((T/'inventory.json').read_bytes())
 if (T/'inventory-delta.json').exists():
  d=json.loads((T/'inventory-delta.json').read_bytes());assert d['baseInventorySha256']==sha((T/'inventory.json').read_bytes())
  x['roots']+=d['roots'];x['files']+=d['files'];x['objects']+=d['objects']
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
 assert command(['rev-parse','HEAD']).decode().strip()==OLD
 assert command(['status','--porcelain=v1'])==b''
 tree=command(['ls-tree','-r','-z',OLD]);entries=parse_tree(tree);assert len(entries)==18946
 flags=command(['ls-files','-v','-z']);stage=command(['ls-files','--stage','-z']);present=[];missing=[]
 for row in flags.split(b'\0'):
  if not row:continue
  flag,name=row[:1].decode(),row[2:].decode();p=R/name
  if p.exists():
   assert not p.is_symlink() and p.is_file();b=p.read_bytes();present.append([name,len(b),sha(b),stat.S_IMODE(p.stat().st_mode)]);assert oid('blob',b)==entries[name][2]
  else:assert flag=='S',name;missing.append(name)
 assert len(missing)==18852 and len(present)==94,(len(missing),len(present))
 patterns=(R/'.git/info/sparse-checkout').read_bytes()
 return {'head':OLD,'treeBase64':base64.b64encode(tree).decode(),'stageBase64':base64.b64encode(stage).decode(),'flagsBase64':base64.b64encode(flags).decode(),'patternsBase64':base64.b64encode(patterns).decode(),'present':present,'missing':missing,'indexBytes':(R/'.git/index').stat().st_size}

def old_check(state,committed=False):
 oldtree=base64.b64decode(state['treeBase64']);current=parse_tree(command(['ls-tree','-r','-z','HEAD']));before=parse_tree(oldtree)
 assert all(current.get(n)==r for n,r in before.items())
 stage=command(['ls-files','--stage','-z']);oldstage=base64.b64decode(state['stageBase64']);assert b'\0'.join(r for r in stage.split(b'\0') if r and not r.split(b'\t',1)[1].startswith((S+'/').encode()))+b'\0'==oldstage
 flags=command(['ls-files','-v','-z']);oldflags=base64.b64decode(state['flagsBase64']);assert b'\0'.join(r for r in flags.split(b'\0') if r and not r[2:].startswith((S+'/').encode()))+b'\0'==oldflags
 for n in state['missing']:assert not (R/n).exists()
 for n,nb,h,m in state['present']:full_read(R/n,nb,h,m)
 if committed:assert command(['status','--porcelain=v1'])==b''
 else:assert command(['rev-parse','HEAD']).decode().strip()==OLD
 return {'oldModeBlobRows':18946,'oldFlagsIdentical':True,'oldAbsentTrackedPaths':18852,'oldAbsentPayloads':4263,'oldPresentFilesFullBytesModes':len(state['present'])}
