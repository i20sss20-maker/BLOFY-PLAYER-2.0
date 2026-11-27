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
