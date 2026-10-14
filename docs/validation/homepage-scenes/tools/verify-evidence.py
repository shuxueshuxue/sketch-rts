#!/usr/bin/env python3
"""Verify stored evidence and byte-preserving historical archive conversions."""
from pathlib import Path
import gzip
import hashlib
import json

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/validation/homepage-scenes"


def verify(data, size, digest, label):
    assert len(data) == size, (label, "size", len(data), size)
    assert hashlib.sha256(data).hexdigest() == digest, (label, "sha256")


manifest = json.loads((EVIDENCE / "manifest.json").read_bytes())
stored = {item["path"]: item for item in manifest["files"]}
actual = {
    path.relative_to(ROOT).as_posix()
    for path in EVIDENCE.rglob("*")
    if path.is_file() and path != EVIDENCE / "manifest.json"
}
assert actual == set(stored), ("inventory", actual - set(stored), set(stored) - actual)
for name, item in stored.items():
    verify((ROOT / name).read_bytes(), item["bytes"], item["sha256"], name)

correction = json.loads((EVIDENCE / "validation/ci/archive-discovery-correction.json").read_bytes())
original_bytes = gzip.decompress((EVIDENCE / "validation/ci/attempt1-manifest.json.gz").read_bytes())
assert hashlib.sha256(original_bytes).hexdigest() == correction["originalManifestSha256"]
original = json.loads(original_bytes)
conversions = {item["logicalPath"]: item for item in correction["compressedInputs"]}
for item in original["files"]:
    name = item["path"]
    if name in conversions:
        mapping = conversions[name]
        packed = (ROOT / mapping["storedPath"]).read_bytes()
        verify(packed, mapping["storedBytes"], mapping["storedSha256"], mapping["storedPath"])
        data = gzip.decompress(packed)
        verify(data, mapping["payloadBytes"], mapping["payloadSha256"], name)
    elif name == "docs/validation/homepage-scenes/README.zh.md":
        data = gzip.decompress((EVIDENCE / "validation/ci/attempt1-README.zh.md.gz").read_bytes())
    else:
        data = (ROOT / name).read_bytes()
    verify(data, item["bytes"], item["sha256"], "original:" + name)

print(json.dumps({"currentFiles": len(stored), "currentBytes": sum(x["bytes"] for x in stored.values()),
                  "protectedHistoricalFiles": len(original["files"]),
                  "bytePreservedCompressedInputs": len(conversions), "verified": True}))
