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


def same_bytes(a, b):
    with Path(a).open("rb") as left, Path(b).open("rb") as right:
        while True:
            aa = left.read(CHUNK); bb = right.read(CHUNK)
            if aa != bb:
                raise ValueError("Equal-digest source byte comparison failed")
            if not aa:
                return


def totals(manifest):
    unique = [row for row in manifest["files"] if "aliasOf" not in row]
    return {"sourceFiles":len(manifest["files"]), "uniquePayloads":len(unique),
            "aliases":len(manifest["files"])-len(unique),
            "originalBytes":sum(r["originalBytes"] for r in manifest["files"]),
            "storedBytes":sum(r["storedBytes"] for r in unique)}


class CountSink:
    def __init__(self): self.size = 0
    def write(self, data): self.size += len(data); return len(data)
    def flush(self): pass
    def tell(self): return self.size


def create(out, plan, dry_run=False, append=False, budget=16000000):
    if append:
        manifest = json.loads((out / "manifest.json").read_text())
    else:
        if (out / "manifest.json").exists() or (out / "payloads").exists():
            raise ValueError("Refuse to overwrite an archive")
        manifest = {key:value for key,value in plan.items() if key != "files"}
        manifest["schema"] = 3
        manifest["files"] = []
        manifest["supportingFiles"] = ["README.zh.md", "verify.py", "verified-closure.json", "analysis.json", "analyze-native.py", "preparation-notes.json", "verify-local.py", "local-proof.json"]
    canonical = {(r["originalBytes"],r["originalSha256"]):r for r in manifest["files"] if "aliasOf" not in r}
    seen = {str(original_path(r)) for r in manifest["files"]}
    count = len(canonical); stored_total = sum(r["storedBytes"] for r in canonical.values())
    added = []; skipped = []
    if not dry_run:
        out.mkdir(parents=True,exist_ok=True)
        (out / "payloads").mkdir(exist_ok=append)
    for item in plan["files"]:
        source = Path(str(original_path(item)))
        if str(source) in seen:
            old = next(r for r in manifest["files"] if str(original_path(r)) == str(source))
            if digest(source) != (old["originalBytes"],old["originalSha256"]):
                raise ValueError("Previously archived source changed")
            skipped.append(str(source)); continue
        before = source.stat()
        if (before.st_size,before.st_mtime_ns) != (item["inventoryBytes"],item["inventoryMtimeNs"]):
            raise ValueError("Input changed after inventory")
        size,sha = digest(source); key = (size,sha)
        row = {"group":item["group"],"originalPathBase64":item["originalPathBase64"],
               "originalBytes":size,"originalSha256":sha}
        if key in canonical:
            first = canonical[key]
            same_bytes(source, str(original_path(first)))
            row.update({field:first[field] for field in ["storedPath","encoding","storedBytes","storedSha256"]})
            row.update(aliasOf=first["payloadId"],duplicateVerifiedByFullByteComparison=True)
        else:
            count += 1; relative = f"payloads/id{count:04d}.bin.gz"
            sink = CountSink() if dry_run else (out / relative).open("xb")
            try:
                with gzip.GzipFile(filename="",mode="wb",fileobj=sink,compresslevel=6,mtime=0) as packed:
                    with source.open("rb") as raw:
                        for chunk in iter(lambda:raw.read(CHUNK),b""):packed.write(chunk)
                stored_size = sink.tell()
            finally:
                if not dry_run: sink.close()
            stored_sha = None if dry_run else digest(out / relative)[1]
            row.update(payloadId=f"p{count:04d}",storedPath=relative,encoding="gzip",
                       storedBytes=stored_size,storedSha256=stored_sha)
            canonical[key] = row; stored_total += stored_size
        after = source.stat()
        if (before.st_size,before.st_mtime_ns) != (after.st_size,after.st_mtime_ns):
            raise ValueError("Input changed during capture")
        seen.add(str(source)); added.append(row)
    manifest["files"].extend(added)
    if append:
        manifest["groups"].extend(plan["groups"])
        manifest["exclusions"].extend(plan["exclusions"])
        manifest.setdefault("appendHistory",[]).append({"identity":plan["identity"],"newSourceFiles":len(added),"alreadyRetainedPaths":skipped,"olderPayloadsUntouched":True})
    result = totals(manifest)
    result.update(dryRun=dry_run,budgetBytes=budget,budgetPassed=stored_total<=budget)
    if dry_run:
        print(json.dumps(result)); return manifest
    (out / "manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    if stored_total > budget:
        raise ValueError("Complete retained archive exceeded payload budget; stop without deleting any payload: " + str(stored_total))
    print(json.dumps(result)); return manifest


def verify(out, manifest, compare_originals=False):
    expected = {"manifest.json",*manifest["supportingFiles"]}
    originals = set(); canonical = {}; paths = set()
    fields = ["storedPath","encoding","originalBytes","originalSha256","storedBytes","storedSha256"]
    for record in manifest["files"]:
        original = str(original_path(record))
        if original in originals: raise ValueError("Duplicate original path")
        originals.add(original)
        path = stored_path(out,record)
        if "aliasOf" in record:
            first = canonical.get(record["aliasOf"])
            if first is None or "payloadId" in record or not record.get("duplicateVerifiedByFullByteComparison"):
                raise ValueError("Invalid explicit canonical alias")
            if any(record[f] != first[f] for f in fields):raise ValueError("Alias bytes or stored identity differ")
        else:
            pid = record["payloadId"]
            if pid in canonical or record["storedPath"] in paths:raise ValueError("Duplicate canonical payload")
            canonical[pid] = record;paths.add(record["storedPath"])
            if digest(path) != (record["storedBytes"],record["storedSha256"]):raise ValueError("Stored bytes differ")
            size = 0;h = hashlib.sha256()
            for chunk in stream_raw(path,record["encoding"]):size += len(chunk);h.update(chunk)
            if (size,h.hexdigest()) != (record["originalBytes"],record["originalSha256"]):raise ValueError("Decoded bytes differ")
        if compare_originals:
            with Path(original).open("rb") as raw, gzip.open(path,"rb") as packed:
                while True:
                    aa = raw.read(CHUNK);bb = packed.read(CHUNK)
                    if aa != bb:raise ValueError("Original full bytes differ from decoded canonical payload")
                    if not aa:break
        expected.add(record["storedPath"])
    actual = {str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()}
    if actual != expected:raise ValueError("Archive inventory mismatch: " + repr((actual-expected,expected-actual)))
    if any(p.is_symlink() for p in out.rglob("*")):raise ValueError("Archive contains a link")


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
    parser.add_argument("--out",required=True);parser.add_argument("--inputs")
    parser.add_argument("--append",action="store_true");parser.add_argument("--dry-run",action="store_true")
    parser.add_argument("--budget",type=int,default=16000000)
    parser.add_argument("--verify",action="store_true");parser.add_argument("--compare-originals",action="store_true")
    parser.add_argument("--extract")
    args = parser.parse_args();out = Path(args.out)
    if args.inputs:
        plan = inventory(json.loads(Path(args.inputs).read_text()))
        create(out,plan,args.dry_run,args.append,args.budget)
    else:
        manifest = json.loads((out/"manifest.json").read_text());verify(out,manifest,args.compare_originals)
        for row in manifest.get("supportingFilePins",[]):
            if digest(out/row["path"]) != (row["bytes"],row["sha256"]):raise ValueError("Supporting file changed")
        if args.extract:extract(out,manifest,args.extract)
        print(json.dumps({"pass":True,**totals(manifest),"originalsCompared":args.compare_originals,"extracted":bool(args.extract)}))

if __name__ == "__main__":main()
