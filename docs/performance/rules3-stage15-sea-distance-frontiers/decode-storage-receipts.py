"""Read-only reconstruction of generated receipt bodies; no original paths needed."""
import base64,gzip,hashlib,io,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def sha(b):return hashlib.sha256(b).hexdigest()
def check(repo):
 git=['git','-c','gc.auto=0','-c','maintenance.auto=false','-C',str(repo)];lite=json.loads(gzip.decompress((ROOT/'old-state-lossless.json.gz').read_bytes()));tree=subprocess.check_output(git+['ls-tree','-r','-z',lite['head']]);assert len(tree)==lite['treeStdoutBytes'] and sha(tree)==lite['treeStdoutSha256'];entries={}
 for r in tree.split(b'\0'):
  if r:
   meta,name=r.split(b'\t');mode,kind,key=meta.split();assert kind==b'blob';entries[name.decode()]=(mode.decode(),key.decode())
 names=sorted(entries);present={r[0] for r in lite['present']};stage=b''.join((entries[n][0]+' '+entries[n][1]+' 0\t'+n+'\0').encode() for n in names);flags=b''.join((('H' if n in present else 'S')+' '+n+'\0').encode() for n in names);assert sha(stage)==lite['stageStdoutSha256'] and sha(flags)==lite['flagsStdoutSha256']
 fields={**lite,'treeBase64':base64.b64encode(tree).decode(),'stageBase64':base64.b64encode(stage).decode(),'flagsBase64':base64.b64encode(flags).decode(),'missing':[n for n in names if n not in present]};s={k:fields[k] for k in lite['originalKeyOrder']};buffer=io.BytesIO()
 with gzip.GzipFile(filename='',mode='wb',fileobj=buffer,compresslevel=6,mtime=0) as f:f.write(json.dumps(s,separators=(',',':')).encode())
 assert len(buffer.getvalue())==lite['originalGzipBytes'] and sha(buffer.getvalue())==lite['originalGzipSha256']
 x=json.loads(gzip.decompress((ROOT/'capture-commands-lossless.json.gz').read_bytes()));rows=[]
 for row in x['rows']:
  r=dict(row)
  if '_stdoutGitOid' in r:
   b=subprocess.check_output(git+['cat-file','blob',r['_stdoutGitOid']]);assert len(b)==r['stdoutBytes'] and sha(b)==r['stdoutSha256'];r['stdoutBase64']=base64.b64encode(b).decode()
  ordered={k:r[k] for k in r['_keyOrder']};rows.append(json.dumps(ordered,separators=(',',':')).encode()+b'\n')
 b=b''.join(rows);assert len(b)==x['originalBytes'] and sha(b)==x['originalSha256'];return {'oldStateOriginalGzipReconstructedFullBytes':lite['originalGzipBytes'],'captureJournalOriginalReconstructedFullBytes':len(b),'allOriginalHashesEqual':True,'GitBodiesRetained':True}
if __name__=='__main__':
 import sys
 print(json.dumps(check(sys.argv[1] if len(sys.argv)>1 else '/tmp/whole-stage67-evidence-repo')))
