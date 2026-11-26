import importlib.util,json,os,tempfile,unittest,uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location("guard",Path(__file__).resolve().parent.parent/"blofy-live-lease-guard.py")
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
class LeaseTests(unittest.TestCase):
    @unittest.skipUnless(os.getuid()==0,"root-owned persistent fence test")
    def test_renewal_expiry_and_replay(self):
        with tempfile.TemporaryDirectory() as d:
            identity={"engineId":"hostbrr","sourceId":str(uuid.uuid4()),"channelId":"123","reservationId":str(uuid.uuid4())}
            wall=[1700000000.0];mono=[100.0];raw=[b""]
            def publish(seq):
                now=int(wall[0]*1000)
                raw[0]=json.dumps({"lease":{"version":1,**identity,"sequence":seq,"issuedAt":now,"expiresAt":now+60000},"signature":"fixture"}).encode()
            def create():return guard.LiveLeaseGuard(None,identity,Path(d)/"state",verify=lambda p,s:s=="fixture",clock=lambda:wall[0],monotonic=lambda:mono[0],reader=lambda p:raw[0])
            publish(1);a=create();self.assertTrue(a.active())
            with self.assertRaises(guard.LeaseError):create().active()
            wall[0]+=20;mono[0]+=20;publish(2);self.assertTrue(a.active())
            wall[0]-=30;mono[0]+=61
            with self.assertRaises(guard.LeaseError):a.active()
    def test_scope_denial(self):
        with tempfile.TemporaryDirectory() as d:
            identity={"engineId":"hostbrr","sourceId":str(uuid.uuid4()),"channelId":"123","reservationId":str(uuid.uuid4())}
            now=1700000000
            raw=json.dumps({"lease":{"version":1,**identity,"engineId":"linode","sequence":1,"issuedAt":now*1000,"expiresAt":now*1000+60000},"signature":"fixture"}).encode()
            a=guard.LiveLeaseGuard(None,identity,Path(d)/"state",verify=lambda p,s:True,clock=lambda:now,reader=lambda p:raw)
            with self.assertRaises(guard.LeaseError):a.active()
            self.assertFalse((Path(d)/"state").exists())
if __name__=="__main__":unittest.main()
