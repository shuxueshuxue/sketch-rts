"""Verify only the new e566 ordinary0 package, then prepare external index68.

No archive extraction/copy, root writes, stage, tests or native simulation.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import gzip
import hashlib
import json
import re
import subprocess
import tarfile

OUT=Path(__file__).resolve().parent
REPO=Path('/workspace/sketch-rts-bootstrap-resume')
BASE='dc958b292c7757b146275a1e7fa6d1b58aa6a564'
HEAD='e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
ROOT_INDEX='docs/engineering/bootstrap_1/overseas-assault-20261015/bootstrap-complete-games-20261015-index.json'
ARCHIVE=Path('/workspace/.playtest/bootstrap-combined-e566-terminal-audit-20261016/complete-e566-ordinary0-evidence.tar.gz')
EXPECTED_BYTES=23789538
EXPECTED_SHA='585c209b4ec89e7ad80563c16ea0820723359b1397fcd6f06208615d532348ee'
MANIFEST='EVIDENCE-INDEX.json'
KEEP={MANIFEST,'audit/delivery-summary.json','audit/ledger-audit.json',
    'audit/window43200-43714.json','audit/prior-care-case-attribution-errata.json',
    'audit/independent-source-factory-seal.json'}

def sha(b):return hashlib.sha256(b).hexdigest()
def dump(name,value):(OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git','-C',str(REPO),*args])
def canonical(name):
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe archive member: '+name)
    return str(p)
def read_json(b):
    def pairs(items):
        out={}
        for key,value in items:
            if key in out:raise ValueError('Duplicate manifest JSON key: '+key)
            out[key]=value
        return out
    return json.loads(b,object_pairs_hook=pairs)
def value_span(text,key):
    match=re.search(r'^  "'+re.escape(key)+r'":\s*',text,flags=re.M)
    if not match:raise ValueError('Missing top-level key: '+key)
    _,n=json.JSONDecoder().raw_decode(text[match.end():])
    return match.end(),match.end()+n
def replace_value(text,key,value):
    a,b=value_span(text,key)
    rendered=json.dumps(value,ensure_ascii=False,indent=2).replace('\n','\n  ')
    return text[:a]+rendered+text[b:]
def array_span(text):
    start=re.search(r'"packages"\s*:\s*\[',text).end()-1
    _,n=json.JSONDecoder().raw_decode(text[start:])
    return start,start+n-1

old_bytes=git('show',BASE+':'+ROOT_INDEX)
if (OUT/'canonical-index-67.original.json').read_bytes()!=old_bytes:
    raise ValueError('Old67 original is not exactdc958 blob')
old=read_json(old_bytes)
if len(old['packages'])!=67 or old['productionHead']!=HEAD:
    raise ValueError('Expected current dc958 index67/e566 metadata')
observed_head_before=git('rev-parse','HEAD').decode().strip()
compressed_hash=hashlib.sha256();compressed_bytes=0
with ARCHIVE.open('rb')as inp:
    while chunk:=inp.read(1024*1024):compressed_hash.update(chunk);compressed_bytes+=len(chunk)
if compressed_bytes!=EXPECTED_BYTES or compressed_hash.hexdigest()!=EXPECTED_SHA:
    raise ValueError('New ordinary0 archive differs from declared SHA/bytes')
regular={};kept={};nonregular=[]
with ARCHIVE.open('rb')as raw,gzip.GzipFile(fileobj=raw)as gz:
    with tarfile.open(fileobj=gz,mode='r|')as tar:
        for member in tar:
            name=canonical(member.name)
            if member.isdir():continue
            if not member.isfile():nonregular.append(name);continue
            if name in regular:raise ValueError('Duplicate normalized regular member: '+name)
            digest=hashlib.sha256();size=0;capture=bytearray()if name in KEEP else None
            inp=tar.extractfile(member)
            while chunk:=inp.read(1024*1024):
                size+=len(chunk);digest.update(chunk)
                if capture is not None:capture.extend(chunk)
            if size!=member.size:raise ValueError('Actual read differs from tar header: '+name)
            regular[name]={'bytes':size,'sha256':digest.hexdigest()}
            if capture is not None:kept[name]=bytes(capture)
    while gz.read(1024*1024):pass
if nonregular or set(kept)!=KEEP:raise ValueError('Missing audit record or nonregular member')
manifest=read_json(kept[MANIFEST]);files=manifest['files'];expected_paths=set()
for row in files:
    name=canonical(row['path'])
    if name in expected_paths:raise ValueError('Duplicate manifest payload')
    expected_paths.add(name)
    if regular.get(name)!={'bytes':row['bytes'],'sha256':row['sha256']}:
        raise ValueError('Payload bytes/SHA mismatch: '+name)
if len(files)!=393 or len(regular)!=394 or set(regular)!=expected_paths|{MANIFEST}:
    raise ValueError('Full ordinary0 manifest count/coverage differs')
delivery=read_json(kept['audit/delivery-summary.json'])
ledger=read_json(kept['audit/ledger-audit.json'])
window=read_json(kept['audit/window43200-43714.json'])
erratum=read_json(kept['audit/prior-care-case-attribution-errata.json'])
source_seal=read_json(kept['audit/independent-source-factory-seal.json'])
assert delivery['head']==ledger['source']==window['head']==HEAD
assert delivery['result']==ledger['result']=={'tick':43714,'winner':'p0','completed':True}
assert delivery['terminal']==ledger['terminal']=={'p0':{'units':41,'buildings':29},'p1':{'units':0,'buildings':0},'p2':{'units':0,'buildings':0}}
assert delivery['rawLedgerCounts']==ledger['counts']
assert ledger['counts']['nativeUnitsLost']=={'p0':56,'p1':76,'p2':68,'player':0,'enemy':0,'enemy2':0,'neutral':19}
assert ledger['counts']['confirmedRemoved']==ledger['counts']['corpses']==219
assert ledger['allNativeLossLedgerAndCorpseExact']and ledger['allSamplesReconcile']and ledger['allHitIndicesAndCommandPhasesValid']
assert ledger['sampleCount']==74 and ledger['historicalComparableSampleCount']==74
assert ledger['allHistoricalWorldIdSetupEqual']and ledger['allHistoricalAvailable3memEqual']
assert delivery['historical']['worldIdSetupExactSavedCheckpoints']==74 and delivery['historical']['all3memExactAvailableSavedCheckpoints']==73
assert delivery['historical']['old0MemoryWitnessMissing']and delivery['historical']['currentFreshNullIndependentlyVerified']
assert window['allChecksExact']and all(window['checks'].values())
assert window['counts']['actualCommands']==window['counts']['expectedCommands']==163
assert window['counts']['actualHits']==window['counts']['expectedHits']==27
assert delivery['source']=={'sourceFilesExact':1462,'frozenArchivedFilesExact':497,'frozenManifestFilesExact':184,'independentSourceEvidence':'independent-source-factory-review.tar.gz'}
assert erratum['differentCases']and erratum['summoner7905']['setup']['map']=='greystonePass'and erratum['archer10200']['setup']['map']=='pineshade'

entry={'file':ARCHIVE.name,'bytes':EXPECTED_BYTES,'sha256':EXPECTED_SHA,
    'indexedPayloadFiles':393,'archiveRegularFiles':394,'payloadManifest':MANIFEST,'payloadHashesVerified':True,
    'source':HEAD+' actual fresh0 Grove v9_archer physicalside1 versus normal frozenv8 Ember+Grove; developed generated pineshade case',
    'classification':'Actual independently attributed e566 ordinary0 naturally43714p0win, both enemies0units/0buildings; own41units/29buildings/4halls and56permanent native losses incl1neutral.1462source/497historical/184manifest exact. Whole219confirmed deaths/corpses match all-owner stats;226death rows include7cleanup confirmations. Only43200..43714 terminal514native steps replay closed(world/id/3mem/setup/163commands/27hits), no unitdeath there.74savedworld/id/setup and73available3mem equal old5f; old0memory missing, newfreshnull separately verified. Known developed seed, not new tactical superiority/holdout/acceptance. Separate7905Ember summoner case is not this archer10200prefix; postseal erratum included.'}
if any(p['file']==entry['file']for p in old['packages']):raise ValueError('New package already indexed')
text=old_bytes.decode();start,close=array_span(text);insert_at=len(text[:close].rstrip())
rendered='\n'.join('    '+line for line in json.dumps(entry,ensure_ascii=False,indent=2).splitlines())
candidate=text[:insert_at]+',\n'+rendered+'\n  '+text[close:]
current={
    'source':HEAD,'family':'v9_archer','race':'grove','physicalSide':1,'factory':'pineshade',
    'actualMap':{'id':'ladder','width':4608,'height':4608},'generatedLayout':True,'factoryUnseenFlag':True,
    'seed':'bootstrap_1-unseen-archer-v8-v8-20261015-01','seedStatus':'known-developed','unseenGeneralization':False,
    'opponents':['normal frozenv8 Ember','normal frozenv8 Grove'],'opponentsSameTeam':True,
    'startingStateEach':{'gold':500,'workers':3,'supplyUsed':3,'supplyCap':8,'townHalls':1,'upgrades':'none','policyMemory':None},
    'ordinaryStartTick':0,'winTick':43714,'winner':'p0','naturalComplete':True,
    'enemyUnitsRemaining':0,'enemyBuildingsRemaining':0,'ownUnitsRemaining':41,'ownBuildingsRemaining':29,'ownHallsRemaining':4,
    'ownPermanentLosses':56,'ownTemporaryLosses':0,'ownLossesToNeutral':1,
    'sourceEvidence':{'selectedLiveFilesExact':1462,'historicalArchivedFilesExact':497,'frozenManifestFilesExact':184,
        'rulesVersion':2,'frozenManifestSHA256':delivery['case']['frozenManifestSHA256'],
        'reference':'audit/independent-source-factory-review.tar.gz',
        'runtimeDirectoryNote':'Original frozen temp directory was cleaned after process exit; audit verifies complete archived497 and actual pre/post hashes, not a fictitious reread of the removed directory.'},
    'completeLedger':{'reference':'audit/ledger-audit.json','nativeHits':3505,'acceptedPublicCommands':41213,'ownerPlans':8745,
        'nativeEvents':846,'deathStreamRows':226,'confirmedNativeRemovals':219,'nativeCorpses':219,'cleanupStatusUpdates':7,
        'nativeUnitsLost':ledger['counts']['nativeUnitsLost'],'allOwnerLossesAndCorpsesExact':True,'all74SamplesReconcile':True,
        'pendingNativeCleanup':0,'unconfirmedRemovals':0,'temporaryExpiries':0,'shipLossRows':0,
        'scope':'No ship loss or temporary expiry was exercised; zero observations are not general correctness proof.'},
    'terminalNativeReplay':{'reference':'audit/window43200-43714.json','from':43200,'to':43714,'nativeTicks':514,
        'full3AI':True,'checks':window['checks'],'acceptedCommandsExact':163,'nativeHitsExact':27,
        'unitDeathsDuringWindow':0,'scope':'Only the terminal514ticks, not an earlier death replay or another ordinary0.'},
    'comparisonToOld5f':{'savedWorldIdSetupExact':74,'availableSavedAll3MemoryExact':73,
        'old0MemoryWitnessMissing':True,'newFreshNullSeparatelyVerified':True,
        'scope':'Saved checkpoints only; no every-tick equivalence or new tactical superiority claim. New actual run remains e566 source attributed.'},
    'priorCareCaseErratum':{'reference':'audit/prior-care-case-attribution-errata.json',
        'originalPackageUnchanged':'bootstrap-care-native-filter-evidence.tar.gz',
        'correction':'7905/1079+1322 belongs to separate Ember summoner/greystonePass case, not this Grove archer pineshade10200 early causal prefix. The10200 continuation did not cover prior archer decisions from0; summoner1322 still needs its own full-game evidence.'},
    'completeAcceptance':False,'archive':ARCHIVE.name,
    'remainingScope':'One developed case, not all3families/singlefoes/sixpairs/officialmaps/unseen-seed acceptance; original inaccessible uncommitted changes remain unrecovered.'}
validation=json.loads(json.dumps(old['productionValidation']))
validation['currentCombinedOrdinary0Status']='Sealed actual fixede566 fresh0 natural43714p0WIN on known developed archer-v8+v8 case; both enemies0u0b, own41u29b/4halls,56permanent losses. Complete all-owner219removal/corpse ledger and only43200..43714 terminal514tick full3AI restore/163commands/27hits closure archived; no new holdout/tactical-superiority/acceptance claim.'
validation['currentCombinedOrdinary0Archive']=ARCHIVE.name
validation['currentCombinedOrdinary0SourceFilesExact']=1462
validation['currentCombinedOrdinary0LedgerAllOwnerExact']=True
validation['currentCombinedOrdinary0Terminal514ClosureExact']=True
delta=old['productionDelta']
needle='exact full source attribution/complete ledger archive follows separately.'
if needle not in delta:raise ValueError('Expected only the dc958 pending-ledger wording')
delta=delta.replace(needle,'complete1462source attribution, all-owner219removal/corpse ledger and terminal514tick full3AI closure are now sealed in complete-e566-ordinary0-evidence.tar.gz.')
candidate=replace_value(candidate,'productionDelta',delta)
candidate=replace_value(candidate,'productionValidation',validation)
if 'currentCombinedOrdinary0'in old:raise ValueError('Do not overwrite an existing currentCombinedOrdinary0 record')
end=candidate.rfind('}')
rendered=json.dumps(current,ensure_ascii=False,indent=2).replace('\n','\n  ')
candidate=candidate[:end].rstrip()+',\n  "currentCombinedOrdinary0": '+rendered+'\n}\n'
new=read_json(candidate)
assert len(new['packages'])==68 and new['packages'][:67]==old['packages']
old_start,old_close=array_span(text);new_start,new_close=array_span(candidate)
assert candidate[new_start+1:new_close].startswith(text[old_start+1:old_close].rstrip()+',\n')
assert new['productionOrdinary0']==old['productionOrdinary0']
oa,ob=value_span(text,'productionOrdinary0');na,nb=value_span(candidate,'productionOrdinary0')
assert text[oa:ob]==candidate[na:nb]
changed=[key for key in old if new[key]!=old[key]and key!='packages']
assert set(changed)=={'productionDelta','productionValidation'}
assert set(new)-set(old)=={'currentCombinedOrdinary0'}
assert new['productionHead']==old['productionHead']==HEAD and new['strategyBaseline']==old['strategyBaseline']
(OUT/'bootstrap-complete-games-20261015-index.68.candidate.json').write_text(candidate)
dump('new-entry-68.verified.json',entry)
dump('currentCombinedOrdinary0.json',current)
verification={'classification':'Independent streaming archive SHA/declared bytes/regular coverage and cross-record consistency only. Does not rerun native, ledger computation, source audit or historical comparisons.',
    'archive':str(ARCHIVE),'bytes':compressed_bytes,'sha256':compressed_hash.hexdigest(),
    'payloadCount':len(files),'regularMembersIncludingIndex':len(regular),'manifest':MANIFEST,'manifestSHA256':sha(kept[MANIFEST]),
    'allPayloadSHAAndDeclaredBytesExact':True,'allActualBytesMatchTarHeaders':True,'allRegularsExactlyCovered':True,
    'duplicateMembersRejected':True,'gzipCRCAndEOFVerified':True,'selectedAuditRecordsAgree':True,
    'inventory':regular,'sourceFactorySealAsArchived':source_seal}
dump('new-archive-stream-verification.json',verification)
audit={'createdAtUtc':datetime.now(timezone.utc).isoformat(),'baseDocsCommit':BASE,
    'rootHeadObservedBefore':observed_head_before,'rootHeadObservedAfter':git('rev-parse','HEAD').decode().strip(),
    'oldIndexSHA256':sha(old_bytes),'candidateIndexSHA256':sha(candidate.encode()),'oldPackages':67,'newPackages':68,
    'old67EachValueAndRawPackageTextExact':True,'old0fProductionOrdinary0ValueAndRawTextExact':True,
    'intentionalExistingMetadataChanges':changed,'addedMetadataKeys':['currentCombinedOrdinary0'],
    'allOtherMetadataUnchanged':all(new[k]==v for k,v in old.items()if k not in {'packages',*changed}),
    'productionHeadRetained':HEAD,'strategyBaselineRetained':old['strategyBaseline'],
    'rootCanonicalStillEqualsPinnedDc958':(REPO/ROOT_INDEX).read_bytes()==old_bytes,
    'rootWritesCopiesExtractionNativeTestsStagesCommits':False,'onlyNewPackageStreamVerified':True,
    'earlier67PackagesNotReverifiedOrRepacked':True,'originalUncommittedRecoveryGapRetained':True}
audit['activeCandidate']='bootstrap-complete-games-20261015-index.68.candidate.json'
audit['archive']={'file':ARCHIVE.name,'bytes':EXPECTED_BYTES,'sha256':EXPECTED_SHA,'payloads':393,'regularFilesIncludingIndex':394}
audit['files']={name:{'path':str(OUT/name),'bytes':(OUT/name).stat().st_size,'sha256':sha((OUT/name).read_bytes())}
    for name in ['bootstrap-complete-games-20261015-index.68.candidate.json','currentCombinedOrdinary0.json',
        'new-entry-68.verified.json','new-archive-stream-verification.json','README-append68.candidate.zh.md','verify-and-prepare68.py']
    if (OUT/name).is_file()}
audit['scriptUsage']='python '+str(OUT/'verify-and-prepare68.py')
dump('FINAL-DELIVERY68.json',audit)
print(json.dumps({**audit,'archiveBytes':compressed_bytes,'payloadsVerified':len(files)},ensure_ascii=False))
