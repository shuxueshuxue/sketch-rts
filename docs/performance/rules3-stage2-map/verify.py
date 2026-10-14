#!/usr/bin/env python3
"""Stream, check, and restore a closed evidence archive without rewriting inputs."""
import argparse
import base64
import gzip
import hashlib
import json
import os
import subprocess
from pathlib import Path, PurePosixPath


CHUNK = 1024 * 1024


def digest(path):
    size = 0
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            size += len(chunk)
            h.update(chunk)
    return size, h.hexdigest()


def encode_path(path):
    return base64.b64encode(str(path).encode("utf-8")).decode("ascii")


def original_path(record):
    raw = base64.b64decode(record["originalPathBase64"], validate=True)
    path = PurePosixPath(raw.decode("utf-8"))
    if not path.is_absolute() or ".." in path.parts or "\x00" in str(path):
        raise ValueError("Invalid original path")
    return path


def stored_path(out, record):
    relative = PurePosixPath(record["storedPath"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Invalid stored path")
    path = out / str(relative)
    if path.is_symlink() or not path.resolve().is_relative_to(out.resolve()):
        raise ValueError("Stored path must stay within the archive")
    return path


def stream_raw(path, encoding):
    if encoding != "gzip":
        raise ValueError("Unsupported payload encoding")
    with gzip.open(path, "rb") as stream:
        yield from iter(lambda: stream.read(CHUNK), b"")


def inventory(inputs):
    files = []
    excludes = []
    group_rows = []
    seen = set()
    prune = set(inputs.get("excludeBasenames", []))
    omit = set(inputs.get("excludeExactPaths", []))
    for group in inputs["groups"]:
        source = Path(group["source"])
        if not source.exists() or source.is_symlink():
            raise ValueError("Input source missing or linked: " + str(source))
        paths = []
        if source.is_dir() and not group.get("recursive", True):
            paths = [path for path in source.iterdir() if path.is_file()]
        elif source.is_dir():
            for directory, dirs, names in os.walk(source, followlinks=False):
                dirs.sort()
                for name in list(dirs):
                    path = Path(directory) / name
                    if name in prune or path.is_symlink():
                        dirs.remove(name)
                        excludes.append({"group": group["id"],
                                         "originalPathBase64": encode_path(path),
                                         "basenameBase64": encode_path(name),
                                         "reason": "dependency-or-generated-tree"})
                for name in sorted(names):
                    path = Path(directory) / name
                    if path.is_symlink() or str(path) in omit:
                        row = {"group": group["id"],
                               "originalPathBase64": encode_path(path),
                               "basenameBase64": encode_path(name),
                               "reason": "linked-file" if path.is_symlink()
                               else "duplicate-container-of-retained-files"}
                        if not path.is_symlink():
                            row["originalBytes"], row["originalSha256"] = digest(path)
                        excludes.append(row)
                    else:
                        paths.append(path)
        else:
            paths = [source]
        first = len(files)
        for path in sorted(paths):
            if not path.is_file() or path.is_symlink():
                raise ValueError("Input must be a regular file")
            absolute = str(path.absolute())
            if absolute in seen:
                raise ValueError("Duplicate input " + absolute)
            seen.add(absolute)
            stat = path.stat()
            files.append({"group": group["id"], "originalPathBase64": encode_path(path),
                          "inventoryBytes": stat.st_size, "inventoryMtimeNs": stat.st_mtime_ns})
        group_rows.append({"id": group["id"], "description": group["description"],
                           "sourcePathBase64": encode_path(source),
                           "files": len(files) - first,
                           "originalBytes": sum(row["inventoryBytes"] for row in files[first:])})
    return {"schema": 2, "identity": inputs["identity"], "groups": group_rows,
            "exclusions": excludes, "files": files}


def create(out, plan):
    if (out / "manifest.json").exists() or (out / "payloads").exists():
        raise ValueError("Refuse to overwrite an archive")
    out.mkdir(parents=True, exist_ok=True)
    (out / "payloads").mkdir()
    records = []
    for index, input_row in enumerate(plan["files"], 1):
        source = Path(str(original_path(input_row)))
        before = source.stat()
        if before.st_size != input_row["inventoryBytes"] or before.st_mtime_ns != input_row["inventoryMtimeNs"]:
            raise ValueError("Input changed after inventory")
        relative = f"payloads/id{index:04d}.bin.gz"
        target = out / relative
        raw_size = 0
        raw_hash = hashlib.sha256()
        with source.open("rb") as raw, target.open("xb") as stored:
            with gzip.GzipFile(filename="", mode="wb", fileobj=stored, compresslevel=6, mtime=0) as packed:
                for chunk in iter(lambda: raw.read(CHUNK), b""):
                    raw_size += len(chunk)
                    raw_hash.update(chunk)
                    packed.write(chunk)
        after = source.stat()
        if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
            raise ValueError("Input changed during capture")
        size, sha = digest(target)
        records.append({"group": input_row["group"], "storedPath": relative,
                        "encoding": "gzip", "originalPathBase64": input_row["originalPathBase64"],
                        "originalBytes": raw_size, "originalSha256": raw_hash.hexdigest(),
                        "storedBytes": size, "storedSha256": sha})
    manifest = {key: value for key, value in plan.items() if key != "files"}
    manifest["files"] = records
    manifest["supportingFiles"] = ["README.zh.md", "verify.py", "verified-closure.json", "analysis.json", "analyze-native.py", "preparation-notes.json"]
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def verify(out, manifest, compare_originals=False):
    expected = {"manifest.json", *manifest["supportingFiles"]}
    originals = set()
    stored = set()
    for record in manifest["files"]:
        original = str(original_path(record))
        if original in originals or record["storedPath"] in stored:
            raise ValueError("Duplicate original or stored path")
        originals.add(original)
        stored.add(record["storedPath"])
        path = stored_path(out, record)
        if digest(path) != (record["storedBytes"], record["storedSha256"]):
            raise ValueError("Stored bytes or digest mismatch")
        raw_size = 0
        raw_hash = hashlib.sha256()
        for chunk in stream_raw(path, record["encoding"]):
            raw_size += len(chunk)
            raw_hash.update(chunk)
        if (raw_size, raw_hash.hexdigest()) != (record["originalBytes"], record["originalSha256"]):
            raise ValueError("Original bytes or digest mismatch")
        if compare_originals and digest(Path(original)) != (record["originalBytes"], record["originalSha256"]):
            raise ValueError("Original evidence changed")
        expected.add(record["storedPath"])
    actual = {str(path.relative_to(out)) for path in out.rglob("*") if path.is_file()}
    if actual != expected:
        raise ValueError("Archive inventory mismatch: " + repr((actual - expected, expected - actual)))
    for path in out.rglob("*"):
        if path.is_symlink():
            raise ValueError("Archive contains a link")


def extract(out, manifest, destination):
    root = Path(destination).absolute()
    if root.exists() or root.is_symlink():
        raise ValueError("Extraction requires a new directory")
    root.mkdir(parents=True, exist_ok=False)
    root = root.resolve()
    for record in manifest["files"]:
        original = original_path(record)
        target = root / str(original.relative_to("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.resolve().is_relative_to(root):
            raise ValueError("Restored path escaped the new directory")
        with target.open("xb") as stream:
            for chunk in stream_raw(stored_path(out, record), record["encoding"]):
                stream.write(chunk)
        if digest(target) != (record["originalBytes"], record["originalSha256"]):
            raise ValueError("Extracted file mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--inputs")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--compare-originals", action="store_true")
    parser.add_argument("--extract")
    args = parser.parse_args()
    out = Path(args.out)
    if args.inputs:
        plan = inventory(json.loads(Path(args.inputs).read_text(encoding="utf-8")))
        manifest = create(out, plan)
        print(json.dumps({"created": True, "payloads": len(manifest["files"]), "originalBytes": sum(r["originalBytes"] for r in manifest["files"]), "storedBytes": sum(r["storedBytes"] for r in manifest["files"])}))
    else:
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        verify(out, manifest, args.compare_originals)
        for row in manifest.get("supportingFilePins", []):
            path = out / row["path"]
            if digest(path) != (row["bytes"], row["sha256"]):
                raise ValueError("Supporting file bytes differ")
        if args.extract:
            extract(out, manifest, args.extract)
        print(json.dumps({"pass": True, "payloads": len(manifest["files"]), "originalBytes": sum(r["originalBytes"] for r in manifest["files"]), "storedBytes": sum(r["storedBytes"] for r in manifest["files"]), "originalsCompared": args.compare_originals, "extracted": bool(args.extract)}))

if __name__ == "__main__":
    main()
