from pathlib import Path
import subprocess,tarfile,io,os,shutil
out=Path('/workspace/sketch-rts-units/docs/art/refactor/followup/mercenary')
base=Path('/tmp/mercenary-isolated')
base.mkdir(exist_ok=True)
for label,repo,mode in [('981','/tmp/sketch-art-baseline','native'),('9de','/workspace/sketch-rts','native'),('9de-oldstats','/workspace/sketch-rts','old'),('981-newstats','/tmp/sketch-art-baseline','new')]:
 p=base/label;p.mkdir(exist_ok=True)
 data=subprocess.check_output(['git','archive',('9819046' if label.startswith('981') else '9de6820'),'src','package.json','tsconfig.json'],cwd=repo)
 with tarfile.open(fileobj=io.BytesIO(data)) as ar:ar.extractall(p)
 if not (p/'node_modules').exists(): (p/'node_modules').symlink_to('/workspace/sketch-rts-units/node_modules')
 f=p/'src/ai/bootstrap_1/mercenary-control.test.ts';s=f.read_text()
 prefix="import { writeFileSync } from 'node:fs';\n"
 if mode=='old':
  prefix+='Object.assign(UNIT_DEFS.priest, {hp:78,speed:62,attackDamage:6,attackRange:192,aimSpeed:480,cost:130,trainTime:175});\nObject.assign(UNIT_DEFS.summoner,{hp:88,speed:59,attackDamage:7,attackRange:208,aimSpeed:440,cost:174,trainTime:190});\n'
 if mode=='new':
  prefix+='Object.assign(UNIT_DEFS.emberAcolyte, {hp:90,speed:60,attackDamage:7,attackRange:201.6,aimSpeed:440,cost:135,trainTime:185});\nObject.assign(UNIT_DEFS.pyreCaller,{hp:95,speed:56,attackDamage:8,attackRange:218.4,aimSpeed:400,cost:180,trainTime:210});\n'
 s=prefix+s
 s=s.replace('it.each(cases)',"it.each(cases.filter(c => c.version === 'v9_archer' && c.race === 'ember' && c.economy === 'planner'))")
 s=s.replace('let paid = 0;', 'const trace: unknown[] = [], born = new Set(game.units.map(u=>u.id));\n  let paid = 0;')
 s=s.replace('for (const entry of entries) {', "trace.push(structuredClone({tick, gold:game.players.us!.gold, entries, mercenaries:game.units.filter(u=>u.kind==='mercenary').map(u=>({id:u.id,x:u.x,y:u.y,order:u.order})), queue:game.buildings.filter(b=>b.queue.length).map(b=>({kind:b.kind,queue:b.queue}))}));\n      for (const entry of entries) {")
 s=s.replace('stepGame(game);', "stepGame(game);\n    for(const u of game.units) if(!born.has(u.id)){born.add(u.id);trace.push({bornAt:tick+1,unit:structuredClone(u)});}")
 s=s.replace('expect(travelers.size, diagnostic)', f"writeFileSync({str(out/label)!r} + '-trace-' + mirror + '.json', JSON.stringify({{trace, final:JSON.parse(diagnostic), units:game.units, buildings:game.buildings}},null,2));\n  expect(travelers.size, diagnostic)")
 f.write_text(s)
 (out/(label+'-instrumented.patch')).write_text(subprocess.run(['git','diff','--no-index',str(Path(repo)/'src/ai/bootstrap_1/mercenary-control.test.ts'),str(f)],capture_output=True,text=True).stdout)
 with open(out/(label+'-instrumented.log'),'w') as log:
  result=subprocess.run(['/workspace/sketch-rts-units/node_modules/.bin/vitest','run','src/ai/bootstrap_1/mercenary-control.test.ts'],cwd=p,stdout=log,stderr=subprocess.STDOUT)
 print(label,result.returncode,flush=True)
if Path(__file__).resolve() != (out/'isolate-and-trace.py').resolve(): shutil.copy2(__file__,out/'isolate-and-trace.py')
