import concurrent.futures, importlib.util, json, os, pathlib, subprocess, sys, tempfile, unittest, uuid
path=pathlib.Path(__file__).resolve().parents[1]/"blofy_multifeed_local_slots.py"
spec=importlib.util.spec_from_file_location("blofy_multifeed_local_slots",path)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
source=str(uuid.uuid4())
def identity(n,engine="hostbrr"):
    return {"sourceId":source,"channelId":str(n),"reservationId":str(uuid.uuid4()),"engineId":engine}
class SlotTests(unittest.TestCase):
    def test_confirmed_release_rejects_replay_in_a_new_process(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)/"slots"
            original=identity(7)
            slots=mod.LocalSlots(root,"hostbrr",1,owner=os.getuid())
            slots.reserve(original,lambda _:True)
            self.assertTrue(slots.release(original,lambda _:True))
            self.assertEqual(slots.snapshot()["occupied"],0)

            child_code="""
import json, os, sys
from blofy_multifeed_local_slots import LocalSlots, SlotError

slots=LocalSlots(sys.argv[1],"hostbrr",1,owner=os.getuid())
old,replacement=map(json.loads,sys.argv[2:])
try:
    slots.reserve(old,lambda _:True)
except SlotError as error:
    if str(error)!="RESERVATION_ALREADY_USED":
        raise
else:
    raise AssertionError("released reservation was reused")

assert slots.reserve(replacement,lambda _:True)["used"]==1
"""
            replacement=identity(7)
            result=subprocess.run(
                [sys.executable,"-c",child_code,str(root),json.dumps(original),json.dumps(replacement)],
                cwd=path.parent,capture_output=True,text=True,timeout=10
            )
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(slots.snapshot()["occupied"],1)
            self.assertTrue((root/(original["reservationId"]+".released")).is_file())

    def test_concurrent_slots_and_crash_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            def make():return mod.LocalSlots(pathlib.Path(d)/"slots","hostbrr",16,owner=os.getuid())
            def reserve(i):
                value=identity(i)
                try:make().reserve(value,lambda _:True);return value
                except mod.SlotError as e:return str(e)
            with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
                results=list(pool.map(reserve,range(1,33)))
            records=[r for r in results if isinstance(r,dict)]
            self.assertEqual(len(records),16)
            self.assertEqual(results.count("WORKER_CAPACITY"),16)
            self.assertEqual(make().snapshot()["occupied"],16)
            record=records[0]
            with self.assertRaisesRegex(mod.SlotError,"RELEASE_UNCONFIRMED"):make().release(record,lambda _:False)
            self.assertEqual(make().snapshot()["occupied"],16)
            self.assertTrue(make().release(record,lambda _:True))
            self.assertEqual(make().reserve(identity(100),lambda _:True)["used"],16)
    def test_scope_duplicate_channel_and_unverified_lease(self):
        with tempfile.TemporaryDirectory() as d:
            slots=mod.LocalSlots(pathlib.Path(d)/"slots","hostbrr",16,owner=os.getuid())
            r=identity(1)
            with self.assertRaisesRegex(mod.SlotError,"LEASE_UNCONFIRMED"):slots.reserve(r,lambda _:False)
            self.assertEqual(slots.reserve(r,lambda _:True)["generation"],r["reservationId"].replace("-",""))
            with self.assertRaisesRegex(mod.SlotError,"RESERVATION_ALREADY_USED"):slots.reserve(r,lambda _:True)
            with self.assertRaisesRegex(mod.SlotError,"CHANNEL_OCCUPIED"):slots.reserve(identity(1),lambda _:True)
            with self.assertRaisesRegex(mod.SlotError,"INVALID_IDENTITY"):slots.reserve(identity(2,"linode"),lambda _:True)
    def test_unknown_marker_blocks_admission(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)/"slots";root.mkdir(mode=0o700)
            (root/"unexpected").write_text("unrecognized")
            slots=mod.LocalSlots(root,"hostbrr",16,owner=os.getuid())
            with self.assertRaisesRegex(mod.SlotError,"UNKNOWN_SLOT_ENTRY"):slots.reserve(identity(2),lambda _:True)
if __name__=="__main__":unittest.main()
