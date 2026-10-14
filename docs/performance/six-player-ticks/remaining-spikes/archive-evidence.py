#!/usr/bin/env python3
"""Copy a closed capture set, preserve every byte, and verify the saved evidence."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
OLD = HERE.parent
OLD_DIGESTS = {
    "README.md": "5e5a8629f063a531480cae0430f6e6ec9f6cd9381c557b365d111b05c11e2355",
    "evidence-manifest.json": "7238181cde04bfbda527c76bf7f2a69f5b3ed89139883d13d77d2e7474b8f9df",
}
FULL_CHECKSUM = "7d94a5e8"
FULL_COMMAND_SHA = "771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load(path: Path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == ".gz" else raw)


def safe_relative(value: str) -> Path:
    path = Path(value)
    require(bool(value) and not path.is_absolute() and ".." not in path.parts,
            f"Destination must stay in this evidence subtree: {value}")
    return path


def files_under(root: Path) -> list[Path]:
    require(root.is_dir() and not root.is_symlink(), f"Missing capture root: {root}")
    entries = sorted(root.rglob("*"))
    require(not any(p.is_symlink() for p in entries), f"Capture contains a symlink: {root}")
    return [p for p in entries if p.is_file()]


def protected_original() -> dict:
    for name, digest in OLD_DIGESTS.items():
        require(sha((OLD / name).read_bytes()) == digest, f"Original evidence changed: {name}")
    original = load(OLD / "evidence-manifest.json")
    protected = dict(OLD_DIGESTS)
    for asset in original["assets"]:
        path = asset["storedPath"]
        data = (OLD / path).read_bytes()
        require(len(data) == asset["storedBytes"] and sha(data) == asset["storedSha256"],
                f"Original captured asset changed: {path}")
        protected[path] = sha(data)
    return {"sourceCommit": "086dffc5ae9e895f38e56f5ddedfa2ab0d7ac86d",
            "originalCapturedAssetCount": len(original["assets"]),
            "protectedFilesSha256": protected}


def execution_input(root: Path, name: str) -> bytes:
    path = root / name
    if path.exists():
        return path.read_bytes()
    compressed = root / (name + ".gz")
    require(compressed.exists(), f"Missing pinned execution input: {path}")
    return gzip.decompress(compressed.read_bytes())


def source_proof(root: Path) -> dict | None:
    env_path = root / "environment.json"
    inputs_path = root / "source-inputs.json.gz"
    if not env_path.exists() or not inputs_path.exists():
        return None
    env, captured = load(env_path), load(inputs_path)
    inputs = env["sourceInputs"]
    require(set(captured) == {item["path"] for item in inputs}, f"Source input set mismatch: {root}")
    for item in inputs:
        raw = captured[item["path"]].encode("utf-8")
        require(len(raw) == item["bytes"] and sha(raw) == item["sha256"],
                f"Source input bytes mismatch: {root}/{item['path']}")
    stripped = [{key: value for key, value in item.items() if key != "esbuildBytes"}
                for item in inputs]
    encoded = json.dumps(stripped, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    require(sha(encoded) == env["sourceManifestSha256"], f"Source manifest mismatch: {root}")
    paired = [("probe-source.ts", "probeSha256"), ("runtime.mjs", "bundleSha256"),
              ("focused-instrumentation-source.ts", "focusedInstrumentationSha256")]
    for name, key in paired:
        if env.get(key) is not None:
            require(sha(execution_input(root, name)) == env[key],
                    f"Pinned execution input mismatch: {root}/{name}")
    return {"captureDirectory": str(root), "gitHead": env["gitHead"],
            "gitStatus": env["gitStatus"], "sourceInputCount": len(inputs),
            "sourceManifestSha256": env["sourceManifestSha256"],
            "probeSha256": env["probeSha256"], "bundleSha256": env["bundleSha256"],
            "focusedInstrumentationSha256": env.get("focusedInstrumentationSha256"),
            "capturedSourceInputsVerified": True}


def native_proof(root: Path, oracle: bytes) -> dict | None:
    summary_path, frames_path = root / "summary.json", root / "command-frames.jsonl.gz"
    if not summary_path.exists() or not frames_path.exists():
        return None
    summary = load(summary_path)
    frames = gzip.decompress(frames_path.read_bytes())
    require(sha(frames) == summary["commandLogSha256"]
            and len(frames) == summary["commandLogBytes"], f"Command summary mismatch: {root}")
    lines = frames.splitlines(keepends=True)
    require(len(lines) == summary["frames"] == summary["ticks"], f"Frame count mismatch: {root}")
    require(all(json.loads(line)["tick"] == tick for tick, line in enumerate(lines)),
            f"Native tick sequence mismatch: {root}")
    is_full = summary["ticks"] == 14400
    expected = oracle if is_full else b"".join(oracle.splitlines(keepends=True)[:len(lines)])
    require(frames == expected, f"Complete native frame bytes differ from the original oracle: {root}")
    if is_full:
        require(summary["finalChecksum"] == FULL_CHECKSUM and summary["finalTick"] == 14400,
                f"Final state checksum differs: {root}")
    return {"captureDirectory": str(root), "comparison": "full" if is_full else "complete-prefix",
            "frames": len(lines), "nativeCommandBytes": len(frames), "nativeCommandSha256": sha(frames),
            "byteEqual": True, "reportedFinalChecksum": summary["finalChecksum"],
            "fullFinalChecksumEqual": True if is_full else None}


def original_oracle() -> bytes:
    root = OLD / "runs/step3-border"
    frames = gzip.decompress((root / "command-frames.jsonl.gz").read_bytes())
    require(sha(frames) == FULL_COMMAND_SHA and load(root / "summary.json")["finalChecksum"] == FULL_CHECKSUM,
            "Original full-match oracle mismatch")
    return frames


def copy_asset(source: Path, destination: Path, compress: bool) -> dict:
    require(source.is_file() and not source.is_symlink(), f"Missing captured file: {source}")
    raw = source.read_bytes()
    is_gzip = source.suffix == ".gz"
    require(not (is_gzip and compress), f"Already compressed capture must not be recompressed: {source}")
    if compress:
        destination = destination.with_name(destination.name + ".gz")
    require(not destination.exists(), f"Evidence file already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stored = gzip.compress(raw, compresslevel=9, mtime=0) if compress else raw
    destination.write_bytes(stored)
    reread = destination.read_bytes()
    restored = gzip.decompress(reread) if compress else reread
    require(restored == raw and source.read_bytes() == raw, f"Capture changed during copy: {source}")
    payload = gzip.decompress(reread) if (compress or is_gzip) else reread
    return {"capturePath": str(source), "storedPath": str(destination.relative_to(HERE)),
            "storageEncoding": "gzip-added" if compress else "gzip-original" if is_gzip else "identity",
            "captureBytes": len(raw), "captureSha256": sha(raw),
            "storedBytes": len(reread), "storedSha256": sha(reread),
            "restoredCaptureBytes": len(restored), "restoredCaptureSha256": sha(restored),
            "payloadBytes": len(payload), "payloadSha256": sha(payload),
            "independentReadAndRestoreEqual": True}


def archive(plan_path: Path) -> None:
    require(not (HERE / "evidence-manifest.json").exists(), "Archive already exists; verify it or choose a fresh subtree")
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes)
    require(plan["schema"] == 1, "Unsupported archive plan schema")
    before = protected_original()
    oracle = original_oracle()
    assets, directories, sources, commands = [], [], [], []
    all_source_files = set()
    for item in plan["capturedDirectories"]:
        source = Path(item["source"]).resolve()
        destination = HERE / safe_relative(item["destination"])
        require(not destination.exists(), f"Destination directory already exists: {destination}")
        require(source != HERE and HERE not in source.parents and source not in HERE.parents,
                f"Capture and archive roots overlap: {source}")
        originals = files_under(source)
        exact = [str(p.relative_to(source)) for p in originals]
        initial_hashes = {str(p.relative_to(source)): sha(p.read_bytes()) for p in originals}
        run_roots = {source, *(p.parent for p in originals if p.name == "environment.json")}
        for run in sorted(run_roots):
            stored_run = str((destination / run.relative_to(source)).relative_to(HERE))
            proof = source_proof(run)
            if proof is not None:
                proof["storedDirectory"] = stored_run
                sources.append(proof)
            proof = native_proof(run, oracle)
            if proof is not None:
                proof["storedDirectory"] = stored_run
                commands.append(proof)
        for path in originals:
            require(path not in all_source_files, f"Captured source duplicated: {path}")
            all_source_files.add(path)
            compress = path.name == "runtime.mjs" or path.suffix == ".log"
            assets.append(copy_asset(path, destination / path.relative_to(source), compress))
        require([str(p.relative_to(source)) for p in files_under(source)] == exact,
                f"Capture file set changed during archive: {source}")
        require(all(sha((source / path).read_bytes()) == digest for path, digest in initial_hashes.items()),
                f"Capture bytes changed during archive: {source}")
        directories.append({"source": str(source), "destination": item["destination"],
                            "exactOriginalFileNames": exact,
                            "exactStoredFileNames": sorted(str(p.relative_to(destination))
                                                          for p in files_under(destination))})
    for item in plan.get("capturedFiles", []):
        source = Path(item["source"]).resolve()
        require(source not in all_source_files, f"Captured source duplicated: {source}")
        all_source_files.add(source)
        compress = item.get("addedGzip", source.name == "runtime.mjs" or source.suffix == ".log")
        assets.append(copy_asset(source, HERE / safe_relative(item["destination"]), compress))
    require(protected_original() == before, "Original evidence changed during archive")
    manifest = {"schema": 1, "method": "Closed capture sets, byte-preserving storage, independent reread and restore",
                "planSha256": sha(plan_bytes), "originalEvidence": before,
                "capturedDirectories": directories, "assets": assets,
                "sourceInputsVerifiedAgainstPinnedEnvironment": sources,
                "nativeCommandEquality": commands,
                "nativeOracle": {"storedPathRelativeToThisSubtree": "../runs/step3-border/command-frames.jsonl.gz",
                                 "frames": 14400, "nativeCommandSha256": FULL_COMMAND_SHA,
                                 "finalChecksum": FULL_CHECKSUM}}
    (HERE / "archive-plan.json").write_bytes(plan_bytes)
    (HERE / "evidence-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    verify()


def verify() -> None:
    manifest = load(HERE / "evidence-manifest.json")
    require(protected_original() == manifest["originalEvidence"], "Original evidence no longer matches capture")
    require(sha((HERE / "archive-plan.json").read_bytes()) == manifest["planSha256"], "Archive plan changed")
    for item in manifest["capturedDirectories"]:
        actual = [str(p.relative_to(HERE / item["destination"])) for p in files_under(HERE / item["destination"])]
        require(actual == item["exactStoredFileNames"], f"Stored file set mismatch: {item['destination']}")
    for item in manifest["assets"]:
        stored = (HERE / item["storedPath"]).read_bytes()
        require(len(stored) == item["storedBytes"] and sha(stored) == item["storedSha256"],
                f"Stored bytes mismatch: {item['storedPath']}")
        restored = gzip.decompress(stored) if item["storageEncoding"] == "gzip-added" else stored
        require(len(restored) == item["captureBytes"] == item["restoredCaptureBytes"]
                and sha(restored) == item["captureSha256"] == item["restoredCaptureSha256"],
                f"Restored capture mismatch: {item['storedPath']}")
        payload = gzip.decompress(stored) if item["storageEncoding"] != "identity" else stored
        require(len(payload) == item["payloadBytes"] and sha(payload) == item["payloadSha256"],
                f"Compressed payload mismatch: {item['storedPath']}")
    for proof in manifest["sourceInputsVerifiedAgainstPinnedEnvironment"]:
        checked = source_proof(HERE / safe_relative(proof["storedDirectory"]))
        require(checked is not None and all(checked[key] == value for key, value in proof.items()
                                           if key not in ("captureDirectory", "storedDirectory")),
                f"Archived source identity mismatch: {proof['storedDirectory']}")
    oracle = original_oracle()
    for proof in manifest["nativeCommandEquality"]:
        checked = native_proof(HERE / safe_relative(proof["storedDirectory"]), oracle)
        require(checked is not None and all(checked[key] == value for key, value in proof.items()
                                           if key not in ("captureDirectory", "storedDirectory")),
                f"Archived native oracle mismatch: {proof['storedDirectory']}")
    print(json.dumps({"verifiedCapturedFiles": len(manifest["assets"]),
                      "fullNativeRuns": sum(p["comparison"] == "full" for p in manifest["nativeCommandEquality"]),
                      "originalCapturedAssetCount": manifest["originalEvidence"]["originalCapturedAssetCount"]}))


def append_file(source: Path, destination: str) -> None:
    """Add a completed post-archive validation log without replacing any capture."""
    verify()
    manifest = load(HERE / "evidence-manifest.json")
    before = protected_original()
    source = source.resolve()
    require(str(source) not in {item["capturePath"] for item in manifest["assets"]},
            f"Capture already archived: {source}")
    asset = copy_asset(source, HERE / safe_relative(destination), source.suffix == ".log")
    require(protected_original() == before, "Original evidence changed during append")
    manifest["assets"].append(asset)
    manifest.setdefault("postArchiveValidationCaptures", []).append({
        "source": str(source), "destination": asset["storedPath"],
        "captureSha256": asset["captureSha256"],
        "purpose": "Completed validation after the main archive existed; earlier captures are unchanged."})
    (HERE / "evidence-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    verify()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    capture = sub.add_parser("archive", help="Archive a final, explicit closed capture plan")
    capture.add_argument("--plan", type=Path, required=True)
    sub.add_parser("verify", help="Verify all stored/restored bytes and preserved original evidence")
    late = sub.add_parser("append-file", help="Append a closed post-archive validation log")
    late.add_argument("--source", type=Path, required=True)
    late.add_argument("--destination", required=True)
    args = parser.parse_args()
    if args.action == "archive":
        archive(args.plan)
    elif args.action == "append-file":
        append_file(args.source, args.destination)
    else:
        verify()


if __name__ == "__main__":
    main()
