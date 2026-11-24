#!/usr/bin/env python3
"""Decrypt a BLOFY DR archive offline, never connecting to production.

Download the encrypted .dump.gcm from the private S3 vault separately.
Run this only on a secured offline recovery workstation or disposable host.
"""
import argparse
import os
from pathlib import Path
import subprocess
from worker import decrypt_file


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encrypted", required=True, type=Path)
    parser.add_argument("--key-file", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    source = args.encrypted.resolve(strict=True)
    key_file = args.key_file.resolve(strict=True)
    target = args.out.resolve(strict=False)
    if source == target or key_file == target or target.exists():
        parser.error("Output must be a NEW file; existing files will never be overwritten")
    text = key_file.read_text(encoding="utf8")
    entries = [line[8:].strip() for line in text.splitlines() if line.startswith("KEY_HEX=")]
    if len(entries) != 1:
        parser.error("Key file must have one KEY_HEX line")
    try:
        key = bytes.fromhex(entries[0])
        if len(key) != 32:
            parser.error("Recovery key must be AES-256 (32 bytes)")
        mode = os.umask(0o077)
        try:
            decrypt_file(source, target, key)
        finally:
            os.umask(mode)
        subprocess.run(["pg_restore", "--list", str(target)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        target.unlink(missing_ok=True)
        raise SystemExit("Recovery archive verification FAILED; no production DB was touched")
    print("Recovery archive decrypted and pg_restore TOC verified.")
    print("Store the plaintext archive securely and restore ONLY to an isolated new PostgreSQL database.")
    print("Output path:", target)


if __name__ == "__main__":
    main()
