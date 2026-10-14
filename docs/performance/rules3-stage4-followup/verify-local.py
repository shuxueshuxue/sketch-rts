#!/usr/bin/env python3
"""Close the original local manifests and stream every complete oracle byte."""
import base64, datetime, gzip, hashlib, io, json, time
from pathlib import Path

OUT = Path(__file__).resolve().parent
started = datetime.datetime.now(datetime.timezone.utc).isoformat(); clock = time.perf_counter()
manifest = json.loads((OUT/'manifest.json').read_text())
lookup = {base64.b64decode(r['originalPathBase64']).decode():r for r in manifest['files']}

def raw(path):
    row = lookup[path]; body = gzip.decompress((OUT/row['storedPath']).read_bytes())
    assert len(body) == row['originalBytes'] and hashlib.sha256(body).hexdigest() == row['originalSha256']
    return body

def load(path):return json.loads(raw(path))

sealed = []
for root,name,key,pathkey,count in [
    ('/workspace/whole-unweighted-grow-hoist-v1','evidence-manifest.json','payloads','path',80),
    ('/workspace/whole-component-cardinal-proof','evidence-manifest.json','files','file',62),
    ('/workspace/whole-component-cardinal-native-review','manifest.json','files','file',9)]:
    local = load(root+'/'+name); rows = local[key]; assert len(rows) == count
    for row in rows:
        body = raw(root+'/'+row[pathkey])
        assert len(body) == row['bytes'] and hashlib.sha256(body).hexdigest() == row['sha256']
    sealed.append({'root':root,'payloads':count,'allOriginalManifestBytesAndShaExact':True,
                   'originalManifestSha256':hashlib.sha256(raw(root+'/'+name)).hexdigest()})

ROOT = '/workspace/whole-unweighted-grow-hoist-v1/validation/micro'
layout = load(ROOT+'/oracle-layout.json'); assert len(layout) == 24
bin_rows = []
for row in layout:
    packed = raw(ROOT+'/'+row['path'])
    assert len(packed) == row['storedBytes'] and hashlib.sha256(packed).hexdigest() == row['storedSha256']
    size = 0; total = hashlib.sha256(); segments = []
    with gzip.GzipFile(fileobj=io.BytesIO(packed),mode='rb') as stream:
        for part in row['layout']:
            remaining = part['bytes']; digest = hashlib.sha256()
            while remaining:
                piece = stream.read(min(1048576,remaining)); assert piece
                remaining -= len(piece); size += len(piece); total.update(piece); digest.update(piece)
            assert digest.hexdigest() == part['sha256']
            segments.append({'name':part['name'],'bytes':part['bytes'],'sha256':part['sha256']})
        assert stream.read(1) == b''
    assert size == row['bytes'] and total.hexdigest() == row['sha256']
    bin_rows.append({'arm':row['arm'],'index':row['index'],'decodedBytes':size,'decodedSha256':total.hexdigest(),
                     'storedBytes':len(packed),'storedSha256':hashlib.sha256(packed).hexdigest(),'segments':segments})
pairs = []
for index in range(12):
    paths = [ROOT+'/oracle-bytes/'+arm+'-%02d.bin.gz'%index for arm in ['A','B']]
    total = 0
    with gzip.GzipFile(fileobj=io.BytesIO(raw(paths[0])),mode='rb') as a, gzip.GzipFile(fileobj=io.BytesIO(raw(paths[1])),mode='rb') as b:
        while True:
            aa = a.read(1048576); bb = b.read(1048576)
            assert aa == bb
            total += len(aa)
            if not aa:break
    pairs.append({'index':index,'fullDecodedAAndBBytesEqual':True,'bytesCompared':total})
assert sum(r['decodedBytes'] for r in bin_rows) == 104515008
assert sum(r['storedBytes'] for r in bin_rows) == 1029210
report = {'schema':1,'complete':True,'localManifestClosure':sealed,'oracleBins':bin_rows,'oraclePairs':pairs,
          'decodedOracleBytes':104515008,'storedOriginalOracleBytes':1029210,'all24DecodedBinsAndEverySegmentShaExact':True,
          'all12CompleteDecodedPairsByteEqual':True,'noRawBinsWritten':True,'largestReadChunkBytes':1048576,
          'scope':'Original local frozen payload identities and full stored/decoded oracle bytes; not new logical proof, benchmark, original cache/JIT restoration or performance acceptance.',
          'execution':{'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wallSeconds':time.perf_counter()-clock}}
target = OUT/'local-proof.json'
previous = json.loads(target.read_text()) if target.exists() else None
if previous and previous.get('complete'):
    old = dict(previous);old.pop('execution');stable = dict(report);stable.pop('execution');assert old == stable
else:
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'verified':True,'closedManifests':sealed,'decodedOracleBytes':104515008,'all12CompletePairsByteEqual':True,'noRawBinsWritten':True,'execution':report['execution']}))
