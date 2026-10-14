#!/usr/bin/env python3
"""Verify the exact prepared delivery and both byte-preserving archives."""
import argparse
import gzip
import hashlib
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath


def digest(path):
    length = 0
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            length += len(chunk)
            checksum.update(chunk)
    return length, checksum.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()
    out = Path(args.out).resolve()
    closure = json.loads((out / "verified-closure.json").read_text(encoding="utf-8"))
    expected = {"verified-closure.json"}
    for row in closure["files"]:
        relative = PurePosixPath(row["path"])
        path = out / str(relative)
        if relative.is_absolute() or ".." in relative.parts or path.is_symlink():
            raise ValueError("Invalid delivery path")
        if not path.resolve().is_relative_to(out):
            raise ValueError("Delivery path escaped root")
        if digest(path) != (row["bytes"], row["sha256"]):
            raise ValueError("Delivery bytes differ: " + row["path"])
        if row["path"] in expected:
            raise ValueError("Duplicate delivery path")
        expected.add(row["path"])
    actual = {str(path.relative_to(out)) for path in out.rglob("*") if path.is_file()}
    if actual != expected or any(path.is_symlink() for path in out.rglob("*")):
        raise ValueError("Delivery inventory differs")
    validation = json.loads((out / "validation/manifest.json").read_text(encoding="utf-8"))
    for row in validation["files"]:
        relative = PurePosixPath(row["storedPath"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid validation path")
        path = out / "validation" / str(relative)
        if digest(path) != (row["storedBytes"], row["storedSha256"]):
            raise ValueError("Validation stored bytes differ")
        length = 0
        checksum = hashlib.sha256()
        with gzip.open(path, "rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                length += len(chunk)
                checksum.update(chunk)
        if (length, checksum.hexdigest()) != (row["originalBytes"], row["originalSha256"]):
            raise ValueError("Validation decoded bytes differ")
    subprocess.run([sys.executable, str(out / "production/verify.py"),
                    "--out", str(out / "production")], check=True)
    subprocess.run([sys.executable, str(out / "convex-sort/verify.py"),
                    "--out", str(out / "convex-sort"), "--verify"], check=True)
    print(json.dumps({"pass": True, "files": len(expected),
                      "mainSha": closure["mainSha"],
                      "wholeTargetPassed": False,
                      "experimentalSourceAdopted": False}))


if __name__ == "__main__":
    main()
