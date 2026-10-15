"""Restore local-only commit objects into a repo that already has the base."""
import argparse,base64,gzip,hashlib,json,subprocess
p=argparse.ArgumentParser();p.add_argument('--objects',required=True);p.add_argument('--repo',required=True);p.add_argument('--write',action='store_true');a=p.parse_args()
x=json.loads(gzip.decompress(open(a.objects,'rb').read()));git=['git','-c','gc.auto=0','-c','maintenance.auto=false','-C',a.repo]
subprocess.run(git+['cat-file','-e',x['baseRequiredBeforeRehydration']+'^{commit}'],check=True)
for key,r in x['objects'].items():
 b=base64.b64decode(r['bodyBase64'],validate=True);assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'];assert hashlib.sha1(r['type'].encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()==key
 if a.write:
  out=subprocess.check_output(git+['hash-object','-w','-t',r['type'],'--stdin'],input=b).decode().strip();assert out==key
if a.write:
 missing=subprocess.check_output(git+['rev-list','--objects','--missing=print',*x['heads'],'^'+x['baseRequiredBeforeRehydration']]);assert not any(r.startswith(b'?') for r in missing.splitlines())
 for head in x['heads']:
  subprocess.run(git+['cat-file','-e',head+'^{commit}'],check=True)
  subprocess.run(git+['update-ref','refs/evidence/stage15/'+head[:12],head],check=True)
print(json.dumps({'verifiedObjects':len(x['objects']),'written':a.write,'baseRequired':x['baseRequiredBeforeRehydration'],'heads':list(x['heads'])}))
