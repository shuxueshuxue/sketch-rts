"""Authenticate index/HEAD gzip blobs and all original bytes without hydration."""
import argparse,base64,gzip,hashlib,json,stat,subprocess
from pathlib import Path,PurePosixPath

def sha(b):return hashlib.sha256(b).hexdigest()
def oid(b):return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--scope',default=str(Path(__file__).resolve().parent));p.add_argument('--repo',default='/tmp/whole-stage67-evidence-repo');p.add_argument('--originals',action='store_true');p.add_argument('--hydrated',action='store_true');p.add_argument('--head',default='');p.add_argument('--report');a=p.parse_args();out=Path(a.scope);repo=Path(a.repo);prefix=str(out.relative_to(repo));m=json.loads((out/'manifest.json').read_bytes());aux=m.get('gitOnlySupportingFiles',[]);git=['git','-c','gc.auto=0','-c','maintenance.auto=false','-C',str(repo)]
 stage={}
 for row in subprocess.check_output(git+['ls-files','--stage','-z']).split(b'\0'):
  if row:
   meta,name=row.split(b'\t');mode,key,st=meta.split();assert st==b'0';stage[name.decode()]=(mode.decode(),key.decode())
 flags={r[2:].decode():r[:1] for r in subprocess.check_output(git+['ls-files','-v','-z']).split(b'\0') if r};canonical={};seen=set();expected={'manifest.json',*m['supportingFiles']};witness=0;decodedN=0;gzN=0
 proc=subprocess.Popen(git+['cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);streamH=hashlib.sha256();streamN=0
 try:
  for r in m['files']:
   original=base64.b64decode(r['originalPathBase64'],validate=True).decode();assert original.startswith('/') and original not in seen and '..' not in PurePosixPath(original).parts;seen.add(original)
   relative=PurePosixPath(r['storedPath']);assert not relative.is_absolute() and '..' not in relative.parts and str(relative).startswith('payloads/')
   name=prefix+'/'+str(relative);assert stage[name]==('100644',r['storedGitBlobOid']);assert (a.hydrated and (out/str(relative)).is_file()) or (not a.hydrated and flags[name]==b'S' and not (out/str(relative)).exists());expected.add(str(relative))
   if 'aliasOf' in r:
    first=canonical[r['aliasOf']];assert r['duplicateVerifiedByFullByteComparison']
    for k in ['storedPath','encoding','originalBytes','originalSha256','storedBytes','storedSha256','storedGitBlobOid']:assert r[k]==first[k]
   else:
    assert r['payloadId'] not in canonical;canonical[r['payloadId']]=r
   key=r['storedGitBlobOid'];proc.stdin.write((key+'\n').encode());proc.stdin.flush();header=proc.stdout.readline();assert header.split()==[key.encode(),b'blob',str(r['storedBytes']).encode()];packed=proc.stdout.read(r['storedBytes']);tail=proc.stdout.read(1);assert tail==b'\n';streamH.update(header+packed+tail);streamN+=len(header)+len(packed)+1
   if a.hydrated:assert (out/str(relative)).read_bytes()==packed
   assert oid(packed)==key and len(packed)==r['storedBytes'] and sha(packed)==r['storedSha256'];raw=gzip.decompress(packed);assert r['encoding']=='gzip' and len(raw)==r['originalBytes'] and sha(raw)==r['originalSha256']
   if 'aliasOf' not in r:decodedN+=len(raw);gzN+=len(packed)
   if a.originals:
    src=Path(original);s=src.stat();assert src.is_file() and not src.is_symlink() and stat.S_IMODE(s.st_mode)==int(r['originalMode'],8);assert src.read_bytes()==raw;witness+=len(raw)
   if a.head:
    assert subprocess.check_output(git+['rev-parse',a.head+':'+name]).decode().strip()==key
 finally:
  proc.stdin.close();err=proc.stderr.read();code=proc.wait();assert code==0 and err==b''
 for r in aux:
  name=prefix+'/'+r['storedPath'];assert stage[name]==('100644',r['storedGitBlobOid']) and flags[name]==b'S' and not (out/r['storedPath']).exists();b=subprocess.check_output(git+['cat-file','blob',r['storedGitBlobOid']]);assert oid(b)==r['storedGitBlobOid'] and len(b)==r['storedBytes'] and sha(b)==r['storedSha256'];d=gzip.decompress(b);assert len(d)==r['decodedBytes'] and sha(d)==r['decodedSha256'];expected.add(r['storedPath'])
 for name in {'manifest.json',*m['supportingFiles']}:
  b=(out/name).read_bytes();key=oid(b);assert stage[prefix+'/'+name]==('100644',key)
  if a.head:assert subprocess.check_output(git+['rev-parse',a.head+':'+prefix+'/'+name]).decode().strip()==key
 actual={str(p.relative_to(out)) for p in out.rglob('*') if p.is_file()};assert actual==(expected-{r['storedPath'] for r in aux} if a.hydrated else expected-{r['storedPath'] for r in m['files']}-{r['storedPath'] for r in aux});assert not any(p.is_symlink() for p in out.rglob('*'))
 tracked={n[len(prefix)+1:] for n in stage if n.startswith(prefix+'/')};assert tracked==expected
 result={'complete':True,'storageMethod':'Git logical, payload paths S and absent from first capture','sourcePaths':len(seen),'canonicalPayloads':len(canonical),'aliases':len(seen)-len(canonical),'uniqueDecodedRawBytes':decodedN,'storedCanonicalGzipBytes':gzN,'fullOriginalByteWitnessBytes':witness,'allGitHeadersOidsStoredHashesDecodedHashesVerified':True,'allAliasRelationsAndOriginalModesVerified':a.originals,'batchStdoutBytes':streamN,'batchStdoutSha256':streamH.hexdigest(),'batchStdoutFullBodiesRetainedAtGitOids':True,'oldSdk14Rerun':False,'applicationExecuted':False}
 if a.report:Path(a.report).write_text(json.dumps(result,separators=(',',':'))+'\n')
 print(json.dumps(result))
if __name__=='__main__':main()
