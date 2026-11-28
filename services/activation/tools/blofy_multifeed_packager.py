"""Isolated multi-feed HLS packager candidate.

The caller supplies an already authorized transport stream and an active
reservation guard. No URL, credential, remote command, or source allocation
is accepted here. Not installed on either production worker.
"""
import json, os, re, select, stat, subprocess, time
from pathlib import Path

class PackagerError(Exception):pass

def playlist_progress(output,now=time.time):
    path=Path(output)/"index.m3u8"
    try:
        st=path.lstat()
        if not stat.S_ISREG(st.st_mode) or not 0<st.st_size<=65536 or not -2<=now()-st.st_mtime<15:return None
        lines=path.read_text().splitlines()
        if not lines or lines[0]!="#EXTM3U":return None
        segments=[];pending=False
        for line in lines[1:]:
            if line.startswith("#EXTINF:"):
                if pending:return None
                pending=True
            elif line and not line.startswith("#"):
                if not pending or not re.fullmatch(r"seg-[0-9]{9}\.ts",line):return None
                pending=False;segments.append(line)
        if pending or len(segments)<3 or len(set(segments))!=len(segments):return None
        seq=[int(x[4:-3]) for x in segments]
        if any(b!=a+1 for a,b in zip(seq,seq[1:])):return None
        for name in segments[-3:]:
            st=(Path(output)/name).lstat()
            if not stat.S_ISREG(st.st_mode) or st.st_size<=0:return None
        return seq[-1]
    except (OSError,ValueError):return None

def command(output,executable="/usr/bin/ffmpeg"):
    return [executable,"-nostdin","-hide_banner","-loglevel","error","-i","pipe:0",
            "-map","0:v:0","-map","0:a?","-c","copy","-f","hls",
            "-hls_time","2","-hls_list_size","12","-hls_delete_threshold","3",
            "-hls_flags","delete_segments+temp_file+omit_endlist",
            "-hls_segment_options","mpegts_flags=+initial_discontinuity",
            "-hls_segment_filename",str(output/"seg-%09d.ts"),str(output/"index.m3u8")]

class ChannelPackager:
    def __init__(self,root,identity,guard,*,spawn=subprocess.Popen):
        reservation=identity.get("reservationId","")
        if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}",reservation):raise PackagerError("INVALID_RESERVATION")
        if not re.fullmatch(r"[1-9][0-9]{0,14}",identity.get("channelId","")):raise PackagerError("INVALID_CHANNEL")
        if getattr(guard,"identity",None)!=identity:raise PackagerError("GUARD_SCOPE")
        self.root=Path(root);self.identity=dict(identity);self.guard=guard;self.spawn=spawn
        self.generation=reservation.replace("-","");self.output=self.root/self.generation
        self.proc=None;self.started=False;self.last_progress=None
    def check(self):
        if self.guard.active() is not True:raise PackagerError("LEASE_INACTIVE")
    def start(self):
        if self.started:raise PackagerError("ALREADY_STARTED")
        self.check()
        st=self.root.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode&0o077:raise PackagerError("UNSAFE_ROOT")
        self.output.mkdir(mode=0o700)
        self.started=True
        self.proc=self.spawn(command(self.output),stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        os.set_blocking(self.proc.stdin.fileno(),False)
    def write(self,data,timeout=5):
        if not self.proc or self.proc.poll() is not None:raise PackagerError("PACKAGER_NOT_RUNNING")
        if not isinstance(data,bytes) or not 0<len(data)<=65536:raise PackagerError("INVALID_CHUNK")
        deadline=time.monotonic()+timeout;view=memoryview(data);fd=self.proc.stdin.fileno()
        while view:
            self.check()
            if self.proc.poll() is not None or time.monotonic()>=deadline:raise PackagerError("PACKAGER_BACKPRESSURE")
            if select.select([],[fd],[],0.2)[1]:
                try:view=view[os.write(fd,view):]
                except BlockingIOError:pass
    def progress(self):
        self.check()
        seq=playlist_progress(self.output)
        if seq is not None:
            if self.last_progress is not None and seq<self.last_progress:raise PackagerError("SEGMENT_REGRESSION")
            self.last_progress=seq
        return seq
    def close(self):
        # Closing the packager is not confirmation of upstream release.
        if self.proc is None:return
        try:self.proc.stdin.close()
        except OSError:pass
        try:self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait()
        self.proc=None
