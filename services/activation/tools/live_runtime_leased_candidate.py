#!/usr/bin/env python3
"""Private single-feed HLS worker. Never starts on install; exclusive slot required."""
import fcntl, json, os, pwd, re, select, signal, socket, stat, subprocess, sys, time, uuid
from blofy_live_lease_guard import LiveLeaseGuard, LeaseError, LeaseWatchdog, notify_watchdog
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import quote
from transport import (HOST, SECRET, CATALOG, Stop, account, configured_origin,
                       public_connection, approved_redirect)
BASE = Path('/var/lib/blofy-real-live')
LOCK = Path('/run/blofy-real-source-v3.lock')
stop_requested = False
lease_guard = None

def check_lease():
    if lease_guard is not None:
        try:lease_guard.active()
        except LeaseError as e:raise Stop(str(e)) from None

def stop_signal(*_):
    global stop_requested
    stop_requested = True

def verify_channel(channel, catalog=CATALOG):
    if not re.fullmatch(r'[1-9][0-9]{0,14}',channel):
        raise Stop('INVALID_CHANNEL')
    if not any(isinstance(i,dict) and str(i.get('stream_id'))==channel for i in json.loads(catalog.read_text())):
        raise Stop('CHANNEL_NOT_IN_LOCAL_CATALOG')
    return channel

def read_secret():
    st=SECRET.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600:
        raise Stop('SECRET_PERMISSIONS')
    c=json.loads(SECRET.read_text())
    c={k:c[k] for k in ('username','password')}
    if not all(isinstance(v,str) and v for v in c.values()):raise Stop('SECRET_FORMAT')
    return c

def state(status, **extra):
    p=BASE/'status.json'
    tmp=BASE/'.status.tmp'
    identity=lease_guard.identity if lease_guard is not None else {}
    with tmp.open('w') as f:json.dump({'status':status,'customerTrafficEnabled':False,'observedAt':datetime.now(timezone.utc).isoformat(),**identity,**extra},f)
    os.replace(tmp,p)
    print('BLOFY_REAL_LIVE_RUNTIME:',status,flush=True)

def released(c, checks=7, delay=10, check=account, sleep=time.sleep):
    for i in range(checks):
        if lease_guard is not None:notify_watchdog()
        try:
            if check(c)==0:return True
        except Exception:pass
        if i+1<checks:sleep(delay)
    return False

def open_media(c, channel):
    scheme,host='https',HOST
    path='/live/'+'/'.join(quote(c[k],safe='') for k in ('username','password'))+'/'+channel+'.ts'
    approved=configured_origin()
    for hop in range(2):
        if stop_requested:raise Stop('STOP_REQUESTED')
        check_lease()
        conn=public_connection(scheme,host)
        try:
            conn.request('GET',path,headers={'Connection':'close','Accept':'video/mp2t, application/octet-stream'})
            r=conn.getresponse()
            if r.status in (301,302,303,307,308) and hop==0:
                location=r.getheader('Location');r.close();conn.close()
                scheme,host,path=approved_redirect(location,scheme+'://'+host+path,approved)
                if account(c)!=0:raise Stop('SOURCE_BUSY_AFTER_REDIRECT')
                continue
            if r.status!=200:raise Stop('MEDIA_HTTP_'+str(r.status))
            if any(x in r.getheader('Content-Type','').lower() for x in ('text/','json','mpegurl','xml')):
                raise Stop('UNEXPECTED_MEDIA_TYPE')
            return conn,r
        except BaseException:
            conn.close();raise
    raise Stop('REDIRECT_LIMIT')

def command(output):
    return ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i','pipe:0','-map','0:v:0','-map','0:a:0','-c','copy','-f','hls','-hls_time','2','-hls_list_size','12','-hls_delete_threshold','3','-hls_flags','delete_segments+temp_file+omit_endlist','-hls_segment_options','mpegts_flags=+initial_discontinuity','-hls_segment_filename',str(output/'seg-%09d.ts'),str(output/'index.m3u8')]

def playlist_progress(output):
    """Require complete, fresh HLS segments, not merely a rewritten manifest."""
    try:
        p=output/'index.m3u8'
        age=time.time()-p.stat().st_mtime
        if not -2<=age<10 or p.stat().st_size>65536:return None
        lines=p.read_text().splitlines()
        if not lines or lines[0]!='#EXTM3U':return None
        segments=[]; pending=False
        for line in lines[1:]:
            if line.startswith('#EXTINF:'):
                if pending:return None
                pending=True
            elif line and not line.startswith('#'):
                if not pending or not re.fullmatch(r'seg-[0-9]{9,}\.ts',line):return None
                segments.append(line);pending=False
        if pending or len(segments)<3 or len(set(segments))!=len(segments):return None
        indices=[int(x[4:-3]) for x in segments]
        if any(b!=a+1 for a,b in zip(indices,indices[1:])):return None
        for name in segments[-3:]:
            st=(output/name).lstat()
            if not stat.S_ISREG(st.st_mode) or st.st_size<=0:return None
        return indices[-1]
    except (OSError,ValueError):return None

def ready(output):
    return playlist_progress(output) is not None

def send(proc, data):
    fd=proc.stdin.fileno(); os.set_blocking(fd,False)
    view=memoryview(data);deadline=time.monotonic()+5
    while view and not stop_requested:
        check_lease()
        if proc.poll() is not None or time.monotonic()>=deadline:raise Stop('PACKAGER_BACKPRESSURE')
        if select.select([],[fd],[],0.5)[1]:
            try:view=view[os.write(fd,view):]
            except BlockingIOError:pass

def run():
    global lease_guard
    watchdog=None
    if os.environ.get('BLOFY_EXCLUSIVE_SOURCE_WINDOW')!='1':raise Stop('EXCLUSIVE_WINDOW_REQUIRED')
    channel=verify_channel(os.environ.get('BLOFY_LIVE_CHANNEL_ID',''))
    mode=os.environ.get('BLOFY_LIVE_MODE','pilot')
    if mode not in ('pilot','lease'):raise Stop('INVALID_LIVE_MODE')
    duration=int(os.environ.get('BLOFY_LIVE_MAX_SECONDS','120'))
    if mode=='pilot' and not 15<=duration<=180:raise Stop('INVALID_PILOT_DURATION')
    if mode=='lease':
        engine={'blofy-engine-01':'linode','blofy-engine-02':'hostbrr'}.get(socket.gethostname().split('.')[0])
        identity={'engineId':engine,'sourceId':os.environ.get('BLOFY_LIVE_SOURCE_ID',''),'channelId':channel,'reservationId':os.environ.get('BLOFY_LIVE_RESERVATION_ID','')}
        try:lease_guard=LiveLeaseGuard(Path('/run/blofy-live-lease/lease.json'),identity,BASE/'lease-reservations')
        except LeaseError as e:raise Stop(str(e)) from None
        check_lease()
        watchdog=LeaseWatchdog(lease_guard)
        watchdog.start()
    if not configured_origin():raise Stop('APPROVED_ORIGIN_REQUIRED')
    c=read_secret(); owner=pwd.getpwnam('blofylive')
    if account(c)!=0:raise Stop('SOURCE_BUSY_NO_MEDIA_REQUEST')
    check_lease()
    generation=uuid.uuid4().hex
    output=BASE/generation;output.mkdir(mode=0o700);os.chown(output,owner.pw_uid,owner.pw_gid)
    conn=r=proc=None; reason='pilot_finished'; is_ready=False
    try:
        state('opening',generation=generation,channelId=channel)
        conn,r=open_media(c,channel)
        proc=subprocess.Popen(command(output),stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,user=owner.pw_uid,group=owner.pw_gid,extra_groups=[],umask=0o077)
        deadline=time.monotonic()+duration
        last_ready=time.monotonic(); last_segment=None; last_report=0
        while not stop_requested and (mode=='lease' or time.monotonic()<deadline):
            check_lease()
            if proc.poll() is not None:raise Stop('PACKAGER_EXITED')
            chunk=r.read1(65536)
            check_lease()
            if not chunk:raise Stop('SOURCE_ENDED')
            send(proc,chunk)
            progress=playlist_progress(output)
            now=time.monotonic()
            if progress is not None and (last_segment is None or progress>last_segment):
                last_segment=progress;last_ready=now
                if not is_ready or now-last_report>=3:
                    is_ready=True;last_report=now
                    state('private_hls_ready',generation=generation,channelId=channel,lastSegment=progress)
            if now-last_ready>35:raise Stop('HLS_NOT_ADVANCING')
    except Stop as e:reason=str(e)
    except Exception as e:reason=type(e).__name__
    finally:
        if r is not None:r.close()
        if conn is not None:conn.close()
        if watchdog is not None:watchdog.stop_after_source_closed()
        if proc is not None:
            if proc.stdin is not None:
                try:proc.stdin.close()
                except OSError:pass
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        state('releasing',generation=generation,channelId=channel)
        ok=released(c)
        state('released' if ok else 'release_unverified',generation=generation,channelId=channel,hlsWasReady=is_ready,reason=reason)
    if not ok or not is_ready or reason!='pilot_finished' or stop_requested:raise Stop('PILOT_NOT_COMPLETE')

def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p=Path(td); catalog=p/'catalog.json';catalog.write_text('[{"stream_id":123}]')
        assert verify_channel('123',catalog)=='123'
        try:verify_channel('124',catalog)
        except Stop:pass
        else:raise AssertionError('unknown channel admitted')
        assert not ready(p)
        names=[f'seg-{i:09d}.ts' for i in range(3)]
        (p/'index.m3u8').write_text('#EXTM3U\n'+''.join('#EXTINF:2,\n'+n+'\n' for n in names))
        assert not ready(p)
        for n in names:(p/n).write_bytes(b'fake fixture')
        assert ready(p) and playlist_progress(p)==2
        (p/names[-1]).unlink();assert not ready(p)
        (p/names[-1]).symlink_to(p/names[0]);assert not ready(p)
        assert 'pipe:0' in command(p) and '-c' in command(p)
    values=iter([1,1,0]);assert released({},3,0,lambda _:next(values),lambda _:None)
    assert not released({},2,0,lambda _:1,lambda _:None)
    assert not released({},2,0,lambda _: (_ for _ in ()).throw(OSError()),lambda _:None)
    print('BLOFY_LIVE_RUNTIME_SELF_TEST_PASS')

if __name__=='__main__':
    os.umask(0o077)
    try:
        if sys.argv[1:]==['--self-test']:self_test();sys.exit(0)
        signal.signal(signal.SIGTERM,stop_signal);signal.signal(signal.SIGINT,stop_signal)
        with LOCK.open('a') as f:
            try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise Stop('LOCAL_SOURCE_LOCK_BUSY')
            run()
    except Stop as e:print('BLOFY_LIVE_RUNTIME_STOPPED:',str(e),flush=True);sys.exit(1)
    except Exception as e:print('BLOFY_LIVE_RUNTIME_STOPPED:',type(e).__name__,flush=True);sys.exit(1)
