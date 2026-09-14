#!/usr/bin/env python3
"""Read-only APK identity and native-page alignment evidence; no Android SDK needed.

This does not execute the app or verify its Android signing block. Use apksigner and
the signed release's upgrade gate for those separate checks.
"""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def elf_loads(data):
    if len(data) < 16 or data[:4] != b'\x7fELF' or data[4] not in (1, 2) or data[5] not in (1, 2):
        raise ValueError('invalid ELF header')
    bits = 64 if data[4] == 2 else 32
    endian = '<' if data[5] == 1 else '>'
    wide = bits == 64
    try:
        start = struct.unpack_from(endian + ('Q' if wide else 'I'), data, 32 if wide else 28)[0]
        size, count = struct.unpack_from(endian + 'HH', data, 54 if wide else 42)
        if size < (56 if wide else 32) or not count or start + size * count > len(data):
            raise ValueError('invalid ELF program headers')
        loads = []
        for index in range(count):
            header = start + index * size
            if struct.unpack_from(endian + 'I', data, header)[0] != 1:
                continue
            offset, address = struct.unpack_from(endian + ('QQ' if wide else 'II'), data, header + (8 if wide else 4))
            alignment = struct.unpack_from(endian + ('Q' if wide else 'I'), data, header + (48 if wide else 28))[0]
            loads.append({'alignment': alignment, 'offset': offset, 'address': address,
                          'page_16kb': alignment >= 16384 and alignment & (alignment - 1) == 0
                          and (address - offset) % 16384 == 0})
    except struct.error as error:
        raise ValueError('truncated ELF') from error
    if not loads:
        raise ValueError('ELF has no loadable segments')
    return bits, loads


def audit(path):
    raw = Path(path).read_bytes()
    libraries = []
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            if not entry.filename.startswith('lib/') or not entry.filename.endswith('.so'):
                continue
            if entry.file_size > 128 * 1024 * 1024:
                raise ValueError('native library exceeds audit bound')
            bits, loads = elf_loads(archive.read(entry))
            name_length, extra_length = struct.unpack_from('<HH', raw, entry.header_offset + 26)
            data_offset = entry.header_offset + 30 + name_length + extra_length
            libraries.append({'path': entry.filename, 'bits': bits, 'loads': loads,
                              'elf_16kb': all(segment['page_16kb'] for segment in loads),
                              'stored_uncompressed': entry.compress_type == zipfile.ZIP_STORED,
                              'zip_16kb': data_offset % 16384 == 0 if entry.compress_type == zipfile.ZIP_STORED else None})
    return {'apk_sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'libraries': libraries,
            'limits': 'Static ELF/ZIP alignment only. Does not prove execution on a 16 KB device or AAB split alignment.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk')
    parser.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    result = audit(args.apk)
    if result['apk_sha256'] != args.expected_sha256.lower():
        raise SystemExit('APK SHA-256 does not match the expected published artifact')
    print(json.dumps(result, indent=2))
