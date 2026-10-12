from pathlib import Path
import shutil,subprocess
base=Path('/tmp/mercenary-isolated');out=Path('/workspace/sketch-rts-units/docs/art/refactor/followup/mercenary')
for mode,patch in [('old-cost','Object.assign(UNIT_DEFS.priest,{cost:130});'),('old-time','Object.assign(UNIT_DEFS.priest,{trainTime:175});'),('old-cost-time','Object.assign(UNIT_DEFS.priest,{cost:130,trainTime:175});'),('extended','')]:
 for source in (['981','9de'] if mode=='extended' else ['9de']):
  label=source+'-'+mode;p=base/label
  if p.exists():shutil.rmtree(p)
  shutil.copytree(base/source,p,symlinks=True)
  f=p/'src/ai/bootstrap_1/mercenary-control.test.ts';s=f.read_text();s=patch+'\n'+s
  s=s.replace(str(out/source),str(out/label))
  if mode=='extended':s=s.replace('tick < 2400','tick < 3000')
  f.write_text(s)
  with open(out/(label+'.log'),'w') as log:r=subprocess.run(['/workspace/sketch-rts-units/node_modules/.bin/vitest','run','src/ai/bootstrap_1/mercenary-control.test.ts'],cwd=p,stdout=log,stderr=subprocess.STDOUT)
  print(label,r.returncode,flush=True)
if Path(__file__).resolve() != (out/'isolate-variants.py').resolve(): shutil.copy2(__file__,out/'isolate-variants.py')
