"""Local reservation slot registry for future multi-feed workers.

No media connections, commands or service activation. Root-owned durable
markers deliberately survive crashes. Only a separately verified controller
release may clear them; local PID absence or lease expiry is not release.
"""
import contextlib, fcntl, json, os, re, stat
from pathlib import Path

UUID=re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
CHANNEL=re.compile(r"[1-9][0-9]{0,14}")
FIELDS={"sourceId","channelId","reservationId","engineId"}

class SlotError(Exception):pass

def identity_ok(value):
    return isinstance(value,dict) and set(value)==FIELDS and value["engineId"] in ("hostbrr","linode") and all(isinstance(value[k],str) and UUID.fullmatch(value[k]) for k in ("sourceId","reservationId")) and isinstance(value["channelId"],str) and CHANNEL.fullmatch(value["channelId"])

class LocalSlots:
    def __init__(self,root,engine,capacity,*,owner=0):
        if engine not in ("hostbrr","linode") or type(capacity) is not int or not 1<=capacity<=64:raise SlotError("INVALID_CAPACITY")
        self.root=Path(root);self.engine=engine;self.capacity=capacity;self.owner=owner
    def _secure_dir(self,p):
        s=p.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=self.owner or s.st_mode&0o077:raise SlotError("UNSAFE_DIRECTORY")
    @contextlib.contextmanager
    def _locked(self):
        self.root.mkdir(mode=0o700,exist_ok=True)
        self._secure_dir(self.root)
        fd=os.open(self.root/".lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
        try:
            s=os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_uid!=self.owner or s.st_mode&0o077:raise SlotError("UNSAFE_LOCK")
            fcntl.flock(fd,fcntl.LOCK_EX)
            yield
        finally:os.close(fd)
    def _records(self):
        records=[]
        released=set()
        for p in self.root.iterdir():
            if p.name==".lock":continue
            if p.suffix not in (".json",".released") or not UUID.fullmatch(p.stem):raise SlotError("UNKNOWN_SLOT_ENTRY")
            fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            with os.fdopen(fd,"rb") as f:
                st=os.fstat(f.fileno())
                if not stat.S_ISREG(st.st_mode) or st.st_uid!=self.owner or st.st_mode&0o077 or not 0<st.st_size<=4096:raise SlotError("UNSAFE_SLOT")
                record=json.loads(f.read(4097))
            if not identity_ok(record) or record["reservationId"]!=p.stem or record["engineId"]!=self.engine:raise SlotError("INVALID_SLOT_RECORD")
            if p.suffix==".released":released.add(record["reservationId"])
            else:records.append(record)
        if len({(r["sourceId"],r["channelId"]) for r in records})!=len(records):raise SlotError("DUPLICATE_SLOT_RECORD")
        if any(r["reservationId"] in released for r in records):raise SlotError("CONFLICTING_SLOT_RECORD")
        return records
    def _sync(self):
        fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
    def reserve(self,identity,verify_lease):
        # Only an authenticated reservation lease can consume a local slot.
        # This callback must be backed by the existing pinned lease verifier.
        if not identity_ok(identity) or identity["engineId"]!=self.engine:raise SlotError("INVALID_IDENTITY")
        with self._locked():
            if verify_lease(identity) is not True:raise SlotError("LEASE_UNCONFIRMED")
            records=self._records()
            if (self.root/(identity["reservationId"]+".released")).exists() or any(r["reservationId"]==identity["reservationId"] for r in records):raise SlotError("RESERVATION_ALREADY_USED")
            if any(r["sourceId"]==identity["sourceId"] and r["channelId"]==identity["channelId"] for r in records):raise SlotError("CHANNEL_OCCUPIED")
            if len(records)>=self.capacity:raise SlotError("WORKER_CAPACITY")
            p=self.root/(identity["reservationId"]+".json")
            fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"w") as f:
                json.dump(identity,f,separators=(",",":"));f.flush();os.fsync(f.fileno())
            self._sync()
            return {"reserved":True,"generation":identity["reservationId"].replace("-",""),"used":len(records)+1}
    def snapshot(self):
        with self._locked():
            records=self._records()
            return {"capacity":self.capacity,"occupied":len(records),"engineId":self.engine}
    def release(self,identity,verify_release):
        # No default verifier, timer, process-state shortcut or forced clear.
        if not identity_ok(identity) or identity["engineId"]!=self.engine:raise SlotError("INVALID_IDENTITY")
        with self._locked():
            if identity not in self._records():raise SlotError("RESERVATION_MISMATCH")
            if verify_release(identity) is not True:raise SlotError("RELEASE_UNCONFIRMED")
            # Preserve the authenticated reservation identity as a durable tombstone.
            # Atomic rename frees capacity without allowing replay after restart.
            os.rename(self.root/(identity["reservationId"]+".json"),self.root/(identity["reservationId"]+".released"))
            self._sync()
            return True
