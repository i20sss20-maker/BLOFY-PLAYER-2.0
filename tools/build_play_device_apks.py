"""Generate signed Play splits for the measured CI emulator, never a guessed spec."""
from collections.abc import Callable, Mapping
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile


def validate_device_spec(spec: object, *, abi: str, api: int) -> dict:
    """Require the expected emulator; keep density/locales from bundletool unchanged."""
    if not isinstance(spec, dict):
        raise RuntimeError("Missing connected-emulator device specification")
    abis = spec.get("supportedAbis")
    locales = spec.get("supportedLocales")
    density = spec.get("screenDensity")
    sdk = spec.get("sdkVersion")
    if abi != "x86_64" or not isinstance(abis, list) or not abis or abis[0] != abi:
        raise RuntimeError("Play split specification does not match the selected emulator ABI")
    if api != 35 or type(sdk) is not int or sdk != api:
        raise RuntimeError("Play split specification does not match the selected emulator API")
    if type(density) is not int or not 1 <= density <= 10000:
        raise RuntimeError("Invalid measured emulator screen density")
    if (not isinstance(locales, list) or not locales or len(locales) > 100 or
            not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", x) for x in locales)):
        raise RuntimeError("Invalid measured emulator locales")
    if not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", x) for x in abis):
        raise RuntimeError("Invalid measured emulator ABIs")
    return {"supportedAbis": abis, "supportedLocales": locales,
            "screenDensity": density, "sdkVersion": sdk}


def build_play_device_apks(command: Callable[..., str], adb: Callable[..., str], *,
                           sdk: Path, run: Path, aab: Path, output: Path,
                           signing: Mapping[str, str], serial: str = "emulator-5554") -> dict:
    """The caller must still audit/signature-check every split and run all runtime gates."""
    if serial != "emulator-5554":
        raise RuntimeError("Unexpected Play verification device")
    if not aab.is_file() or not (run / "bundletool.jar").is_file() or output.exists():
        raise RuntimeError("Missing Play build inputs or stale split archive")
    required = ("BLOFY_RELEASE_KEYSTORE_PATH", "BLOFY_RELEASE_KEY_ALIAS",
                "BLOFY_RELEASE_STORE_PASSWORD", "BLOFY_RELEASE_KEY_PASSWORD")
    if any(not signing.get(k) for k in required) or not Path(signing[required[0]]).is_file():
        raise RuntimeError("Missing original Play signing inputs")
    abi = adb("shell", "getprop", "ro.product.cpu.abi").strip()
    raw_api = adb("shell", "getprop", "ro.build.version.sdk").strip()
    if not raw_api.isdecimal():
        raise RuntimeError("Missing measured emulator API")
    tool = ("java", "-jar", run / "bundletool.jar")
    aab_hash = hashlib.sha256(aab.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(dir=run, prefix="play-device-") as directory:
        private = Path(directory)
        spec_path = private / "device.json"
        command(*tool, "get-device-spec", "--output=" + str(spec_path),
                "--adb=" + str(sdk / "platform-tools/adb"), "--device-id=" + serial,
                timeout=90)
        spec_bytes = spec_path.read_bytes()
        summary = validate_device_spec(json.loads(spec_bytes), abi=abi, api=int(raw_api))
        # Password values never enter command arguments, logs or retained artifacts.
        passwords = []
        for name, key in (("store-password", required[2]), ("key-password", required[3])):
            path = private / name
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                handle.write(signing[key])
            passwords.append(path)
        command(*tool, "build-apks", "--bundle=" + str(aab), "--output=" + str(output),
                "--device-spec=" + str(spec_path), "--ks=" + signing[required[0]],
                "--ks-key-alias=" + signing[required[1]],
                "--ks-pass=file:" + str(passwords[0]), "--key-pass=file:" + str(passwords[1]),
                timeout=240)
        if not output.is_file() or not zipfile.is_zipfile(output):
            raise RuntimeError("No generated Play split archive")
        if hashlib.sha256(aab.read_bytes()).hexdigest() != aab_hash:
            raise RuntimeError("Play AAB changed while generating device splits")
    return {"source": "bundletool-connected-emulator", "spec": summary,
            "spec_sha256": hashlib.sha256(spec_bytes).hexdigest()}
