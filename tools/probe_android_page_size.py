"""Measure Android userspace page size without depending on a getconf applet.

Build a disposable, dynamically linked NDK executable. Both values come from
Bionic at runtime, including in Google's x86_64 16 KB userspace simulation.
Neither an image name, ELF alignment nor host kernel page size is evidence.
This tool never touches app files, credentials, signing material or networking.
"""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import re
import tempfile

PROBE_SOURCE = r'''#include <stdio.h>
#include <unistd.h>
int main(void) {
    long configured = sysconf(_SC_PAGESIZE);
    int measured = getpagesize();
    if (configured <= 0 || measured <= 0 || configured != measured) return 2;
    if (printf("%ld %d\n", configured, measured) < 0) return 3;
    return 0;
}
'''


def require_16kb_output(output: str) -> int:
    """Accept only two matching runtime readings of exactly 16384 bytes."""
    match = re.fullmatch(r"([0-9]+) ([0-9]+)\r?\n?", output)
    if not match:
        raise RuntimeError("Malformed Android page-size evidence")
    configured, measured = map(int, match.groups())
    if configured != measured:
        raise RuntimeError("Android page-size APIs disagree")
    if configured != 16384:
        raise RuntimeError(f"16 KB Android userspace required; measured {configured} bytes")
    return configured


def probe_android_page_size(
    adb: Callable[..., str], command: Callable[..., str], *,
    sdk: Path, ndk_version: str, run: Path,
) -> int:
    """Probe the explicitly selected CI emulator; failures stop publication."""
    abi = adb("shell", "getprop", "ro.product.cpu.abi").strip()
    triples = {"x86_64": "x86_64-linux-android", "arm64-v8a": "aarch64-linux-android"}
    if abi not in triples:
        raise RuntimeError("Unsupported ABI for Android page-size probe")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", ndk_version):
        raise RuntimeError("Invalid pinned NDK version")
    compiler = sdk / "ndk" / ndk_version / "toolchains/llvm/prebuilt/linux-x86_64/bin" / (triples[abi] + "35-clang")
    if not compiler.is_file():
        raise RuntimeError("Pinned Android NDK compiler is missing")
    with tempfile.TemporaryDirectory(dir=run, prefix="blofy-pagesize-") as temp:
        work = Path(temp)
        source = work / "probe.c"
        binary = work / "probe"
        source.write_text(PROBE_SOURCE, encoding="utf-8")
        # No static libc, PAGE_SIZE macro, baked-in 16384 output or app libraries.
        command(compiler, "-std=c11", "-D_DEFAULT_SOURCE", "-Wall", "-Wextra", "-Werror",
                "-fPIE", "-pie", "-Wl,-z,max-page-size=16384", source, "-o", binary,
                timeout=120)
        remote = "/data/local/tmp/" + work.name
        try:
            adb("push", binary, remote)
            adb("shell", "chmod", "700", remote)
            output = adb("shell", remote)
        finally:
            # Delete only this invocation's disposable probe, even on failure.
            adb("shell", "rm", "-f", remote)
        return require_16kb_output(output)
