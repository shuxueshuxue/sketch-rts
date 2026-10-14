#!/usr/bin/env python3
"""Read and restore a closed byte-preserving production evidence archive."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath

CHUNK = 1024 * 1024


def digest(path):
    length = 0
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            length += len(chunk)
            checksum.update(chunk)
    return length, checksum.hexdigest()


def original_path(row):
    decoded = base64.b64decode(row["originalPathBase64"], validate=True).decode("utf-8")
    path = PurePosixPath(decoded)
    if not path.is_absolute() or ".." in path.parts or "\x00" in decoded:
        raise ValueError("Invalid original path")
    return path


def stored_path(out, row):
    relative = PurePosixPath(row["storedPath"])
    if relative.is_absolute() or ".." in relative.parts or "\x00" in str(relative):
        raise ValueError("Invalid stored path")
    path = out / str(relative)
    if path.is_symlink() or not path.resolve().is_relative_to(out.resolve()):
        raise ValueError("Stored path escaped archive")
    return path


def stream_raw(out, row):
    if row["encoding"] != "gzip":
        raise ValueError("Unsupported encoding")
    with gzip.open(stored_path(out, row), "rb") as stream:
        yield from iter(lambda: stream.read(CHUNK), b"")


def verify(out, manifest, compare_originals=False):
    expected = {"manifest.json", *manifest["supportingFiles"]}
    original_paths = set()
    stored_paths = set()
    for row in manifest["files"]:
        original = str(original_path(row))
        if original in original_paths or row["storedPath"] in stored_paths:
            raise ValueError("Duplicate path")
        original_paths.add(original)
        stored_paths.add(row["storedPath"])
        if digest(stored_path(out, row)) != (row["storedBytes"], row["storedSha256"]):
            raise ValueError("Stored file mismatch")
        length = 0
        checksum = hashlib.sha256()
        for chunk in stream_raw(out, row):
            length += len(chunk)
            checksum.update(chunk)
        wanted = (row["originalBytes"], row["originalSha256"])
        if (length, checksum.hexdigest()) != wanted:
            raise ValueError("Decoded file mismatch")
        if compare_originals and digest(Path(original)) != wanted:
            raise ValueError("Original changed")
        expected.add(row["storedPath"])
    actual = {str(path.relative_to(out)) for path in out.rglob("*") if path.is_file()}
    if actual != expected:
        raise ValueError("Archive inventory mismatch: " + repr((actual - expected, expected - actual)))
    if any(path.is_symlink() for path in out.rglob("*")):
        raise ValueError("Archive contains a link")


def extract(out, manifest, destination):
    root = Path(destination).absolute()
    if root.exists() or root.is_symlink():
        raise ValueError("Extraction requires a new directory")
    root.mkdir(parents=True, exist_ok=False)
    root = root.resolve()
    for row in manifest["files"]:
        target = root / str(original_path(row).relative_to("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.resolve().is_relative_to(root):
            raise ValueError("Restored path escaped new directory")
        with target.open("xb") as stream:
            for chunk in stream_raw(out, row):
                stream.write(chunk)
        if digest(target) != (row["originalBytes"], row["originalSha256"]):
            raise ValueError("Restored file mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--compare-originals", action="store_true")
    parser.add_argument("--extract")
    args = parser.parse_args()
    out = Path(args.out)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    verify(out, manifest, args.compare_originals)
    if args.extract:
        extract(out, manifest, args.extract)
    print(json.dumps({"pass": True, "payloads": len(manifest["files"]),
                      "originalBytes": sum(row["originalBytes"] for row in manifest["files"]),
                      "storedBytes": sum(row["storedBytes"] for row in manifest["files"]),
                      "originalsCompared": args.compare_originals,
                      "extracted": bool(args.extract)}))


if __name__ == "__main__":
    main()
