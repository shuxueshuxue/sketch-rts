"""Archive exact evidence bytes, deduplicated by content; verify or extract safely."""
import gzip, hashlib, json, sys
from pathlib import Path
base=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
mode=sys.argv[1]
if mode=='pack':
    payload=base/'payloads'; payload.mkdir(exist_ok=True)
    entries=[]
    for arg in sys.argv[2:]:
        source=Path(arg).resolve()
        paths=sorted(source.rglob('*')) if source.is_dir() else [source]
        for p in paths:
            if p.is_symlink(): raise ValueError(f'No symlinks allowed: {p}')
            if not p.is_file(): continue
            data=p.read_bytes(); digest=sha(data); target=payload/(digest+'.gz')
            if not target.exists(): target.write_bytes(gzip.compress(data,mtime=0))
            entries.append({'original':str(p),'path':str(p).lstrip('/'),'bytes':len(data),'sha256':digest,
              'payload':str(target.relative_to(base)),'storedSha256':sha(target.read_bytes())})
    (base/'manifest.json').write_text(json.dumps(entries,indent=2)+'\n')
else:
    entries=json.loads((base/'manifest.json').read_text())
    expected={item['payload'] for item in entries}
    assert {str(p.relative_to(base)) for p in (base/'payloads').iterdir()}==expected, 'payload inventory differs'
    output=Path(sys.argv[2]) if mode=='extract' else None
    if mode not in ['verify','extract']: raise ValueError(mode)
    if output: output.mkdir() # Refuse an existing destination.
    for item in entries:
        payload_path=Path(item['payload']); assert not payload_path.is_absolute() and '..' not in payload_path.parts and payload_path.parts[0]=='payloads'
        packed=(base/payload_path).read_bytes(); assert sha(packed)==item['storedSha256']
        data=gzip.decompress(packed); assert len(data)==item['bytes'] and sha(data)==item['sha256']
        if output:
            rel=Path(item['path']); assert not rel.is_absolute() and '..' not in rel.parts
            dest=output/rel; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(data)
    print(f'Verified {len(entries)} original files')
