"""Check full command bytes and source closure against base plus explicit changed blobs."""
import gzip, hashlib, io, json, subprocess, sys
from pathlib import Path
repo=Path(sys.argv[1]); folders=[Path(p) for p in sys.argv[2:]]
base='4804631c22f7be3f83dc6374e71ce03d86068dd8'
sha=lambda b:hashlib.sha256(b).hexdigest()
reference=None; results=[]; cache={}
for folder in folders:
    inputs=json.loads(gzip.decompress((folder/'source-inputs.json.gz').read_bytes()))
    env=json.loads((folder/'environment.json').read_text()); head=env['gitHead']
    if head not in cache:
        queries=[head+':'+p for p in inputs]
        raw=subprocess.check_output(['git','-C',str(repo),'cat-file','--batch'],input=('\n'.join(queries)+'\n').encode())
        stream=io.BytesIO(raw); cache[head]={}
        for p in inputs:
            header=stream.readline().split(); assert header[1]==b'blob',header
            cache[head][p]=stream.read(int(header[2])); assert stream.read(1)==b'\n'
    for p,text in inputs.items(): assert text.encode()==cache[head][p],(folder,p,'source differs from HEAD')
    commands=gzip.decompress((folder/'command-frames.jsonl.gz').read_bytes())
    if reference is None: reference=commands
    assert commands==reference,(folder,'command mismatch')
    summary=json.loads((folder/'summary.json').read_text())
    assert summary['rulesVersion']==3 and summary['checksumVersion']==18
    assert summary['finalChecksum']=='7d94a5e8' and summary['finalTick']==14400
    results.append({'run':str(folder),'head':head,'sourceFiles':len(inputs),'commandsBytes':len(commands),'commandsSha256':sha(commands),'finalChecksum':summary['finalChecksum']})
print(json.dumps({'verified':results},indent=2))
