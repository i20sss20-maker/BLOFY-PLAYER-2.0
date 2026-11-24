/* Browser-only playback engine. Never changes native Android/iOS clients.
 * The caller supplies a short-lived, SAME-ORIGIN authorized media endpoint.
 * Optional hls.js and mpegts.js adapters must be loaded by the host page.
 * No credentials, stream URLs or tokens are sent to diagnostics. */
const HLS = /(?:\.m3u8)(?:$|[?#])/i;
const TS = /(?:\.ts)(?:$|[?#])/i;
const MP4 = /\.(?:mp4|m4v|mov)(?:$|[?#])/i;

export function selectBrowserEngine({ format, url = '', nativeHls = false, hlsJs = false, mpegtsJs = false, nativeMp4 = false } = {}) {
  const type = String(format || '').trim().toLowerCase();
  const hls = type === 'hls' || (!type && HLS.test(url));
  const ts = type === 'ts' || type === 'mpegts' || (!type && TS.test(url));
  const mp4 = type === 'mp4' || (!type && MP4.test(url));
  if (hls) return nativeHls ? 'native-hls' : hlsJs ? 'hls-js' : 'unsupported';
  if (ts) return mpegtsJs ? 'mpegts-js' : 'unsupported';
  if (mp4) return nativeMp4 ? 'native-mp4' : 'unsupported';
  return 'unsupported';
}

export function recoveryDelay(attempt, random = Math.random()) {
  const n = Math.min(5, Math.max(0, Math.floor(Number(attempt) || 0)));
  return Math.min(12000, Math.round(800 * (2 ** n) * (0.85 + 0.3 * Math.max(0, Math.min(1, random)))));
}

export function createBrowserStreamPlayer(video, {
  Hls = globalThis.Hls,
  mpegts = globalThis.mpegts,
  onStatus = () => {},
  onDiagnostic = () => {},
  maxRetries = 4,
  stallMs = 9000,
  origin = globalThis.location?.origin
} = {}) {
  if (!video || typeof video.canPlayType !== 'function') throw new TypeError('video element is required');
  const listeners = [];
  let generation = 0, timer = null, watch = null, hls = null, tsPlayer = null;
  let current = null, attempts = 0, lastProgressAt = 0, lastTime = 0;
  let abortRefresh = null, disposed = false, intentionalPause = false, seekListener = null;
  let stableSince = 0, lastObservedTime = 0;

  const status = (state) => onStatus(state);
  // Deliberately do not include URLs, channel names, headers or exception messages.
  const diagnostic = (code) => onDiagnostic({ code, engine: current?.engine || 'none', live: Boolean(current?.live) });
  function clearTimers() {
    if (timer !== null) clearTimeout(timer);
    if (watch !== null) clearInterval(watch);
    timer = watch = null;
  }
  function detach() {
    // Preserve the recurring stall watchdog during reconnect. Only open/stop
    // should remove it; otherwise later stalls will never be detected.
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (seekListener) { video.removeEventListener('loadedmetadata', seekListener); seekListener = null; }
    if (abortRefresh) { abortRefresh.abort(); abortRefresh = null; }
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    if (tsPlayer) {
      try { tsPlayer.pause(); tsPlayer.unload(); tsPlayer.detachMediaElement(); tsPlayer.destroy(); } catch {}
      tsPlayer = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  function safeMediaUrl(url) {
    if (!origin) throw new Error('known application origin required');
    const parsed = new URL(String(url || ''), origin);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && new URL(origin).hostname === 'localhost')) {
      throw new Error('secure media URL required');
    }
    if (parsed.origin !== origin || parsed.username || parsed.password) throw new Error('media URL must be same-origin');
    return parsed.href;
  }
  function readyToPlay() {
    let promise;
    try { promise = video.play(); }
    catch { scheduleRecovery('play-threw'); return; }
    if (promise?.catch) promise.catch((error) => {
      if (error?.name === 'NotAllowedError') { status('tap-to-play'); diagnostic('autoplay-blocked'); }
      else if (error?.name !== 'AbortError') scheduleRecovery('play-rejected');
    });
  }
  function installSource(startAt = 0) {
    if (!current) return;
    const { engine, url } = current;
    if (engine === 'native-hls' || engine === 'native-mp4') {
      video.src = url;
      video.load();
    } else if (engine === 'hls-js') {
      hls = new Hls({
        enableWorker: true, lowLatencyMode: false, backBufferLength: 30,
        maxBufferLength: 24, maxMaxBufferLength: 48
      });
      hls.on(Hls.Events.ERROR, (_event, error) => {
        if (!error?.fatal) return;
        if (error.type === Hls.ErrorTypes?.MEDIA_ERROR && attempts < maxRetries) {
          attempts++;
          diagnostic('hls-media-error');
          try { hls.recoverMediaError(); } catch { scheduleRecovery('hls-media-failed'); }
        } else scheduleRecovery('hls-fatal');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (engine === 'mpegts-js') {
      tsPlayer = mpegts.createPlayer({ type: 'mpegts', isLive: Boolean(current.live), url }, {
        enableWorker: true, lazyLoad: false, stashInitialSize: 256 * 1024
      });
      tsPlayer.attachMediaElement(video);
      if (mpegts.Events?.ERROR) tsPlayer.on(mpegts.Events.ERROR, () => scheduleRecovery('ts-error'));
      tsPlayer.load();
    }
    if (!current.live && startAt > 0) {
      seekListener = () => {
        const position = startAt;
        video.removeEventListener('loadedmetadata', seekListener);
        seekListener = null;
        if (Number.isFinite(video.duration) && position < video.duration) video.currentTime = position;
      };
      video.addEventListener('loadedmetadata', seekListener, { once: true });
    }
    lastProgressAt = Date.now();
    stableSince = 0;
    lastTime = video.currentTime || 0;
    lastObservedTime = lastTime;
    readyToPlay();
  }
  function scheduleRecovery(reason) {
    if (disposed || !current || intentionalPause || timer !== null || (video.ended && !current.live)) return;
    diagnostic(reason);
    if (attempts >= maxRetries) { status('playback-unavailable'); return; }
    const version = generation;
    const delay = recoveryDelay(attempts++);
    status('reconnecting');
    timer = setTimeout(async () => {
      timer = null;
      if (disposed || version !== generation || !current || intentionalPause) return;
      let url = current.url;
      if (typeof current.refresh === 'function') {
        const controller = new AbortController();
        abortRefresh = controller;
        try {
          // Caller must reauthenticate/renew any expired stream ticket.
          const updated = await current.refresh({ signal: controller.signal });
          if (updated) url = safeMediaUrl(updated);
        } catch {
          if (controller.signal.aborted) return;
          diagnostic('renew-failed');
        } finally {
          if (abortRefresh === controller) abortRefresh = null;
        }
      }
      if (disposed || version !== generation || !current) return;
      const resume = current.live ? 0 : (video.currentTime || current.resumeAt || 0);
      detach();
      current.url = url;
      installSource(resume);
    }, delay);
  }
  function onProgress() {
    if (!current || disposed) return;
    if (video.currentTime > lastTime + 0.05) {
      lastTime = video.currentTime;
      const now = Date.now();
      if (!stableSince) stableSince = now;
      lastProgressAt = now;
      // A brief second of resumed video is not proof of a stable stream;
      // avoid unlimited fast retry loops on feeds that die repeatedly.
      if (now - stableSince >= 8000) attempts = 0;
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }
  }
  function listen(name, fn) {
    video.addEventListener(name, fn);
    listeners.push([name, fn]);
  }
  listen('timeupdate', onProgress);
  listen('playing', () => { lastProgressAt = Date.now(); status('playing'); });
  listen('waiting', () => { if (current && !intentionalPause) status('buffering'); });
  listen('stalled', () => { if (current && !intentionalPause) status('buffering'); });
  listen('error', () => scheduleRecovery('media-element-error'));
  listen('ended', () => { if (current && !current.live) status('ended'); else scheduleRecovery('unexpected-live-end'); });
  listen('pause', () => { if (!video.ended && !video.seeking && current && !video.error && !disposed) intentionalPause = true; });
  listen('play', () => { intentionalPause = false; });
  function visibility() {
    if (!globalThis.document?.hidden && current && !video.paused && video.readyState < 3) {
      lastProgressAt = Date.now();
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);

  function open({ url, format, live = true, refresh, resumeAt = 0 } = {}) {
    if (disposed) throw new Error('player destroyed');
    // Avoid false positives: the backend must expose a declared media format,
    // not HTML content returned with HTTP 200.
    const safeUrl = safeMediaUrl(url);
    const engine = selectBrowserEngine({
      format, url: safeUrl,
      nativeHls: Boolean(video.canPlayType('application/vnd.apple.mpegurl')),
      hlsJs: Boolean(Hls?.isSupported?.()),
      mpegtsJs: Boolean(mpegts?.isSupported?.()),
      nativeMp4: Boolean(video.canPlayType('video/mp4'))
    });
    generation++;
    clearTimers();
    detach();
    attempts = 0;
    intentionalPause = false;
    current = engine === 'unsupported' ? null : {
      engine, url: safeUrl, live: Boolean(live), refresh, resumeAt
    };
    if (!current) { status('unsupported-format'); diagnostic('unsupported-format'); return false; }
    status('loading');
    installSource(resumeAt);
    watch = setInterval(() => {
      if (!current || disposed || video.paused || video.seeking || globalThis.document?.hidden) return;
      // A frozen frame may still advertise readyState=4. Judge actual
      // playback position, not only buffered data / network state.
      if (Number.isFinite(video.currentTime) && video.currentTime > lastObservedTime + 0.05) {
        lastObservedTime = video.currentTime;
        lastProgressAt = Date.now();
      }
      if (Date.now() - lastProgressAt >= stallMs) scheduleRecovery('stall-timeout');
    }, 2000);
    return true;
  }
  function stop() { generation++; clearTimers(); detach(); current = null; attempts = 0; intentionalPause = false; status('idle'); }
  function destroy() {
    if (disposed) return;
    stop();
    disposed = true;
    for (const [name, fn] of listeners) video.removeEventListener(name, fn);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
  }
  return { open, stop, destroy, retry: () => { attempts = 0; intentionalPause = false; scheduleRecovery('manual-retry'); } };
}
