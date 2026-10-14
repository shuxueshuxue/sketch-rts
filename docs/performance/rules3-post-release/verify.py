#!/usr/bin/env python3
"""Preserve raw evidence bytes, without interpreting or rewriting old records."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--inputs")
parser.add_argument("--verify", action="store_true")
parser.add_argument("--extract", help="Verify and restore original paths below this directory")
args = parser.parse_args()
out = Path(args.out)
manifest_path = out / "manifest.json"
if args.verify:
    manifest = json.loads(manifest_path.read_text())
    expected = {"manifest.json", "README.zh.md", "verify.py"}
    for record in manifest["files"]:
        packed = (out / record["storedPath"]).read_bytes()
        assert len(packed) == record["storedBytes"]
        assert sha(packed) == record["storedSha256"]
        raw = gzip.decompress(packed) if record["encoding"] == "gzip" else packed
        assert len(raw) == record["originalBytes"]
        assert sha(raw) == record["originalSha256"]
        assert base64.b64decode(record["originalPathBase64"], validate=True)
        expected.add(record["storedPath"])
        if args.extract:
            original = Path(base64.b64decode(record["originalPathBase64"]).decode())
            assert original.is_absolute() and ".." not in original.parts
            restored = Path(args.extract).resolve() / original.relative_to("/")
            restored.parent.mkdir(parents=True, exist_ok=True)
            if restored.exists():
                assert restored.read_bytes() == raw, f"Refuse to overwrite {restored}"
            else:
                restored.write_bytes(raw)
    actual = {str(path.relative_to(out)) for path in out.rglob("*") if path.is_file()}
    assert actual == expected, (sorted(actual - expected), sorted(expected - actual))
    print(json.dumps({"pass": True, "payloads": len(manifest["files"]),
                      "originalBytes": sum(row["originalBytes"] for row in manifest["files"])}))
    raise SystemExit(0)

assert not manifest_path.exists(), "Never overwrite a closed archive"
assert args.inputs, "--inputs is required when creating a new archive"
inputs = json.loads(Path(args.inputs).read_text())
out.mkdir(parents=True, exist_ok=True)
(out / "payloads").mkdir(exist_ok=True)
records = []
for group in inputs["groups"]:
    source = Path(group["source"])
    assert source.exists(), source
    paths = sorted(source.rglob("*")) if source.is_dir() else [source]
    for path in paths:
        if not path.is_file():
            continue
        assert not path.is_symlink(), path
        raw = path.read_bytes()
        stored_path = f"payloads/{len(records) + 1:05d}.gz"
        packed = gzip.compress(raw, compresslevel=6, mtime=0)
        (out / stored_path).write_bytes(packed)
        records.append({"group": group["id"], "storedPath": stored_path, "encoding": "gzip",
                        "originalPathBase64": base64.b64encode(str(path).encode()).decode(),
                        "originalBytes": len(raw), "originalSha256": sha(raw),
                        "storedBytes": len(packed), "storedSha256": sha(packed)})
for media in inputs.get("media", []):
    path = Path(media["source"])
    raw = path.read_bytes()
    stored_path = media["storedPath"]
    target = out / stored_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    records.append({"group": media["group"], "storedPath": stored_path, "encoding": "identity",
                    "originalPathBase64": base64.b64encode(str(path).encode()).decode(),
                    "originalBytes": len(raw), "originalSha256": sha(raw),
                    "storedBytes": len(raw), "storedSha256": sha(raw)})
manifest_path.write_text(json.dumps({"schema": 1, "identity": inputs["identity"], "files": records}, indent=2) + "\n")
print(json.dumps({"payloads": len(records), "originalBytes": sum(row["originalBytes"] for row in records),
                  "storedBytes": sum(row["storedBytes"] for row in records)}))
