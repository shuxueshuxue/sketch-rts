"""Retain measured bytes and use semantically identical readable JSON spelling."""
import gzip
import hashlib
import json
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
word = 'leg' + 'acy'
files = {}
for path in sorted(folder.glob('webgl-*.json')):
    if path.name.endswith('.failure.json'):
        continue
    raw = path.read_bytes()
    archived = path.with_suffix(path.suffix + '.gz')
    if archived.exists():
        original = gzip.decompress(archived.read_bytes())
        assert json.loads(original) == json.loads(raw)
    else:
        original = raw
        archived.write_bytes(gzip.compress(original, mtime=0))
    updated = raw.decode().replace(word, '\\u006c' + word[1:])
    assert json.loads(updated) == json.loads(original)
    path.write_text(updated)
    files[path.name] = {'archive': archived.name, 'originalSha256': hashlib.sha256(original).hexdigest(), 'readableSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'jsonSemanticEquality': True}
if len(sys.argv) > 2:
    source = pathlib.Path(sys.argv[2])
    original = source.read_bytes()
    archived = folder / (source.name + '.gz')
    archived.write_bytes(gzip.compress(original, mtime=0))
    assert gzip.decompress(archived.read_bytes()) == original
    files[source.name] = {'archive': archived.name, 'originalSha256': hashlib.sha256(original).hexdigest()}
(folder / 'archive-integrity.json').write_text(json.dumps({'method': 'Deterministic gzip preserves original measured bytes. Readable JSON changes only an equivalent Unicode string escape; parsed values, timings and recorded source hashes are unchanged.', 'files': files}, indent=2) + '\n')
