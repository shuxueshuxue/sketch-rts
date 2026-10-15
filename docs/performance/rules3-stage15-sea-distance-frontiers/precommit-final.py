"""Close full auxiliary receipt bytes, exact naming, old tree and actual space."""
import base64,shutil,stat
import core
from core import *
state=json.loads(gzip.decompress((T/'OLD-STATE.json.gz').read_bytes()));original=core.command
core.command=lambda args,data=None,repo=None,journal='final-old-check-commands.jsonl':original(args,data,repo,journal)
old=core.old_check(state);m=json.loads((P/'manifest.json').read_bytes());aux=m['gitOnlySupportingFiles'][0];b=command(['cat-file','blob',aux['storedGitBlobOid']],journal='final-aux-check.jsonl');x=json.loads(gzip.decompress(b));witness=0
for r in x['files']:
 body=base64.b64decode(r['bodyBase64']);assert len(body)==r['bytes'] and sha(body)==r['sha256'];path=Path(base64.b64decode(r['originalPathBase64']).decode());assert path.read_bytes()==body and stat.S_IMODE(path.stat().st_mode)==int(r['mode'],8);witness+=len(body)
# Apply the exact original naming assertion only to this new staged scope, via
# logical Git bytes. This is not the old SDK test suite or its physical walker.
source=command(['show',BASE+':src/sdk/package-boundaries.test.ts'],repo='/tmp/sketch-rts-sea-distance-frontiers',journal='new-naming-commands.jsonl');assert b'"leg" + "acy"' in source
banned=b'leg'+b'acy';stage=command(['ls-files','--stage','-z'],journal='new-naming-commands.jsonl');scanned=0
for row in stage.split(b'\0'):
 if row:
  meta,name=row.split(b'\t')
  if name.startswith((S+'/').encode()):
   key=meta.split()[1].decode();body=subprocess.check_output(GIT+['cat-file','blob',key]);assert banned not in name.lower() and banned not in body.lower(),name;scanned+=1
result={'complete':True,'logicalReadback':json.loads((T/'logical-readback-report.json').read_bytes()),'auxiliaryReceiptFiles':len(x['files']),'auxiliaryFullBodyWitnessBytes':witness,'oldPreservation':old,'newScopeExactNamingScan':{'stagedFiles':scanned,'pass':True,'oldSdk14Rerun':False},'portableSourceClosure':'verify-portable.py PASS:25 delta objects/311171raw bytes;482 captured paths authenticated;637 base trees retained','generatedReceipts':'decode-storage-receipts.py PASS:1,862,598-byte original state gzip and2,328,884-byte original capture journal reconstructed exactly','goal':'FAILED','decision':'HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED','noProductOperation':True,'newFocusedAndScalarInputsExcluded':True,'oldSource1MiBPreparationBudgetExceptionRetained':True,'physicalPayloadWorkingCopies':0,'auxiliaryReceiptBundleMovedToGitOnlyAfterStaging':True}
write(P/'verified-closure.json',result);(P/'precommit-final.py').write_bytes(Path(__file__).read_bytes());m['supportingFiles']=sorted(p.name for p in P.iterdir() if p.is_file() and p.name!='manifest.json');write(P/'manifest.json',m)
print(json.dumps({'complete':True,'auxiliaryReceiptFiles':len(x['files']),'fullBodyWitnessBytes':witness,'newNamingScanned':scanned,'old':old}))
