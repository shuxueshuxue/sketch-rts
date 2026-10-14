#!/usr/bin/env python3
"""Offline strict 512-square double-slot uploader ABBA analysis. No browser; never modifies captures."""
import argparse, hashlib, json, math, subprocess
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser()
p.add_argument('--input',default='docs/art/refactor/followup/card-streaming/stall-followup/upload-double-slot-abba')
p.add_argument('--out')
p.add_argument('--pilot',action='store_true',help='Two arms, one lifetime each; never labelled balanced ABBA')
a=p.parse_args();root=Path(a.input).resolve();out=Path(a.out).resolve() if a.out else root/'analysis-strict'
out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
def same(x,y):return x==y
violations=[]
def check(ok,msg):
 if not ok:violations.append(msg)
def dist(values):
 v=sorted(values);n=len(v)
 return {'samples':n,'meanMs':sum(v)/n if n else None,**{f'p{q}Ms':v[max(0,math.ceil(q*n/100)-1)] if n else None for q in (50,95,99)},'maxMs':max(v) if n else None,'over16_7':sum(x>16.7 for x in v),'over50':sum(x>50 for x in v),'over100':sum(x>100 for x in v),'over250':sum(x>250 for x in v)}
def flatten(x,prefix=''):
 if isinstance(x,dict):
  d={}
  for k,v in x.items():d.update(flatten(v,prefix+'.'+k if prefix else k))
  return d
 return {prefix:x}
expected='8345a0dcfeb96b6777ac3940ec64cba13816c851'
arms=['original-A','candidate-B'] if a.pilot else ['original-A','candidate-B','candidate-B2','original-A2'];reports=[];inputs=[];captures={};images={}
for arm in arms:
 folder=root/arm;b=(folder/'raw.json').read_bytes();r=json.loads(b);captures[arm]=r;g=r['uploadIsolation'];mode='original' if arm.startswith('original') else 'candidate'
 inputs.append({'arm':arm,'rawSha256':sha(b)})
 check(r['completed'] and r['validation']['passed'] and not r['errors'] and not r['failed'],arm+' capture failed')
 check(r['sourceCommit']==g['expectedSourceCommit']==expected,arm+' source commit')
 check(g['policy']==mode and g['pilot']==a.pilot,arm+' provider policy/pilot scope')
 for field in ['currentSourceStayedFrozen','baselineSourceStayedFrozen','candidateSourceStayedFrozen','baselineRegionStayedFrozen','candidateRegionStayedFrozen','sourceMetadataStayedFrozen']:check(g[field],arm+' '+field)
 check(r['allClientSourceSha256']==g['finalClientSourceSha256'],arm+' client source maps differ')
 check(r['sourceGitDiffSha256']==sha(b''),arm+' client dirty')
 inv=g['sourceInventory'];check(inv['version']==2 and inv['expectedCommit']==expected,arm+' full-source v2 ABI')
 check(inv['sourceStayedFrozen'] and inv['helpersStayedFrozen'] and inv['sourceSha256']==inv['finalSourceSha256'],arm+' full-source freeze')
 tree=subprocess.check_output(['git','ls-tree','-r',expected,'src'],text=True)
 gitblobs={line.split('\t',1)[1]:line.split()[2] for line in tree.splitlines()}
 check(set(gitblobs)==set(inv['sourceSha256']),arm+' full Git source inventory')
 archived={}
 for entry in inv['sourceSnapshots']+inv['helperSnapshots']:
  data=(folder/entry['snapshot']).read_bytes();digest=sha(data);archived[entry['path']]=digest
  check(digest==entry['sha256'],arm+' archived '+entry['snapshot'])
  if 'relativePath' in entry:
   file=entry['relativePath'];blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
   check(digest==inv['sourceSha256'].get(file) and blob==gitblobs.get(file),arm+' Git blob '+file)
   if file.startswith('src/client/'):check(r['allClientSourceSha256'].get(file)==digest,arm+' client/full inventory '+file)
 check(inv['sourcePublicTree']==subprocess.check_output(['git','rev-parse',expected+':public'],text=True).strip(),arm+' public tree')
 for entry in inv['loadedModules']:check(entry['frozenRunStartBytes'] and archived.get(entry['path'])==entry['sha256'],arm+' loaded source/helper '+entry['path'])
 check(all(x['unchangedAtFinish'] for x in inv['thirdPartyModules']),arm+' third-party changed')
 source=folder/'source-snapshot'
 original=(source/'baseline-card-mip-uploader.ts').read_bytes();candidate=(source/'candidate-card-mip-uploader.ts').read_bytes()
 metadataBytes=(folder/'candidate-source-metadata.json').read_bytes();metadata=json.loads(metadataBytes)
 check(sha(metadataBytes)==g['sourceMetadataSha256'] and metadata==g['sourceMetadata'],arm+' source metadata')
 check(metadata['sourceCommit']==expected and sha(original)==metadata['sourceSha256']==g['baselineUploaderSha256']==g['currentUploaderSha256']==g['corpusUploaderSha256'] and sha(candidate)==metadata['candidateSha256']==g['candidateUploaderSha256'],arm+' provider SHA')
 # Candidate producer must supply explicit ordered, single-match source replacements.
 transformed=original
 replacements=metadata['replacements']
 check(bool(replacements),arm+' missing exact source patch manifest')
 for index,replacement in enumerate(replacements):
  before=replacement['before'].encode();after=replacement['after'].encode()
  check(bool(before) and transformed.count(before)==1,arm+' unique source patch '+str(index))
  transformed=transformed.replace(before,after,1)
 check(transformed==candidate,arm+' candidate changed outside declared complete source patch')
 for file,key in [('current-card-mip-uploader.ts','currentUploaderSha256'),('current-painted-card-batches.ts','currentBatchesSha256'),('current-card-pick-mask.ts','currentMaskSha256'),('current-card-raster-cache.ts','currentCacheSha256')]:check(sha((source/file).read_bytes())==g[key],arm+' source snapshot '+file)
 for prefix in ['baseline','current','candidate']:
  key=prefix+'RegionSha256';digest=g['dependencies'][key]
  if digest is not None:check(sha((source/(prefix+'-card-upload-region.ts')).read_bytes())==digest==metadata['regionSha256'],arm+' unchanged region')
 helpers={'harness.mjs':r['harnessSha256'],'parent-harness.mjs':g['parentHarnessSha256'],'upload-loader.js':g['loaderSha256'],'fixture.js':r['entryFixtureSha256'],'fact-fixture.js':r['factFixtureSha256'],'bank-variant.js':r['variantHelperSha256'],'viewport-metadata.js':r['viewportMetadataSha256']}
 for file,digest in helpers.items():check(sha((folder/file).read_bytes())==digest,arm+' helper '+file)
 selected=g['originalSource'] if mode=='original' else g['candidateSource'];selectedSHA=sha(original if mode=='original' else candidate)
 check(g['actualProviderPath']==selected and g['actualProviderSha256']==selectedSHA,arm+' selected provider')
 runtime=g['moduleSetup'];check(runtime['ready'] and runtime['policy']==mode and runtime['providerPath']==selected and runtime['baselineModuleImportedWithoutInstantiation'] and runtime['candidateModuleImportedWithoutInstantiation'] and not runtime['textureFactoriesCalledBySetup'],arm+' runtime ABI')
 check(g['resolveRecords'] and all(x['resolvedId']==selected and x['providerSha256']==selectedSHA for x in g['resolveRecords']),arm+' provider resolution')
 three=[x for x in g['dependencyResolveRecords'] if x['request']=='three'];check(three and len({x['resolvedId'] for x in three})==1,arm+' Three identity')
 for provider,digest in [(g['originalSource'],sha(original)),(g['candidateSource'],sha(candidate))]:
  check(any(x['path']==provider and x['sha256']==digest and x['servedFromRunStartSnapshot'] for x in g['loadedUploaderModules']),arm+' loaded provider')
  check(any(x['importer'].split('?')[0]==provider and x['request']=='./card-upload-region' and x['sha256']==metadata['regionSha256'] for x in g['dependencyResolveRecords']),arm+' region dependency')
 # Do not manufacture bundle provenance from startup configuration declarations.
 dep=inv['dependencyPreparation']
 check(dep is not None,arm+' missing startup/finish optimized bundle capture (strict provenance incomplete)')
 if dep:
  check(dep['beforeBrowserLaunch'] and dep['noDiscovery'],arm+' prebundle startup policy')
  check(dep['stayedStable'] and {k:v for k,v in dep['startup'].items() if k!='label'}=={k:v for k,v in dep['finish'].items() if k!='label'},arm+' optimized dependencies changed')
  for phase in [dep['startup'],dep['finish']]:
   check(phase['optimizationComplete'] and not phase['discovered'],arm+' optimizer incomplete')
   check(sorted(x['name'] for x in phase['entries'])==sorted(dep['include']),arm+' optimized entry inventory')
   for entry in phase['entries']+phase['chunks']:
    data=(folder/entry['snapshot']).read_bytes();check(len(data)==entry['bytes'] and sha(data)==entry['sha256'],arm+' optimized bundle '+entry['name'])
  canonical=next(x['resolvedId'] for x in dep['startup']['entries'] if x['name']=='three')
  check(inv['sameContextThreeResolvedIds']==[canonical] and all(x['resolvedId']==canonical for x in three),arm+' startup/runtime Three full query identity')
 check(any(x.get('id','').split('?')[0]==selected for x in inv['moduleGraph'] if x.get('id')),arm+' provider graph missing')
 check((r['scene'],r['counts'],r['repeats'],r['cpuFrames'],r['realFrames'],r['paced'])==('mixed',[0],1 if a.pilot else 2,60,12,True),arm+' schedule header')
 cycles=[]
 for c in r['cycles']:
  tag=arm+'/'+str(c['cycle']);cpu=c['cpu'];real=c['real'];check(c['glError']==0 and c['disposed'],tag+' GL/disposal')
  check(len(cpu['valuesMs'])==60 and len(real['completeWallValuesMs'])==12,tag+' sample count')
  check(cpu['sampleTicks']==[n//3 for n in range(114,174)],tag+' CPU clock')
  check(all(math.isfinite(v) and v>=0 for v in cpu['valuesMs']+real['completeWallValuesMs']),tag+' invalid duration')
  for name,item in c['screenshots'].items():
   data=(folder/item['path']).read_bytes();check(sha(data)==item['sha256'],tag+' PNG encoded hash '+name)
   with Image.open(folder/item['path']) as im:images[(arm,c['cycle'],name)]=(im.size,sha(im.convert('RGBA').tobytes()))
  cards=c['before']['cards'];cache=cards['rasterCache'];check(cache['budget']==16777216,tag+' actual cache budget')
  cycles.append({'cycle':c['cycle'],'cpu':dist(cpu['valuesMs']),'freshTick':dist([v for i,v in enumerate(cpu['valuesMs']) if (114+i)%3==0]),'sameTick':dist([v for i,v in enumerate(cpu['valuesMs']) if (114+i)%3]),'real':dist(real['completeWallValuesMs']),'realFirstCold':real['completeWallValuesMs'][0],'realFollowingAll':dist(real['completeWallValuesMs'][1:]),'cpuFirst':cpu['valuesMs'][0],'frameIntervals':dist(real['intervalsMs']),'empty':c['empty'],'returned':c['returned'],'before':c['before'],'rasterCache':cache,'rasterizations':cards['rasterizations'],'trueCanvasMisses':cards['rasterizations']-cache['hits'],'cacheGetMisses':cache['misses'],'peakOwnedCpuBytes':cards.get('peakOwnedCpuBytes'),'peakOwnedGpuBytes':cards.get('peakOwnedGpuBytes')})
 reports.append({'arm':arm,'mode':mode,'cycles':cycles,'cpuAll':dist([v for c in r['cycles'] for v in c['cpu']['valuesMs']]),'realAll':dist([v for c in r['cycles'] for v in c['real']['completeWallValuesMs']]),'uploadIsolation':g})
ref=captures[arms[0]];resourceDiffs=[]
for arm,r in captures.items():
 for key in ['sourceCommit','allClientSourceSha256','sourceSha256','scene','counts','repeats','cpuFrames','realFrames','paced','viewport','harnessSha256','factFixtureSha256','fixtureSha256','entryFixtureSha256','variantHelperSha256','viewportMetadataSha256']:
  check(r[key]==ref[key],arm+' cross-arm '+key)
 check(r['uploadIsolation']['candidateUploaderSha256']==ref['uploadIsolation']['candidateUploaderSha256'],arm+' cross-arm candidate SHA')
 check(r['uploadIsolation']['sourceInventory']['sourceSha256']==ref['uploadIsolation']['sourceInventory']['sourceSha256'],arm+' cross-arm full source')
 check(r['uploadIsolation']['loaderSha256']==sha((root/arm/'upload-loader.js').read_bytes()),arm+' loader SHA')
 for c,oracle in zip(r['cycles'],ref['cycles']):
  check(c['cycle']==oracle['cycle'] and c['hiddenCount']==oracle['hiddenCount'],arm+' cycle order')
  check(c['pixelProofSha256']==oracle['pixelProofSha256'] and c['pixelProof']==oracle['pixelProof'],arm+' raw facts and SHA')
  check(c['capturedVisibleSnapshotSha256']==oracle['capturedVisibleSnapshotSha256'],arm+' captured snapshot SHA')
  check(c['cpu']['sampleTicks']==oracle['cpu']['sampleTicks'],arm+' sample clock')
  for name in oracle['screenshots']:check(images[(arm,c['cycle'],name)]==images[(arms[0],oracle['cycle'],name)],arm+' RGBA '+name)
  for phase in ['before','empty','returned']:
   left=flatten(oracle[phase]);right=flatten(c[phase]);resourceDiffs.append({'arm':arm,'cycle':c['cycle'],'phase':phase,'differences':{k:{'productionA':left.get(k),'actual':right.get(k)} for k in sorted(left.keys()|right.keys()) if left.get(k)!=right.get(k)}})
policySummary={}
for mode in ['original','candidate']:
 selected=[r for arm,r in captures.items() if arm.startswith(mode)]
 policySummary[mode]={'cpuAll':dist([v for r in selected for c in r['cycles'] for v in c['cpu']['valuesMs']]),'realAll':dist([v for r in selected for c in r['cycles'] for v in c['real']['completeWallValuesMs']])}
result={'scope':'Unbalanced two-arm one-lifetime pilot' if a.pilot else 'Four-arm two-lifetime ABBA','policySummary':policySummary,'passed':not violations,'violations':violations,'inputs':inputs,'analyzerSha256':sha(Path(__file__).read_bytes()),'reports':reports,'resourceDiffsAllowedNotEqualityAssertions':resourceDiffs,'images':{'/'.join(map(str,k)):v for k,v in images.items()},'method':'All samples retained; nearest-rank p50/p95/p99. CPU fresh/same grouping is deterministic n modulo3, not filtering. Cold first real sample retained in all-real and separately reported. Second-through-last real samples are not assumed cache-warm. No performance thresholds imply acceptance. Cumulative true Canvas misses are rasterizations minus cache hits for the frozen original raster path; raw cacheGetMisses are separately preserved, not per-frame attribution. Resource endpoints include prep/warm/real. GPU layout/calls/bytes may change and are reported without equality requirement. Complete uploader candidate must match exact ordered patch manifest. Only 512-square scratch ownership/selection/accounting is intended to change; static review and native proof validate that scope separately. Different per-slot histories may change cold/partial/unchanged upload calls and ROI bytes; these are reported, not equality-gated. Added CPU/GPU scratch ownership must be included in total/peak accounting; no inference of reduced traffic from source view length. Raw facts are retained and checked separately from hashes. Legacy capture lacking optimized bundle snapshots fails strict provenance rather than inventing validation. Real n480..491 follows identical archived fixture, not per-frame raw clock telemetry. Percentiles with 48 real samples per policy have limited tail stability.'}
(out/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'out':str(out),'passed':not violations,'violations':violations,'summaries':[{k:x[k] for k in ['arm','cpuAll','realAll']} for x in reports]}))
raise SystemExit(0 if not violations else 1)
