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
    manifest["supportingFiles"] = ["README.zh.md", "verify.py", "verified-closure.json", "statistics.json", "analyze-native.py", "local-review.json"]
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


def review_closure(out, manifest, repo, isolated):
    """Compare complete archived commands and input bytes with fixed Git objects."""
    lookup = {str(original_path(row)): row for row in manifest["files"]}

    def raw(path):
        row = lookup[path]
        return b"".join(stream_raw(stored_path(out, row), row["encoding"]))

    def load(path):
        data = raw(path)
        if path.endswith(".gz"):
            data = gzip.decompress(data)
        return json.loads(data)

    def git_bytes(repository, head, paths):
        refs = [head + ":" + path for path in paths]
        result = subprocess.run(["git", "-C", str(repository), "cat-file", "--batch"],
                                input=("\n".join(refs) + "\n").encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        data = result.stdout
        at = 0
        objects = {}
        for path in paths:
            end = data.index(b"\n", at)
            header = data[at:end].split()
            if len(header) != 3 or header[1] != b"blob":
                raise ValueError("Missing Git input blob")
            size = int(header[2])
            at = end + 1
            objects[path] = data[at:at + size]
            at += size
            if data[at:at + 1] != b"\n":
                raise ValueError("Invalid Git batch boundary")
            at += 1
        if at != len(data):
            raise ValueError("Extra Git batch bytes")
        return objects

    baseline = manifest["identity"]["baselineHead"]
    candidate = manifest["identity"]["candidateHead"]
    isolated_head = manifest["identity"]["candidateHead"]
    base = "/workspace/whole-performance-abba-e51-eef"
    runs = ["A1", "B1", "B2", "A2", "Bplain"]
    sources = {name: load(f"{base}/{name}/source-inputs.json.gz") for name in runs}
    paths = sorted(sources["B1"])
    if len(paths) != 241 or any(sorted(value) != paths for value in sources.values()):
        raise ValueError("Input path closure differs")
    fixed = {
        "baseline": git_bytes(repo, baseline, paths),
        "candidate": git_bytes(repo, candidate, paths),
        "isolated": git_bytes(isolated, isolated_head, paths),
    }
    source_rows = []
    for path in paths:
        reference = sources["A1"][path].encode("utf-8")
        measured = sources["B1"][path].encode("utf-8")
        if fixed["baseline"][path] != reference or sources["A2"][path].encode("utf-8") != reference:
            raise ValueError("Baseline input bytes differ")
        if any(sources[name][path].encode("utf-8") != measured for name in ["B2", "Bplain"]):
            raise ValueError("Candidate arms have different input bytes")
        if fixed["candidate"][path] != measured or fixed["isolated"][path] != measured:
            raise ValueError("Candidate and isolated Git input bytes differ")
        source_rows.append({"pathBase64": encode_path(path),
                            "baselineBytes": len(reference),
                            "baselineSha256": hashlib.sha256(reference).hexdigest(),
                            "candidateBytes": len(measured),
                            "candidateSha256": hashlib.sha256(measured).hexdigest(),
                            "changed": reference != measured})

    expected_commands = gzip.decompress(raw(f"{base}/A1/command-frames.jsonl.gz"))
    command_rows = []
    for prefix in [f"{base}/{name}" for name in runs] + [
        "/workspace/whole-performance-abba-ce9-8718/A1",
    ]:
        path = prefix + "/command-frames.jsonl.gz"
        commands = gzip.decompress(raw(path))
        summary = load(prefix + "/summary.json")
        if commands != expected_commands:
            raise ValueError("Complete native command bytes differ")
        if len(commands) != 618189 or commands.count(b"\n") != 14400:
            raise ValueError("Native command byte or frame count differs")
        if (summary["ticks"], summary["finalTick"], summary["rulesVersion"],
            summary["checksumVersion"], summary["finalChecksum"]) != (14400, 14400, 3, 18, "7d94a5e8"):
            raise ValueError("Native replay closure differs")
        command_rows.append({"pathBase64": encode_path(path), "bytes": len(commands),
                             "sha256": hashlib.sha256(commands).hexdigest(),
                             "comparedCompleteBytes": True, "frames": 14400,
                             "finalChecksum": summary["finalChecksum"]})

    tick_reference = load(f"{base}/A1/ticks.json.gz")
    tick_rows = []
    for name in runs:
        environment = load(f"{base}/{name}/environment.json")
        summary = load(f"{base}/{name}/summary.json")
        source = sources[name]
        if environment["gitHead"] != (baseline if name.startswith("A") else candidate):
            raise ValueError("Measured source head differs")
        if len(environment["sourceInputs"]) != 241:
            raise ValueError("Recorded source count differs")
        for row in environment["sourceInputs"]:
            data = source[row["path"]].encode("utf-8")
            if (len(data), hashlib.sha256(data).hexdigest()) != (row["bytes"], row["sha256"]):
                raise ValueError("Recorded input identity differs")
        for filename, field in [("probe-source.ts", "probeSha256"), ("runtime.mjs", "bundleSha256")]:
            if hashlib.sha256(raw(f"{base}/{name}/{filename}")).hexdigest() != environment[field]:
                raise ValueError("Recorded executed tool bytes differ")
        if name != "Bplain":
            ticks = load(f"{base}/{name}/ticks.json.gz")
            if len(ticks) != 14400:
                raise ValueError("Tick count differs")
            for reference, tick in zip(tick_reference, ticks):
                for field in ["tick", "tickAfter", "mod15", "units", "buildings"]:
                    if reference[field] != tick[field]:
                        raise ValueError("Tick state or phase differs")
                if [(row["owner"], row["version"]) for row in reference["ownerPlans"]] != [
                    (row["owner"], row["version"]) for row in tick["ownerPlans"]]:
                    raise ValueError("Planning owner order differs")
        tick_rows.append({"arm": name, "head": environment["gitHead"],
                          "sourceInputs": 241, "probeSha256": environment["probeSha256"],
                          "bundleSha256": environment["bundleSha256"],
                          "nativeTicks": summary["ticks"],
                          "targetPassed": summary["timing"]["wholeMs"]["p99"] <= 16
                          and summary["timing"]["wholeMs"]["max"] <= 50})
    changed = [row["pathBase64"] for row in source_rows if row["changed"]]
    if len(changed) != 2:
        raise ValueError("Runtime change scope differs")
    return {"schema": 1, "verified": True, "baselineHead": baseline,
            "candidateHead": candidate, "isolatedHead": isolated_head,
            "archivedSourceBytesComparedWithGitBlobs": True,
            "inputCount": 241, "changedPathsBase64": changed,
            "sourceRows": source_rows, "commandRows": command_rows, "arms": tick_rows,
            "performanceTargetPassed": False,
            "archiveVerifierSha256": digest(out / "verify.py")[1],
            "payloads": len(manifest["files"]),
            "originalBytes": sum(row["originalBytes"] for row in manifest["files"]),
            "storedBytes": sum(row["storedBytes"] for row in manifest["files"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--inputs")
    parser.add_argument("--inventory", help="Write a plan before creating payloads")
    parser.add_argument("--plan", help="Create payloads from a frozen inventory plan")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--compare-originals", action="store_true")
    parser.add_argument("--extract", help="Verify and restore below a new directory")
    parser.add_argument("--review-closure", action="store_true")
    parser.add_argument("--repo", help="Repository containing the fixed A/B Git objects")
    parser.add_argument("--isolated", help="Repository containing the fixed isolated Git object")
    args = parser.parse_args()
    out = Path(args.out)
    if args.review_closure:
        if not args.repo or not args.isolated:
            parser.error("--review-closure requires --repo and --isolated")
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        result = review_closure(out, manifest, args.repo, args.isolated)
        target = out / "verified-closure.json"
        encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if target.exists():
            if target.read_text(encoding="utf-8") != encoded:
                raise ValueError("Refuse to overwrite a different closure record")
        else:
            target.write_text(encoded, encoding="utf-8")
        print(json.dumps({"verified": True, "inputCount": result["inputCount"],
                          "commandCopies": len(result["commandRows"]),
                          "changedFiles": len(result["changedPathsBase64"]),
                          "performanceTargetPassed": False}))
        return
    if args.inventory:
        if not args.inputs:
            parser.error("--inventory requires --inputs")
        plan = inventory(json.loads(Path(args.inputs).read_text(encoding="utf-8")))
        Path(args.inventory).write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"files": len(plan["files"]), "originalBytes": sum(row["inventoryBytes"] for row in plan["files"]),
                          "exclusions": len(plan["exclusions"])}))
        return
    if args.verify or args.extract:
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        verify(out, manifest, args.compare_originals)
        if args.extract:
            extract(out, manifest, args.extract)
        print(json.dumps({"pass": True, "payloads": len(manifest["files"]),
                          "originalBytes": sum(row["originalBytes"] for row in manifest["files"]),
                          "storedBytes": sum(row["storedBytes"] for row in manifest["files"]),
                          "originalsCompared": args.compare_originals, "extracted": bool(args.extract)}))
        return
    if not args.plan:
        parser.error("--plan, --inventory, or --verify is required")
    manifest = create(out, json.loads(Path(args.plan).read_text(encoding="utf-8")))
    print(json.dumps({"payloads": len(manifest["files"]),
                      "originalBytes": sum(row["originalBytes"] for row in manifest["files"]),
                      "storedBytes": sum(row["storedBytes"] for row in manifest["files"])}))


if __name__ == "__main__":
    main()
