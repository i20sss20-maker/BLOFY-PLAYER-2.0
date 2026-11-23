import unittest
from qa_release_gate import check


def sample():
    required = ['android_tv|stc_wifi', 'web_vidaa|stc_wifi', 'windows|broadband']
    sessions = []
    for cohort in required:
        for i in range(3):
            sessions.append({
                'cohort': cohort, 'durationSeconds': 400,
                'firstDecodedFrameMs': 1200+i*200,
                'decodedVideoFrames': 3400, 'decodedAudioFrames': 1400,
                'videoGapsOver3s': 0, 'audioGapsOver3s': 0,
                'testOutageInjected': i == 0,
                'outageRecoveryMs': 2800 if i == 0 else None})
    return {'schemaVersion': 1, 'scope': 'client_decoder',
            'requiredCohorts': required, 'sessions': sessions}


class GateTests(unittest.TestCase):
    def test_good_cohorts_pass(self):
        self.assertTrue(check(sample())['go'])

    def test_http_200_is_not_decoder_proof(self):
        x = sample()
        x['scope'] = 'http_200'
        self.assertFalse(check(x)['go'])

    def test_missing_cohort_fails(self):
        x = sample()
        x['sessions'] = x['sessions'][:6]
        self.assertFalse(check(x)['go'])

    def test_silent_audio_fails(self):
        x = sample()
        x['sessions'][1]['decodedAudioFrames'] = 0
        self.assertFalse(check(x)['go'])

    def test_video_stall_and_slow_recovery_fail(self):
        x = sample()
        x['sessions'][2]['videoGapsOver3s'] = 1
        self.assertFalse(check(x)['go'])
        x = sample()
        x['sessions'][0]['outageRecoveryMs'] = 12000
        self.assertFalse(check(x)['go'])

    def test_unverified_short_session_fails(self):
        x = sample()
        x['sessions'][0]['durationSeconds'] = 40
        self.assertFalse(check(x)['go'])

    def test_invalid_and_non_numeric_data_fail_closed(self):
        x = sample()
        x['sessions'][1]['videoGapsOver3s'] = 'abc'
        self.assertFalse(check(x)['go'])
        x = sample()
        x['sessions'][1]['decodedVideoFrames'] = None
        self.assertFalse(check(x)['go'])


if __name__ == '__main__':
    unittest.main()
