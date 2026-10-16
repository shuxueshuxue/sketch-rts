from pathlib import Path
import datetime,gzip,hashlib,json,subprocess,tarfile
D=Path('/workspace/.playtest/root-boarding-placement-integration-20261016');R=Path('/workspace/sketch-rts-bootstrap-resume');C=Path('/tmp/boarding-placement-clinical-e7-20261016')
sha=lambda b:hashlib.sha256(b).hexdigest()
specs=[
('/tmp/bootstrap-boarding-admission-readonly-review-20261016.tar.gz','659e68804c147b44948c155197ef9b77d5725a5fbc7cc98150e1297b05db1444','boarding-admission-independent-review-20261016/INDEX.json',3),
('/tmp/bootstrap-boarding-placement-e7-native-contracts-20261016.tar.gz','9d4181e39756dc72f8dcd690711d959f00fe8d7b593e00c8284d0a0103ed241c','boarding-placement-a7-20261016/INDEX.json',20),
('/tmp/bootstrap-boarding-placement-e7-single-board-clinical-20261016.tar.gz','e587e8d29b1cbe233c17edfac3212c3bd7898c2cc18cc48552816f8329319ede','boarding-placement-clinical-e7-20261016/INDEX.json',48),
('/workspace/.playtest/bootstrap-cabin-three-segment-public-clinical-20261016-evidence.tar.gz','b0b8a40bd5878a0da0e1d987c75cdf405528045e8de6764c6bbb2e7ea9c88a4c','cabin-clinical-three-segment-evidence-20261016/INDEX.json',1023)]
packages=[]
for name,expected,indexName,count in specs:
 p=Path(name);assert sha(p.read_bytes())==expected
 with tarfile.open(p)as t:
  members=[m for m in t.getmembers()if m.isfile()];names={m.name for m in members};assert len(names)==len(members)
  manifest=json.load(t.extractfile(indexName));rows=manifest['files'];assert isinstance(rows,list)and len(rows)==count
  mapped={}
  for row in rows:
   rel=row['path'];resolved=rel if rel in names else str(Path(indexName).parent/rel)
   assert resolved in names and resolved not in mapped,(name,rel)
   mapped[resolved]=row
  assert set(mapped)==names-{indexName}
  for path,row in mapped.items():
   data=t.extractfile(path).read();assert len(data)==row['bytes']and sha(data)==row['sha256'],(name,path)
  packages.append({'file':p.name,'sourcePath':str(p),'bytes':p.stat().st_size,'sha256':expected,'payloadManifest':indexName,'indexedPayloadFiles':count,'archiveRegularFiles':len(members),'allPayloadHashesBytesExactCoverageRootVerified':True})
initial=json.load(gzip.open(C/'input-208201.json.gz','rt'));final=json.load(gzip.open(C/'final.json.gz','rt'));report=json.load(open(C/'report.json'))
hull='unit-p0-carrier-25442';walker='unit-p0-ashHexer-23349';cohort={u['id']:u for u in initial['snapshot']['units']if u.get('deck',{}).get('shipId')==hull};assert len(cohort)==25
rows=[json.loads(l)for l in gzip.open(C/'states.jsonl.gz','rt')if l.strip()];after=[r for r in rows if r['stage']=='after-step'];assert len(after)==215 and [r['tick']for r in after]==list(range(208202,208417))
for r in rows:
 actual={u['id']:u for u in r['cohort']};assert set(actual)==set(cohort)
 for key,u in actual.items():assert u['owner']==cohort[key]['owner']=='p0'and u['hp']==cohort[key]['hp']>0 and u.get('deck',{}).get('shipId')==hull
 assert r['walker']['hp']==82 and r['walker']['owner']=='p0'
commands=[json.loads(l)for l in(C/'commands.jsonl').read_text().splitlines()if l.strip()];assert len(commands)==92
p0=[r for r in commands if r['owner']=='p0'];assert len(p0)==1 and p0[0]['tick']==208201 and p0[0]['command']=={'type':'board','unitIds':[walker],'transportId':hull}
assert set(r['owner']for r in commands[1:])=={'p1','p2'}and not(C/'hits.jsonl').read_text().strip()
plans=[json.loads(l)for l in(C/'plans.jsonl').read_text().splitlines()if l.strip()];assert len(plans)==42 and len([r for r in plans if r['owner']=='p0'and r['manualNoCommands']is True])==14
assert initial['memories']['p0']==final['memories']['p0']and initial['nextId']<=final['nextId']
units={u['id']:u for u in final['snapshot']['units']};cargo={k for k,u in units.items()if u.get('deck',{}).get('shipId')==hull};assert cargo==set(cohort)|{walker}
assert sum('cabin'in units[k]for k in cargo)==10 and units[walker]['deck']=={'shipId':hull,'x':116.16,'y':0.03999999999999204}
assert final['snapshot']['tick']==208416 and final['snapshot']['match']['winner']is None
def tree(rev):
 raw=subprocess.check_output(['git','-C',str(R),'ls-tree','-r','-z',rev,'--','src/shared','src/sdk']);return{r.split(b'\t',1)[1].decode():r.split(b'\t',1)[0].split()[-1].decode()for r in raw.split(b'\0')if r}
e7=tree('e7cdb8d67f8070a6548b527a25a38f62e18f0a0a');root=tree('HEAD');assert root==e7
for path,blob in root.items():
 b=(R/path).read_bytes();assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==blob,path
manifest=R/'docs/engineering/bootstrap_1/frozen-policy.json';assert sha(manifest.read_bytes())=='0490e7d43d109e70be3b141f76d1276a778a3402f3ea19f51a8cd37fee941774'
out={'classification':'Root independent sealed-payload verification and native raw effect audit. True215step single-public-board clinical, not autonomousAI or fullmatch. Source97 shared/SDK Git trees and live blobs exactly equal fixede7; no old1e ordinary0 score transfer.','atUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rootHead':subprocess.check_output(['git','-C',str(R),'rev-parse','HEAD'],text=True).strip(),'runtimeBefore':'1e955c0c5f1114812f873f9c3ba06fe7cb19cb1e','candidate':'e7cdb8d67f8070a6548b527a25a38f62e18f0a0a','nativeSdkFilesRootGitE7AndLiveExact':len(root),'frozenManifestSHA256':sha(manifest.read_bytes()),'packages':packages,'actualClinical':{'start':208201,'end':208416,'afterStepRows':len(after),'all215TicksOld25HPAndOwnerAndHullUnchanged':True,'initial25Final26ExactIds':True,'inside10Open16':True,'manualP0Commands':1,'normalEnemyCommands':91,'emptyP0Plans':14,'normalEnemyPlans':28,'hits':0,'p0MemoryUnchanged':True,'finalSHA256':sha((C/'final.json.gz').read_bytes()),'winner':None,'nativeGeometryPendingSeparatePureReview':True},'rootTests':{'scopedLog':'root-native-scoped.log','passed':139,'failed':2,'files':14,'knownBaselineFailure':'Both crew-rendezvous-coast sourceHP314.97705695148625 expected320 exactly reproduced on unmodifieda7, unchangedtransferdomain. Preserved failures, not allgreen.','tscExit':0,'wrongScopeAttempt':'Initialroot-native-related.log matched historical.playtestcopies because missing--dir; interrupted only ownVitest367419 exit130. Correct scoped log alone supplies counts.'}}
(D/'ROOT-NATIVE-BOARDING-REVIEW.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'packages':len(packages),'payloadFiles':sum(p['indexedPayloadFiles']for p in packages),'nativeSdkFilesExact':len(root),'actual215RawClinicalVerified':True}))
