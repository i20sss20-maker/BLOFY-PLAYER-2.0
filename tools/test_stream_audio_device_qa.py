import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "device_qa", Path(__file__).with_name("stream-audio-device-qa.py")
)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class AudioQATest(unittest.TestCase):
    def test_only_allowlisted_events_and_never_urls(self):
        raw = "\n".join([
            "I BLOFY_AUDIO_HEALTH: state=UNSUPPORTED_AUDIO_CODEC;available=1;supported=0;selected=0;mime=none password=private",
            "I BLOFY_AUDIO_RECOVERY: supported_audio_selected_once",
            "I BLOFY_DIAG: http://upstream.example/live/secret?username=private",
            "I BLOFY_AUDIO_HEALTH: state=AUDIO_TRACK_SELECTED;available=1;supported=1;selected=1;mime=audio/eac3",
            "I BLOFY_AUDIO_HEALTH: state=BOGUS;available=1;supported=1;selected=1;mime=audio/aac",
        ])
        events, recovered = qa.parse_audio_lines(raw)
        self.assertEqual(recovered, 1)
        self.assertEqual([x["state"] for x in events],
                         ["UNSUPPORTED_AUDIO_CODEC", "AUDIO_TRACK_SELECTED"])
        self.assertEqual(events[-1]["mime"], "audio/eac3")
        self.assertNotIn("private", str(events))
        self.assertNotIn("secret", str(events))

    def test_fails_closed_on_untrusted_codec_or_inconsistent_counts(self):
        raw = "\n".join([
            "I BLOFY_AUDIO_HEALTH: state=AUDIO_TRACK_SELECTED;available=200;supported=1;selected=1;mime=audio/aac",
            "I BLOFY_AUDIO_HEALTH: state=AUDIO_TRACK_SELECTED;available=1;supported=9;selected=1;mime=audio/aac",
            "I BLOFY_AUDIO_HEALTH: state=AUDIO_TRACK_SELECTED;available=1;supported=1;selected=1;mime=https://bad?x=secret",
        ])
        self.assertEqual(qa.parse_audio_lines(raw)[0], [])

    def test_deduplicates_identical_events(self):
        row = "I BLOFY_AUDIO_HEALTH: state=NO_AUDIO_TRACK;available=0;supported=0;selected=0;mime=none\n"
        self.assertEqual(len(qa.parse_audio_lines(row * 100)[0]), 1)

    def test_never_returns_more_than_fifty_observations(self):
        raw = "\n".join(
            "I BLOFY_AUDIO_HEALTH: state=SUPPORTED_NOT_SELECTED;available=%d;supported=1;selected=0;mime=none" % i
            for i in range(1, 75)
        )
        self.assertEqual(len(qa.parse_audio_lines(raw)[0]), 50)


if __name__ == "__main__":
    unittest.main()
