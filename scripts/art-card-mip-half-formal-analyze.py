#!/usr/bin/env python3
"""Offline strict half-margin ABBA analysis. No browser; never modifies captures."""
import argparse, hashlib, json, math, subprocess
from pathlib import Path
from PIL import Image
p=argparse.ArgumentParser()
p.add_argument('--input',default='docs/art/refactor/followup/card-streaming/stall-followup/mip-half-abba')
p.add_argument('--out')
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
arms=['production-A','candidate-B','candidate-B2','production-A2'];reports=[];inputs=[];captures={};images={}
for arm in arms:
 folder=root/arm;b=(folder/'raw.json').read_bytes();r=json.loads(b);captures[arm]=r;g=r['gateIsolation'];mode='production' if arm.startswith('production') else 'candidate'
 inputs.append({'arm':arm,'rawSha256':sha(b)})
 check(r['completed'] and r['validation']['passed'] and not r['errors'] and not r['failed'],arm+' capture failed')
 check(r['sourceCommit']==g['sourceCommit']==g['expectedCommit']==expected,arm+' source commit')
 check(g['mode']==mode and g['sourceStayedFrozen'] and g['candidateStayedFrozen'] and g['helpersStayedFrozen'],arm+' frozen provider state')
 check(g['sourceSha256']==g['finalSourceSha256'],arm+' source maps differ')
 check(r['sourceGitDiffSha256']==sha(b''),arm+' client dirty')
 archived={}
 for entry in g['sourceSnapshots']+g['providerSnapshots']+g['helperSnapshots']:
  data=(folder/entry['snapshot']).read_bytes();check(sha(data)==entry['sha256'],arm+' snapshot '+entry['snapshot']);archived[entry['path']]=entry['sha256']
  if 'relativePath' in entry:check(g['sourceSha256'].get(entry['relativePath'])==sha(data),arm+' source inventory '+entry['relativePath'])
 # Check archived source against immutable Git blobs, never the edited working tree.
 tree=subprocess.check_output(['git','ls-tree','-r',expected,'src'],text=True)
 gitblobs={line.split('\t',1)[1]:line.split()[2] for line in tree.splitlines()}
 check(set(gitblobs)==set(g['sourceSha256']),arm+' git source file set')
 for entry in g['sourceSnapshots']:
  data=(folder/entry['snapshot']).read_bytes();blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
  check(blob==gitblobs.get(entry['relativePath']),arm+' git blob '+entry['relativePath'])
 public=subprocess.check_output(['git','rev-parse',expected+':public'],text=True).strip();check(public==g['sourcePublicTree'],arm+' public tree')
 checks={'harness.mjs':r['harnessSha256'],'provider-helper.mjs':r['providerHelperSha256'],'parent-viewport-harness.mjs':r['parentHarnessSha256'],'mip-half-loader.js':g['loaderSha256'],'fixture.js':r['entryFixtureSha256'],'fact-fixture.js':r['factFixtureSha256'],'bank-variant.js':r['variantHelperSha256'],'viewport-metadata.js':r['viewportMetadataSha256']}
 for file,h in checks.items():check(sha((folder/file).read_bytes())==h,arm+' helper '+file)
 original=(folder/'production-gate.ts').read_bytes();candidate=(folder/'candidate-half-gate.ts').read_bytes();needle=b'Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-1)'
 check(original.count(needle)==1 and candidate==original.replace(needle,b'Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-.5)'),arm+' unique expression diff')
 check(g['candidateExactSingleExpressionDifference'],arm+' expression guard')
 selected=g['originalPath'] if mode=='production' else g['candidateSource'];check(g['selectedPath']==selected and g['selectedSha256']==archived.get(selected),arm+' selected provider')
 runtime=g['runtime'];check(runtime['ready'] and runtime['mode']==mode and runtime['selectedPath']==selected and runtime['balancedCompleteProvidersLoadedBeforeInit'] and not runtime['perFrameOverrides'],arm+' runtime ABI')
 check(len(runtime['providers'])==3,arm+' balanced providers')
 for provider in runtime['providers']:
  check(sha(provider['baseSource'].encode())==provider['baseSha256'] and sha(provider['footprintSource'].encode())==provider['footprintSha256'],arm+' runtime function fingerprint')
 check(len({x['footprintSha256'] for x in runtime['providers']})==1,arm+' footprint changed')
 resolved=[x for x in g['resolveRecords'] if x.get('purpose')=='selected-complete-gate'];check(resolved and all(x['resolvedId']==selected and x['providerSha256']==g['selectedSha256'] for x in resolved),arm+' selected resolve')
 three=[x for x in g['resolveRecords'] if x.get('sameThreeIdentity')];check(three and len({x['resolvedId'] for x in three})==1 and all(x['resolvedId']==x['currentResolvedId'] for x in three),arm+' Three identity')
 for row in g['loadedModules']:check(row['frozenRunStartBytes'] and archived.get(row['path'])==row['sha256'],arm+' loaded module '+row['path'])
 check(all(x['unchangedAtFinish'] for x in g['thirdPartyModules']),arm+' thirdparty changed')
 check(any(x.get('id','').split('?')[0]==selected for x in g['moduleGraph'] if x.get('id')),arm+' selected graph missing')
 check((r['scene'],r['counts'],r['repeats'],r['cpuFrames'],r['realFrames'],r['paced'])==('mixed',[0],2,60,12,True),arm+' schedule header')
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
 reports.append({'arm':arm,'mode':mode,'cycles':cycles,'cpuAll':dist([v for c in r['cycles'] for v in c['cpu']['valuesMs']]),'realAll':dist([v for c in r['cycles'] for v in c['real']['completeWallValuesMs']]),'gateIsolation':g})
ref=captures[arms[0]];resourceDiffs=[]
for arm,r in captures.items():
 for key in ['sourceCommit','allClientSourceSha256','sourceSha256','scene','counts','repeats','cpuFrames','realFrames','paced','viewport','harnessSha256','providerHelperSha256','parentHarnessSha256','factFixtureSha256','fixtureSha256','entryFixtureSha256','variantHelperSha256','viewportMetadataSha256']:
  check(r[key]==ref[key],arm+' cross-arm '+key)
 check(r['gateIsolation']['sourceSha256']==ref['gateIsolation']['sourceSha256'],arm+' cross-arm full source')
 for c,oracle in zip(r['cycles'],ref['cycles']):
  check(c['cycle']==oracle['cycle'] and c['hiddenCount']==oracle['hiddenCount'],arm+' cycle order')
  check(c['pixelProofSha256']==oracle['pixelProofSha256'],arm+' facts SHA')
  check(c['cpu']['sampleTicks']==oracle['cpu']['sampleTicks'],arm+' sample clock')
  for name in oracle['screenshots']:check(images[(arm,c['cycle'],name)]==images[(arms[0],oracle['cycle'],name)],arm+' RGBA '+name)
  for phase in ['before','empty','returned']:
   left=flatten(oracle[phase]);right=flatten(c[phase]);resourceDiffs.append({'arm':arm,'cycle':c['cycle'],'phase':phase,'differences':{k:{'productionA':left.get(k),'actual':right.get(k)} for k in sorted(left.keys()|right.keys()) if left.get(k)!=right.get(k)}})
policySummary={}
for mode in ['production','candidate']:
 selected=[r for arm,r in captures.items() if arm.startswith(mode)]
 policySummary[mode]={'cpuAll':dist([v for r in selected for c in r['cycles'] for v in c['cpu']['valuesMs']]),'realAll':dist([v for r in selected for c in r['cycles'] for v in c['real']['completeWallValuesMs']])}
result={'policySummary':policySummary,'passed':not violations,'violations':violations,'inputs':inputs,'analyzerSha256':sha(Path(__file__).read_bytes()),'reports':reports,'resourceDiffsAllowedNotEqualityAssertions':resourceDiffs,'images':{'/'.join(map(str,k)):v for k,v in images.items()},'method':'All samples retained; nearest-rank p50/p95/p99. CPU fresh/same grouping is deterministic n modulo3, not filtering. Cold first real sample retained in all-real and separately reported. Second-through-last real samples are not assumed cache-warm. No performance thresholds imply acceptance. Cumulative true Canvas misses are rasterizations minus cache hits for the frozen original raster path; raw cacheGetMisses are separately preserved, not per-frame attribution. Resource endpoints include prep/warm/real. GPU layout/calls/bytes may change and are reported without equality requirement. Source-only change must be complete gate -1 to -.5 expression. Raw facts were deleted by capture harness: only captured fact SHA can be checked; no invented raw fact reconstruction. Real n480..491 follows identical archived fixture, not per-frame raw clock telemetry. Percentiles with 48 real samples per policy have limited tail stability.'}
(out/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'out':str(out),'passed':not violations,'violations':violations,'summaries':[{k:x[k] for k in ['arm','cpuAll','realAll']} for x in reports]}))
raise SystemExit(0 if not violations else 1)
