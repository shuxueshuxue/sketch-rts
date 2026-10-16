"""Pure helpers for read-only archive evidence verification; no top-level work."""
from pathlib import PurePosixPath
from io import BytesIO
import gzip
import hashlib
import json
import re
import subprocess
import tarfile

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs)

def canonical(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe tar path: ' + name)
    return str(path)

def stream_archive(raw, capture=()):
    """Read full gzip+tar, validate headers/CRC, hash all regulars, no extraction."""
    inventory, kept, seen = {}, {}, set()
    capture = set(capture)
    with gzip.GzipFile(fileobj=raw) as gz:
        with tarfile.open(fileobj=gz, mode='r|') as tar:
            for member in tar:
                name = canonical(member.name)
                if name in seen:
                    raise ValueError('Duplicate normalized tar member: ' + name)
                seen.add(name)
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError('Unexpected nonregular member: ' + name)
                digest, size = hashlib.sha256(), 0
                saved = bytearray() if name in capture else None
                inp = tar.extractfile(member)
                while chunk := inp.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)
                    if saved is not None:
                        saved.extend(chunk)
                assert size == member.size
                inventory[name] = {'sha256': digest.hexdigest(), 'bytes': size}
                if saved is not None:
                    kept[name] = bytes(saved)
        while gz.read(1024 * 1024):
            pass
    assert set(kept) == capture
    return inventory, kept

def verify_dict_manifest(inventory, files, manifest_name='INDEX.json'):
    normalized = {}
    for name, row in files.items():
        name = canonical(name)
        assert name not in normalized
        normalized[name] = {'sha256': row['sha256'], 'bytes': row['bytes']}
    assert set(inventory) == set(normalized) | {manifest_name}
    assert all(inventory[name] == row for name, row in normalized.items())
    return normalized

def git_blob_inventory(repo, head, names):
    """One supported read-only Git batch, hash actual commit blobs individually."""
    names = list(names)
    query = ''.join(head + ':' + name + '\n' for name in names).encode()
    output = subprocess.check_output(['git', '-C', str(repo), 'cat-file', '--batch'], input=query)
    inp, result = BytesIO(output), {}
    for name in names:
        header = inp.readline().decode().rstrip('\n').split()
        assert len(header) == 3 and header[1] == 'blob'
        data = inp.read(int(header[2]))
        assert len(data) == int(header[2]) and inp.read(1) == b'\n'
        result[name] = {'sha256': sha(data), 'bytes': len(data)}
    assert inp.read() == b''
    return result

def value_span(text, key):
    match = re.search(r'^  "' + re.escape(key) + r'":\s*', text, flags=re.M)
    if not match:
        raise ValueError('Missing top-level key: ' + key)
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    return match.end(), match.end() + length

def replace_value(text, key, value):
    a, b = value_span(text, key)
    rendered = json.dumps(value, ensure_ascii=False, indent=2).replace('\n', '\n  ')
    return text[:a] + rendered + text[b:]

def array_span(text):
    start = re.search(r'"packages"\s*:\s*\[', text).end() - 1
    _, length = json.JSONDecoder().raw_decode(text[start:])
    return start, start + length - 1

def append_package(text, entry):
    _, close = array_span(text)
    insert_at = len(text[:close].rstrip())
    rendered = '\n'.join('    ' + line for line in json.dumps(entry, ensure_ascii=False, indent=2).splitlines())
    return text[:insert_at] + ',\n' + rendered + '\n  ' + text[close:]

def assert_preserved_packages(old_text, new_text, count):
    old, new = read_json(old_text), read_json(new_text)
    assert len(old['packages']) == count and len(new['packages']) == count + 1
    assert new['packages'][:count] == old['packages']
    a, b = array_span(old_text)
    c, d = array_span(new_text)
    assert new_text[c + 1:d].startswith(old_text[a + 1:b].rstrip() + ',\n')

def assert_raw_metadata_equal(old_text, new_text, keys):
    old, new = read_json(old_text), read_json(new_text)
    for key in keys:
        assert old[key] == new[key]
        a, b = value_span(old_text, key)
        c, d = value_span(new_text, key)
        assert old_text[a:b] == new_text[c:d]
