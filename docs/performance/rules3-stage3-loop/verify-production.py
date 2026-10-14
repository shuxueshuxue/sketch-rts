#!/usr/bin/env python3
"""Check the exact release tar against archived files without extracting it."""
import base64
import datetime
import gzip
import hashlib
import io
import json
import tarfile
import time
from pathlib import Path, PurePosixPath

OUT = Path(__file__).resolve().parent
ROOT = '/workspace/pr379-production-review/restart-21-40'
HEAD = '618f9f5170164aa33d1e21443e86e64fb14d38f8'
SHA = 'b3bb3439ed14e414f3451c3a8844bdeb2fb933ca12f3e165a23fdcd8e4889f74'


def main():
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    clock = time.perf_counter()
    manifest = json.loads((OUT / 'manifest.json').read_text())
    lookup = {base64.b64decode(r['originalPathBase64']).decode():r for r in manifest['files']}

    def raw(path):
        row = lookup[path]
        body = gzip.decompress((OUT / row['storedPath']).read_bytes())
        assert len(body) == row['originalBytes']
        assert hashlib.sha256(body).hexdigest() == row['originalSha256']
        return body

    def load(path):
        return json.loads(raw(ROOT + '/' + path))

    receipt = load('artifact-verification.json')
    release = load('release-current.json')
    asset = next(x for x in release['assets'] if x['id'] == 641736853)
    package = raw(ROOT + '/sketch-rts-production.tar.gz')
    assert len(package) == receipt['artifactBytes'] == asset['size'] == 2471661
    assert hashlib.sha256(package).hexdigest() == receipt['artifactSha256'] == SHA
    assert asset['digest'] == 'sha256:' + SHA
    assert receipt['targetCommit'] == release['target_commitish'] == HEAD
    assert receipt['cdRun'] == 38640281860 and receipt['cdConclusion'] == 'success'
    assert 'deployed ' + HEAD in receipt['actualDeploymentReceipt']
    files = []; names = set()
    with tarfile.open(fileobj=io.BytesIO(package), mode='r:gz') as archive:
        for entry in archive:
            path = PurePosixPath(entry.name)
            assert not path.is_absolute() and '..' not in path.parts
            assert path.parts and path.parts[0] in ['dist','dist-server']
            assert entry.isdir() or entry.isfile()
            if entry.isdir():
                continue
            assert str(path) not in names
            names.add(str(path))
            stream = archive.extractfile(entry)
            assert stream is not None
            body = stream.read()
            assert len(body) == entry.size
            assert body == raw(ROOT + '/artifact/' + str(path))
            files.append({'path':str(path),'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
    retained_names = {p[len(ROOT + '/artifact/'):] for p in lookup if p.startswith(ROOT + '/artifact/')}
    assert names == retained_names and len(files) == 91
    assert sum(r['bytes'] for r in files) == 11327853
    startup = load('public-startup/proof.json')
    checks = startup['checks']; failed = [x for x in checks if not x['pass']]
    assert len(checks) == 59 and len(failed) == 3 and startup['automatedPass'] is False
    assert startup['expectedMainSha'] == HEAD
    for item in failed:
        assert item['name'] == 'public-assets-entity-or-exact-cdp-representation'
        assert len(item['mismatches']) == 1
        mismatch = item['mismatches'][0]
        assert mismatch['relativePath'] == 'audio-packs/served.json'
        assert mismatch['expected']['bytes'] == 16 and mismatch['body']['bytes'] == 41
        assert mismatch['expected']['sha256'] == '4b7c27887eaf204ea1f0324f1b13a90eb1f8fb3b4940f807cca1f5233a033b5c'
        assert mismatch['body']['sha256'] == '5b8fe19449089ceae78086a7cd6b5415e82dc364116922344af6845c9fe27ead'
    nss = load('public-startup/nss-inventory-closure.json')
    assert nss['unchanged'] and nss['before'] == nss['after']
    execution = load('public-startup-execution.json')
    assert execution['exitCode'] == 1 and execution['normalTLS']
    assert not execution['tlsBypass'] and not execution['certificateImport']
    media = []
    for scene in ['fleet','capital','woods']:
        original = raw(ROOT + '/public-startup/' + scene + '-desktop-normal-native-bootstrap.png')
        assert original == (OUT / 'media' / (scene + '.png')).read_bytes()
        media.append({'path':'media/' + scene + '.png','bytes':len(original),'sha256':hashlib.sha256(original).hexdigest()})
    report = {'schema':1,'complete':True,'main':HEAD,'cd':38640281860,'tarBytes':len(package),
              'tarSha256':SHA,'files':files,'safeTarNamespaceAndRegularFilesOnly':True,
              'allTarFileBytesEqualArchivedExtraction':True,'noNewExtraction':True,
              'startup':{'passed':56,'total':59,'exitCode':1,'failedChecksRetained':failed,'nssUnchanged':True},
              'media':media,'scope':'Release identity/package and three normal-TLS startup screens; no FPS, complete animation or audible-audio claim.',
              'execution':{'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wallSeconds':time.perf_counter()-clock}}
    target = OUT / 'production-proof.json'
    previous = json.loads(target.read_text()) if target.exists() else None
    if previous and previous.get('complete'):
        old = dict(previous); old.pop('execution')
        stable = dict(report); stable.pop('execution')
        assert old == stable
    else:
        target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'verified':True,'regularFiles':len(files),'bytes':sum(r['bytes'] for r in files),'startupPassed':56,'startupTotal':59,'scope':report['scope'],'execution':report['execution']},ensure_ascii=False))


if __name__ == '__main__':
    main()
