"""SOURCE only: validate/read or restore portable objects after fetching BASE.

This script was not executed with --write during archive preparation. It never
fetches; a complete BASE graph must already be present in the destination.
"""
import argparse,base64,gzip,hashlib,json,os,pathlib,subprocess
HEAD='69e778602a5f8700c482574787cb7b82087ea713'
BASE='0ea5beaee063c8443d66f7654333032b070d51ad'
def main():
 p=argparse.ArgumentParser();p.add_argument('--objects',required=True);p.add_argument('--repo',required=True);p.add_argument('--write',action='store_true');a=p.parse_args()
 x=json.loads(gzip.decompress(pathlib.Path(a.objects).read_bytes()));assert x['head']==HEAD and x['baseRequiredBeforeRehydration']==BASE and set(x['objectOrder'])==set(x['objects']) and len(x['objectOrder'])==len(x['objects'])==x['objectCount']
 git=['git','-c','gc.auto=0','-c','maintenance.auto=false','-C',a.repo];env=os.environ.copy();env.update(GIT_NO_LAZY_FETCH='1',GIT_OPTIONAL_LOCKS='0')
 def cmd(args,data=None):return subprocess.check_output(git+args,input=data,env=env)
 cmd(['cat-file','-e',BASE+'^{commit}'])
 base_objects=cmd(['rev-list','--objects','--missing=print',BASE]);assert not any(r.startswith(b'?') for r in base_objects.splitlines()),'Fetch the full BASE graph first; this tool never fetches.'
 total=0
 for key in x['objectOrder']:
  r=x['objects'][key];assert r['type'] in ['commit','tree','blob'];b=base64.b64decode(r['bodyBase64'],validate=True);assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'];assert hashlib.sha1(r['type'].encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()==key;total+=len(b)
  if a.write:assert cmd(['hash-object','-w','-t',r['type'],'--stdin','--no-filters'],b).decode().strip()==key
 assert total==x['objectRawBytes'] and x['objects'][HEAD]['type']=='commit'
 ref='refs/evidence/stage16/'+HEAD[:12]
 if a.write:
  closure=cmd(['rev-list','--objects','--missing=print',HEAD,'^'+BASE]);assert not any(r.startswith(b'?') for r in closure.splitlines()),'Restored difference graph has missing objects'
  assert {r.split(b' ',1)[0].decode() for r in closure.splitlines()}==set(x['objects'])
  # Creation only. An existing evidence ref is preserved and causes failure.
  cmd(['update-ref',ref,HEAD,'0'*40])
 print(json.dumps({'verifiedObjects':len(x['objects']),'verifiedRawBytes':total,'head':HEAD,'baseRequired':BASE,'written':a.write,'createdEvidenceRef':ref if a.write else None,'networkUsed':False}))
if __name__=='__main__':main()
