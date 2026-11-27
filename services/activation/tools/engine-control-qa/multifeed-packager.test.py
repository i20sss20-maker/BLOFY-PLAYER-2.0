import concurrent.futures, importlib.util, pathlib, shutil, subprocess, tempfile, unittest, uuid
p=pathlib.Path(__file__).resolve().parents[1]/"blofy_multifeed_packager.py"
spec=importlib.util.spec_from_file_location("packager",p)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Guard:
    def __init__(self,n):
        self.identity={"sourceId":str(uuid.uuid4()),"channelId":str(n),"reservationId":str(uuid.uuid4()),"engineId":"hostbrr"}
        self.allowed=True
    def active(self):return self.allowed
class PackagerTests(unittest.TestCase):
    def test_timeshift_window_opt_in_and_disk_guard(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);g=Guard(1)
            def window(cmd):return cmd[cmd.index('-hls_list_size')+1]
            self.assertEqual(window(mod.command(root)), '12')
            self.assertEqual(window(mod.command(root,timeshift=True)), '75')
            w=mod.ChannelPackager(root,g.identity,g,timeshift=True,spawn=lambda *a,**k:self.fail('spawned'))
            with patch.object(mod.shutil,'disk_usage',return_value=shutil._ntuple_diskusage(100,99,1)):
                with self.assertRaisesRegex(mod.PackagerError,'TIMESHIFT_LOW_DISK'):w.start()
            self.assertFalse(w.output.exists())
            w.output.mkdir(mode=0o700)
            with (w.output/'seg-000000001.ts').open('wb') as f:f.truncate(mod.TIMESHIFT_MAX_BYTES+1)
            with patch.object(mod.shutil,'disk_usage',return_value=shutil._ntuple_diskusage(10**12,0,10**12)):
                with self.assertRaisesRegex(mod.PackagerError,'TIMESHIFT_STORAGE_LIMIT'):w.check_timeshift_storage()

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),"FFmpeg not installed")
    def test_16_real_local_hls_packagers(self):
        # Generated media only, no provider connection or customer data.
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            fixture=subprocess.check_output(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=160x90:rate=10","-f","lavfi","-i","sine=frequency=440:sample_rate=44100","-t","12","-c:v","mpeg2video","-g","10","-c:a","mp2","-f","mpegts","pipe:1"],timeout=30)
            def run(n):
                g=Guard(n);worker=mod.ChannelPackager(root,g.identity,g)
                try:
                    worker.start()
                    for pos in range(0,len(fixture),65536):worker.write(fixture[pos:pos+65536])
                finally:worker.close()
                self.assertIsNotNone(mod.playlist_progress(worker.output))
                segment=next(worker.output.glob("seg-*.ts"))
                codecs=subprocess.check_output(["ffprobe","-v","error","-show_entries","stream=codec_type","-of","csv=p=0",str(segment)],timeout=15).decode()
                self.assertIn("video",codecs);self.assertIn("audio",codecs)
                return worker.generation
            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                outputs=list(pool.map(run,range(1,17)))
            self.assertEqual(len(set(outputs)),16)
            self.assertEqual(len(list(root.iterdir())),16)
    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),"FFmpeg not installed")
    def test_timeshift_keeps_two_minutes_of_real_generated_media(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);g=Guard(1)
            fixture=subprocess.check_output(["ffmpeg","-nostdin","-hide_banner","-loglevel","error",
                "-f","lavfi","-i","testsrc2=size=160x90:rate=10",
                "-f","lavfi","-i","sine=frequency=440:sample_rate=44100",
                "-t","160","-c:v","mpeg2video","-g","10","-c:a","mp2",
                "-f","mpegts","pipe:1"],timeout=60)
            w=mod.ChannelPackager(root,g.identity,g,timeshift=True)
            try:
                w.start()
                for pos in range(0,len(fixture),65536):w.write(fixture[pos:pos+65536])
            finally:w.close()
            manifest=(w.output/"index.m3u8").read_text()
            durations=[float(line.split(":",1)[1].split(",")[0]) for line in manifest.splitlines() if line.startswith("#EXTINF:")]
            segments=[line for line in manifest.splitlines() if line.startswith("seg-")]
            self.assertEqual(len(segments),75)
            self.assertGreaterEqual(sum(durations),120)
            self.assertIsNotNone(mod.playlist_progress(w.output))
            self.assertTrue(all((w.output/name).is_file() for name in segments))
            self.assertLessEqual(len(list(w.output.glob("seg-*.ts"))),79)
            self.assertIn("video",subprocess.check_output(["ffprobe","-v","error","-show_entries","stream=codec_type","-of","csv=p=0",str(w.output/segments[0])],timeout=15).decode())

    def test_unverified_guard_never_starts(self):
        with tempfile.TemporaryDirectory() as d:
            g=Guard(1);g.allowed=False
            w=mod.ChannelPackager(d,g.identity,g,spawn=lambda *a,**k:self.fail("spawned"))
            with self.assertRaisesRegex(mod.PackagerError,"LEASE_INACTIVE"):w.start()
            self.assertFalse(w.output.exists())
            with self.assertRaisesRegex(mod.PackagerError,"GUARD_SCOPE"):mod.ChannelPackager(d,Guard(2).identity,g)
    def test_manifest_symlink_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);(p/"fake").write_text("#EXTM3U\n")
            (p/"index.m3u8").symlink_to(p/"fake")
            self.assertIsNone(mod.playlist_progress(p))
if __name__=="__main__":unittest.main()
