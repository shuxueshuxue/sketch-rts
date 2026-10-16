"""Apply only the final production metadata explicitly supplied by parent.

Run after verify-and-prepare.py. Outputs stay in this external directory.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re

D = Path(__file__).resolve().parent
FINAL = 'e5663c338f9c544a5e65a66a6ed278d35f74a8f4'
candidate_path = D/'bootstrap-complete-games-20261015-index.67.candidate.json'
text = candidate_path.read_text()
old_text = (D/'canonical-index-59.original.json').read_text()
old = json.loads(old_text)
candidate = json.loads(text)
if len(candidate['packages']) != 67 or candidate['packages'][:59] != old['packages']:
    raise ValueError('Expected exact old59 plus verified8')
validation = json.loads(json.dumps(old['productionValidation']))
validation.update({
    'nativeBoundedMemo': {
        'head':'3ff9a747ae7aec4e5e66cc1198ef2baf9d2454b3',
        'testsPassedAcrossTwoRuns':24,'testFiles':4,'separateRunPassedCounts':[22,2],
        'typecheckExitCode':0,
        'countNote':'Two distinct runs; do not present as one24test run or add other batches into a new independent coverage total.',
        'integrationRecord':'bounded-memo-integration-20261016.json',
    },
    'careNativeFilter': {
        'head':'1e1de67c109d5e38c50b1ea728dabedaeedc52c1',
        'testsPassed':59,'testFiles':9,'typecheckExitCode':0,
        'integrationRecord':'care-native-filter-integration-20261016.json',
    },
    'deckRecovery': {
        'head':FINAL,'testsPassed':70,'testFiles':7,'typecheckExitCode':0,
        'integrationRecord':'deck-recovery-integration-20261016.json',
    },
    'newCombinedRootOrdinary0Completed':False,
    'currentCombinedSource':FINAL,
    'currentCombinedOrdinary0Status':'Not started at parent final-source declaration; planned sole known-development v9_archer versus frozenv8+v8.',
    'historical0fOrdinary0Attribution':'productionOrdinary0.source remains0f5bf01a;44441win is not transferred to this combined source.',
    'historicalChangedContinuations':'Care10200..43714 and deck hybrid41255 are not ordinary0 or final combined-source results.',
})
changes = {
    'productionHead':FINAL,
    'productionDelta':'On unchanged strategyBaseline3bdb: equivalent landingSpot distance reuse; real-ferry loading escort and occupied-deck yielding; actual mining destination accounting and native worker boarding-road safety; armed-worker defender-only score; frozen planner cwd/retry tool repair; pure exact solid configuration memo; reciprocal rendezvous actual-origin live-hull constraint;19ef shared native land-arrival/automatic-target queries;3ff9 exact solid-memo FIFO128 retention;1e1de native-arrival/pursuit care filter; e566 exposed deck-crew preservation through complete command planning. Rules2 and frozen184 remain unchanged. No ordinary0 has started on final combinatione5663c33 at this metadata declaration. Historical0f44441, care10200..43714 and hybriddeck41255 retain their own sources; none is a new combined-source ordinary0 score.',
    'productionValidation':validation,
}
for key,value in changes.items():
    match = re.search(r'^  "' + re.escape(key) + r'":\s*', text, flags=re.M)
    if not match:
        raise ValueError('Missing top-level metadata key: ' + key)
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    rendered = json.dumps(value,ensure_ascii=False,indent=2)
    rendered = rendered.replace('\n','\n  ')
    text = text[:match.end()] + rendered + text[match.end()+length:]
new = json.loads(text)
if new['packages'][:59] != old['packages'] or new['strategyBaseline'] != old['strategyBaseline']:
    raise ValueError('Historical package/strategy values changed')
changed = [key for key in old if old[key] != new[key] and key != 'packages']
if set(changed) != set(changes):
    raise ValueError('Unexpected nonpackage metadata change: ' + str(changed))
if new['productionOrdinary0'] != old['productionOrdinary0']:
    raise ValueError('Historical ordinary0 attribution changed')
def package_prefix(t):
    start = re.search(r'"packages"\s*:\s*\[',t).end()-1
    _,length=json.JSONDecoder().raw_decode(t[start:])
    return t[start+1:start+length-1].rstrip()
old_packages_text=package_prefix(old_text)
if not package_prefix(text).startswith(old_packages_text+',\n'):
    raise ValueError('Exact original59package text prefix changed')
candidate_path.write_text(text)
audit_path=D/'next-evidence-index-20261016.json'
audit=json.loads(audit_path.read_text())
audit.pop('originalTextBeforeInsertionAndMetadataSuffixVerbatim',None)
audit.pop('productionHeadRetainedPendingParentFinalSource',None)
audit['old59OriginalPackageTextVerbatim']=True
audit['allOtherIndexMetadataUnchanged']=all(old[key]==new[key] for key in old if key not in {'packages',*changes})
audit['authorizedNonpackageMetadataChanges']=changed
audit['productionHead']=FINAL
audit['finalCombinedProductionHeadProvided']=True
audit['metadataAuthority']='Explicit parent final-source message: e5663c33; rootmemo24/4 from22+2runs, care59/9, deck70/7; alltsc0; no ordinary0 started,0f44441andchangedcontinuations keep own source.'
audit['metadataFinalizedAtUtc']=datetime.now(timezone.utc).isoformat()
audit['candidateIndexSHA256']=hashlib.sha256(text.encode()).hexdigest()
audit_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'activeCandidate':str(candidate_path),'sha256':audit['candidateIndexSHA256'],
    'packages':len(new['packages']),'old59PackageValuesAndTextsExact':True,
    'authorizedMetadataChanges':changed,'productionHead':FINAL,
    'strategyBaseline':new['strategyBaseline'],'old0fOrdinary0Unchanged':True},ensure_ascii=False))
