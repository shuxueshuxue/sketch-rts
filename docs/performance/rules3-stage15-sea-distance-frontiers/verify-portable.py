"""Authenticate portable commits/trees/blobs and captured native source offline."""
import base64,gzip,hashlib,json,subprocess
from pathlib import Path
P=Path(__file__).resolve().parent;R=P.parents[2];m=json.loads((P/'manifest.json').read_bytes());records={base64.b64decode(r['originalPathBase64']).decode():r for r in m['files']};git=['git','-c','gc.auto=0','-c','maintenance.auto=false','-C',str(R)]
def oid(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def raw(name):
 r=records[name];b=gzip.decompress(subprocess.check_output(git+['cat-file','blob',r['storedGitBlobOid']]));assert len(b)==r['originalBytes'] and hashlib.sha256(b).hexdigest()==r['originalSha256'];return b
x=json.loads(gzip.decompress(raw('/tmp/whole-stage15-archive-tools/portable-local-heads.json.gz')));base=x['baseRequiredBeforeRehydration'];objects={}
for key,r in x['objects'].items():
 b=base64.b64decode(r['bodyBase64']);assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'] and oid(r['type'],b)==key;objects[key]=(r['type'],b)
b=base64.b64decode(x['baseCommitBodyBase64']);assert oid('commit',b)==base;objects[base]=('commit',b)
for key,value in x['baseTrees'].items():
 b=base64.b64decode(value);assert oid('tree',b)==key;objects[key]=('tree',b)
trees={}
for key,(kind,b) in objects.items():
 if kind=='tree':
  i=0;rows={}
  while i<len(b):
   space=b.index(b' ',i);end=b.index(b'\0',space);rows[b[space+1:end].decode()]=(b[i:space].decode(),b[end+1:end+21].hex());i=end+21
  assert i==len(b);trees[key]=rows
for head in x['heads']:
 todo=[head];seen=set()
 while todo:
  key=todo.pop()
  if key==base or key in seen:continue
  seen.add(key);assert key in objects and objects[key][0]=='commit'
  todo.extend(line.split()[1].decode() for line in objects[key][1].splitlines() if line.startswith(b'parent '))
def source_oid(head,name):
 key=objects[head][1].splitlines()[0].split()[1].decode()
 for part in name.split('/'):key=trees[key][part][1]
 return key
candidate='bccc987c8aac31889c2cf1b70bfbbe50f941a24a';count=0
for arm,head in [('A1',base),('B1',candidate)]:
 code=json.loads(gzip.decompress(raw('/tmp/whole-performance-abba-0ea-sea-distance-frontiers-r1/'+arm+'/source-inputs.json.gz')));assert len(code)==241
 for name,text in code.items():assert oid('blob',text.encode())==source_oid(head,name);count+=1
print(json.dumps({'complete':True,'localOnlyHeads':list(x['heads']),'deltaObjects':x['objectCount'],'deltaRawBytes':x['objectRawBytes'],'capturedBaseAndCandidateSourcePathsPortableAuthenticated':count,'allBaseTreeBodiesPreserved':len(x['baseTrees']),'localObjectAndRefWrites':False,'fullRestoreRequiresFetchedBase':base}))
