from pathlib import Path
import json,hashlib,subprocess,sys,datetime,tarfile
sys.path.insert(0,'/workspace/.playtest/root-next-evidence-index72-20261016')
from stream_support import stream_archive,verify_dict_manifest,git_blob_inventory
R=Path('/workspace/sketch-rts-bootstrap-resume');D=Path('/workspace/.playtest/root-dock-integration-20261016');S=Path('/tmp/bootstrap-hurt-hull-dock-760-20261016')
sha=lambda b:hashlib.sha256(b).hexdigest()
(D/'FIRST-AUDIT-SCHEMA-ERROR.json').write_text(json.dumps({'classification':'Read-only first root audit exited1 at archive manifest schema: actual payloads map contains relative paths, script assumed files/entries. Full1477Git/live equivalence checks had already passed but no final artifact was written. No Game/query/step/data/source mutation. Corrected v2 uses exact actual schema and explicit archive prefix.','error':"KeyError: 'entries'",'runtimeFailure':False},indent=2)+'\n')
j=json.loads((S/'fixed-source.json').read_text());H=subprocess.check_output(['git','-C',str(R),'rev-parse','HEAD'],text=True).strip();assert H.startswith('f7f8747b')
hashes=j['hashes'];actual=set(subprocess.check_output(['git','-C',str(R),'ls-tree','-r','--name-only',H,'--','src','scripts','tools'],text=True).splitlines());assert actual=={p for p in hashes if p.startswith(('src/','scripts/','tools/'))}
root=git_blob_inventory(R,H,hashes);candidate=git_blob_inventory(R,j['head'],hashes)
for p,h in hashes.items():assert root[p]['sha256']==candidate[p]['sha256']==h==sha((R/p).read_bytes()),p
A=Path('/tmp/bootstrap-hurt-hull-dock-760-20261016.tar.gz');assert A.stat().st_size==6649570 and sha(A.read_bytes())=='7213474109f18bb06275d9ccbaa6a278835b2b11fc6cedd36b55ae8abb86eaaf'
prefix='bootstrap-hurt-hull-dock-760-20261016/';m=prefix+'INDEX.json'
with A.open('rb') as f:inv,kept=stream_archive(f,{m})
idx=json.loads(kept[m]);files={prefix+p:r for p,r in idx['payloads'].items()}
verify_dict_manifest(inv,files,m);assert len(files)==91 and len(inv)==92
# The source capsule has exactly1477 regular payloads, no extra index entry.
with (S/'fixed-source.tar.gz').open('rb') as f:src,_=stream_archive(f)
assert set(src)==set(hashes) and len(src)==1477
for p,r in src.items():assert r==root[p],p
rec={'atUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'classification':'Root1477 entire selected runtime/config/test/manifest Git blobs AND livefiles exactly equal fixeda53, including allGit src/scripts/tools file-set coverage; docs ancestry differs. Root independently streams all91 outer archive payloads/fullgzipCRC/exactcoverage plus every1477 inner source capsule payload matches root actual Git blobs. No Game/query/native/test.','rootRuntimeSource':H,'candidate':j['head'],'sourceScope':j['sourceScope'],'selectedFiles':len(hashes),'allSelectedRootGitCandidateGitAndWorkingBytesEqual':True,'srcScriptsToolsFileSetExact':True,'nestedSourceCapsuleEveryPayloadGitExact':1477,'rootNoRulesOrFrozenChange':True,'archive':str(A),'bytes':A.stat().st_size,'sha256':sha(A.read_bytes()),'payloadFiles':91,'archiveRegular':92,'payloadManifest':m,'validationReuse':{'candidateDistinctTests':20,'candidateTsc1024Exit':0,'rootDuplicateTestsRun':False,'reason':'No integration code/config difference: entire selected1477Git+live byte equality, no conflicts or additional production edits. Candidate tests/typecheck reused with explicit attribution.'},'normalFullGameOutcomeNotProven':True,'originalUncommittedGapRetained':True}
(D/'ROOT-SOURCE-AND-ARCHIVE-REVIEW.json').write_text(json.dumps(rec,ensure_ascii=False,indent=2)+'\n');print(json.dumps(rec,ensure_ascii=False,indent=2))
