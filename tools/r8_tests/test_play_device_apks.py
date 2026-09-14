"""Synthetic command fixtures; these do not assert Android runtime success."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_play_device_apks import build_play_device_apks, validate_device_spec


class ConnectedSplitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.aab = self.root / 'app.aab'; self.aab.write_bytes(b'synthetic unchanged bundle')
        (self.root / 'bundletool.jar').touch()
        key = self.root / 'original.keystore'; key.touch()
        self.output = self.root / 'device.apks'
        self.signing = dict(BLOFY_RELEASE_KEYSTORE_PATH=str(key), BLOFY_RELEASE_KEY_ALIAS='original',
                            BLOFY_RELEASE_STORE_PASSWORD='synthetic-store-secret',
                            BLOFY_RELEASE_KEY_PASSWORD='synthetic-key-secret')
        self.spec = dict(supportedAbis=['x86_64', 'x86'], supportedLocales=['en-US'],
                         screenDensity=160, sdkVersion=35, deviceFeatures=['android.hardware.type.pc'])
        self.api = '35'; self.abi = 'x86_64'
        self.saved_paths = []
        self.command = Mock(side_effect=self.respond)
        self.adb = Mock(side_effect=lambda *args: (self.api if args[-1] == 'ro.build.version.sdk' else self.abi) + '\n')

    def respond(self, *args, **kwargs):
        values = [str(x) for x in args]
        def flag(prefix): return Path(next(x[len(prefix):] for x in values if x.startswith(prefix)))
        self.assertIn('--device-id=emulator-5554', values) if 'get-device-spec' in values else None
        if 'get-device-spec' in values:
            flag('--output=').write_text(json.dumps(self.spec))
        elif 'build-apks' in values:
            spec_path = flag('--device-spec=')
            self.assertEqual(json.loads(spec_path.read_text()), self.spec)
            self.saved_paths.append(spec_path)
            for prefix, name in (('--ks-pass=file:', 'BLOFY_RELEASE_STORE_PASSWORD'),
                                 ('--key-pass=file:', 'BLOFY_RELEASE_KEY_PASSWORD')):
                path = flag(prefix); self.saved_paths.append(path)
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(path.read_text(), self.signing[name])
                self.assertNotIn(self.signing[name], ' '.join(values))
            self.assertNotIn('--mode=universal', values)
            self.assertNotIn('--overwrite', values)
            with zipfile.ZipFile(flag('--output='), 'w') as z: z.writestr('splits/base-master.apk', b'fixture')
        else: self.fail('Unexpected command')
        return ''

    def build(self, **extra):
        return build_play_device_apks(self.command, self.adb, sdk=self.root/'sdk', run=self.root,
                                      aab=self.aab, output=self.output, signing=self.signing, **extra)

    def test_uses_measured_density_and_full_spec_including_features(self):
        result = self.build()
        self.assertEqual(result['spec']['screenDensity'], 160)
        self.assertEqual(result['source'], 'bundletool-connected-emulator')
        self.assertEqual(result['spec_sha256'], hashlib.sha256(json.dumps(self.spec).encode()).hexdigest())
        self.assertEqual(self.command.call_count, 2)
        self.assertTrue(all(not p.exists() for p in self.saved_paths))
        self.assertEqual(list(self.root.glob('play-device-*')), [])

    def test_a_different_measured_density_and_locale_is_not_replaced_with_420(self):
        self.spec['screenDensity'] = 640; self.spec['supportedLocales'] = ['ar-SA']
        result = self.build()
        self.assertEqual(result['spec']['screenDensity'], 640)
        self.assertEqual(result['spec']['supportedLocales'], ['ar-SA'])

    def test_stale_output_rejected_before_commands(self):
        self.output.write_bytes(b'stale')
        with self.assertRaisesRegex(RuntimeError, 'stale'): self.build()
        self.command.assert_not_called()
        self.assertEqual(self.output.read_bytes(), b'stale')

    def test_other_device_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Unexpected'): self.build(serial='emulator-5556')
        self.command.assert_not_called()

    def test_missing_signing_input_rejected_without_secret_value(self):
        self.signing['BLOFY_RELEASE_KEY_ALIAS'] = ''
        with self.assertRaisesRegex(RuntimeError, 'Missing original'): self.build()
        self.command.assert_not_called()

    def test_missing_bundletool_or_bundle_rejected(self):
        (self.root/'bundletool.jar').unlink()
        with self.assertRaisesRegex(RuntimeError, 'Missing Play'): self.build()
        self.command.assert_not_called()

    def test_abi_mismatch_stops_before_signing(self):
        self.spec['supportedAbis'] = ['arm64-v8a']
        with self.assertRaisesRegex(RuntimeError, 'ABI'): self.build()
        self.assertEqual(self.command.call_count, 1)
        self.assertFalse(self.output.exists())

    def test_api_mismatch_stops_before_signing(self):
        self.spec['sdkVersion'] = 36
        with self.assertRaisesRegex(RuntimeError, 'API'): self.build()
        self.assertEqual(self.command.call_count, 1)

    def test_missing_measured_api_stops_before_commands(self):
        self.api = ''
        with self.assertRaisesRegex(RuntimeError, 'API'): self.build()
        self.command.assert_not_called()

    def test_spec_command_failure_cleans_private_directory(self):
        self.command.side_effect = RuntimeError('synthetic command failure')
        with self.assertRaisesRegex(RuntimeError, 'command failure'): self.build()
        self.assertEqual(list(self.root.glob('play-device-*')), [])

    def test_malformed_spec_cannot_trigger_signing(self):
        def malformed(*args, **kwargs):
            for value in map(str, args):
                if value.startswith('--output='): Path(value.split('=',1)[1]).write_text('not-json')
        self.command.side_effect = malformed
        with self.assertRaises(json.JSONDecodeError): self.build()
        self.assertEqual(self.command.call_count, 1)
        self.assertEqual(list(self.root.glob('play-device-*')), [])

    def test_build_failure_cleans_both_password_files(self):
        def failed(*args, **kwargs):
            result = self.respond(*args, **kwargs)
            if 'build-apks' in args: raise RuntimeError('synthetic build failure')
            return result
        self.command.side_effect = failed
        with self.assertRaisesRegex(RuntimeError, 'build failure'): self.build()
        self.assertTrue(all(not p.exists() for p in self.saved_paths))

    def test_build_success_without_zip_is_rejected(self):
        def invalid(*args, **kwargs):
            result = self.respond(*args, **kwargs)
            if 'build-apks' in args: self.output.write_bytes(b'not an APK archive')
            return result
        self.command.side_effect = invalid
        with self.assertRaisesRegex(RuntimeError, 'No generated'): self.build()

    def test_bundle_mutation_is_rejected(self):
        def mutate(*args, **kwargs):
            result = self.respond(*args, **kwargs)
            if 'build-apks' in args: self.aab.write_bytes(b'changed')
            return result
        self.command.side_effect = mutate
        with self.assertRaisesRegex(RuntimeError, 'AAB changed'): self.build()


class DeviceSpecValidationTests(unittest.TestCase):
    def test_missing_and_non_object_spec_rejected(self):
        for value in (None, [], {}, 'object'):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                validate_device_spec(value, abi='x86_64', api=35)

    def test_invalid_densities_rejected(self):
        for density in (0, -1, True, '420', 0.5, 10001):
            with self.subTest(density=density), self.assertRaises(RuntimeError):
                validate_device_spec(dict(supportedAbis=['x86_64'], supportedLocales=['ar'],
                                         screenDensity=density, sdkVersion=35), abi='x86_64', api=35)

    def test_invalid_locales_rejected(self):
        for locales in ([], 'en', ['en\nprivate'], [1]):
            with self.subTest(locales=locales), self.assertRaises(RuntimeError):
                validate_device_spec(dict(supportedAbis=['x86_64'], supportedLocales=locales,
                                         screenDensity=160, sdkVersion=35), abi='x86_64', api=35)


class SplitIntegrationTests(unittest.TestCase):
    def test_verifier_preserves_page_size_signatures_and_crash_gate(self):
        source=(Path(__file__).resolve().parents[1]/'verify_play_bundle.py').read_text()
        self.assertLess(source.index('page_size=probe_android_page_size('), source.index('device=build_play_device_apks('))
        self.assertIn('with zipfile.ZipFile(apks)', source)
        self.assertIn("'--apks='+str(apks)", source)
        self.assertIn('cases=require_play_runtime_evidence(result,crashes)', source)
        self.assertIn("'publication_allowed': False", source)
        self.assertIn("crashed = PACKAGE in crashes", source)
        self.assertIn("[1].lower()==CERT", source)

    def test_workflow_has_no_guessed_spec_or_early_split_generation(self):
        source=(Path(__file__).resolve().parents[2]/'.github/workflows/rc07-release.yml').read_text()
        self.assertNotIn('screenDensity":420', source)
        self.assertNotIn('play-device.json', source)
        self.assertNotIn(' build-apks ', source)
        self.assertIn('script: python3 tools/verify_play_bundle.py', source)
        self.assertIn('target: google_apis_ps16k', source)
        self.assertIn('tools/build_play_device_apks.py', source)


if __name__ == '__main__': unittest.main()
